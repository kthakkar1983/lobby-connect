// Pull Sentry issues (and single-event detail) for the portal project from the CLI.
//
// Usage:
//   node scripts/sentry-issues.mjs                      # list issues (14d, by frequency)
//   node scripts/sentry-issues.mjs --days 7             # change the window
//   node scripts/sentry-issues.mjs --query is:unresolved
//   node scripts/sentry-issues.mjs --issue 7538466720   # latest event: trace + tags + breadcrumbs
//   pnpm sentry:issues -- --issue <id>
//
// Reads SENTRY_ORG / SENTRY_PROJECT / SENTRY_READ_TOKEN (falls back to
// SENTRY_AUTH_TOKEN) from the environment first, then apps/portal/.env.local.
// The token needs Issue & Event read scope — the build/upload token does NOT
// (it 403s); create an Internal Integration token for SENTRY_READ_TOKEN.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(here, "..", "apps", "portal", ".env.local");

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const raw of readFileSync(ENV_PATH, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line
        .slice(0, eq)
        .trim()
        .replace(/^export\s+/, "");
      if (env[key] === undefined) {
        env[key] = line
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* .env.local is optional when the vars are already in the environment */
  }
  return env;
}

function parseArgs(argv) {
  const args = { days: "14", query: "", limit: "50", issue: null };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--issue":
        args.issue = next();
        break;
      case "--days":
        args.days = next();
        break;
      case "--query":
        args.query = next();
        break;
      case "--limit":
        args.limit = next();
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
    }
  }
  return args;
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text();
    const hint =
      res.status === 403
        ? " (403 — token lacks Issue & Event read scope; use an Internal Integration token in SENTRY_READ_TOKEN)"
        : "";
    throw new Error(`HTTP ${res.status}${hint}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const tag = (ev, key) => ev.tags?.find((t) => t.key === key)?.value ?? "-";

async function listIssues(base, token, args) {
  const q = encodeURIComponent(args.query);
  const url = `${base}/issues/?statsPeriod=${args.days}d&query=${q}&limit=${args.limit}&sort=freq`;
  const issues = await getJson(url, token);
  console.log(
    `\n${issues.length} issue(s) in last ${args.days}d (query: "${args.query || "(all)"}"), by frequency:\n`
  );
  for (const i of issues) {
    const md = i.metadata ?? {};
    console.log(
      `  ${i.shortId}  [${i.level}/${i.status}]  ${i.count}x  users=${i.userCount}  last=${String(i.lastSeen).slice(0, 16)}`
    );
    console.log(`      id=${i.id}  platform=${i.platform}  unhandled=${i.isUnhandled}`);
    console.log(`      ${md.type ?? md.title ?? i.type}: ${(md.value ?? "").slice(0, 110)}`);
    console.log(`      culprit: ${i.culprit}`);
    console.log(`      ${i.permalink}\n`);
  }
}

async function showEvent(issueId, token) {
  const ev = await getJson(`https://sentry.io/api/0/issues/${issueId}/events/latest/`, token);
  console.log(`\n=== issue ${issueId} — latest event ${ev.eventID} (${ev.dateCreated}) ===`);
  console.log(
    `  release=${tag(ev, "release")}  env=${tag(ev, "environment")}  url=${tag(ev, "url")}`
  );
  console.log(
    `  transaction=${tag(ev, "transaction")}  handled=${tag(ev, "handled")}  mechanism=${tag(ev, "mechanism")}`
  );
  for (const e of ev.entries ?? []) {
    if (e.type === "exception") {
      for (const val of e.data.values ?? []) {
        console.log(`  -- ${val.type}: ${String(val.value ?? "").slice(0, 160)}`);
        for (const fr of (val.stacktrace?.frames ?? []).slice(-12)) {
          console.log(
            `     ${fr.inApp ? "*" : " "} ${fr.filename ?? fr.module}:${fr.lineNo}  ${fr.function}`
          );
        }
      }
    }
  }
  for (const e of ev.entries ?? []) {
    if (e.type === "breadcrumbs") {
      const crumbs = e.data.values ?? [];
      console.log(`  -- last breadcrumbs (${crumbs.length} total):`);
      for (const c of crumbs.slice(-12)) {
        const msg = (c.message ?? JSON.stringify(c.data ?? {})).slice(0, 120);
        console.log(`     [${c.category}/${c.level}] ${msg}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/sentry-issues.mjs [--days N] [--query Q] [--limit N] [--issue ID]"
    );
    return;
  }
  const env = loadEnv();
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;
  const token = env.SENTRY_READ_TOKEN || env.SENTRY_AUTH_TOKEN;
  if (!org || !project || !token) {
    console.error(
      "Missing SENTRY_ORG / SENTRY_PROJECT / SENTRY_READ_TOKEN (or SENTRY_AUTH_TOKEN)."
    );
    process.exit(1);
  }
  const base = `https://sentry.io/api/0/projects/${org}/${project}`;
  if (args.issue) await showEvent(args.issue, token);
  else await listIssues(base, token, args);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
