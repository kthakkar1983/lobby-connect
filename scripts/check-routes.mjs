// Fails if any `as never` cast appears under apps/portal/{app,components}.
// `as never` defeats typedRoutes (renames then ship dead links). Use `as Route`
// for genuinely-dynamic hrefs; a real not-yet-built route may keep a cast only
// when annotated with `// FORWARD-REF:` on the same line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/portal/app", "apps/portal/components"];
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes("as never") && !line.includes("FORWARD-REF:")) {
            offenders.push(`${p}:${i + 1}: ${line.trim()}`);
          }
        });
    }
  }
}

for (const r of roots) walk(r);

if (offenders.length) {
  console.error(
    "Disallowed `as never` casts (use `as Route`, or annotate a real forward-ref " +
      "with `// FORWARD-REF:`):\n" + offenders.join("\n"),
  );
  process.exit(1);
}
console.log("Route casts OK.");
