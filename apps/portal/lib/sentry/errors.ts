import "server-only";
import { unstable_cache } from "next/cache";

// Count of unresolved issues in the last 24h, from the Sentry API. Server-only
// (uses the auth token). Returns null on any missing-config / failure so the
// /status card degrades to a link instead of breaking the page. `fetchImpl` is
// injectable for tests. The count is one page of issues (Sentry caps at 100),
// which is plenty of resolution for an at-a-glance health dot.
export async function getRecentErrorCount(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  // Prefer the read-scoped token; the build's SENTRY_AUTH_TOKEN is upload-only
  // and 403s on the issues API, which silently degraded this card to a link.
  const token = process.env.SENTRY_READ_TOKEN ?? process.env.SENTRY_AUTH_TOKEN;
  if (!org || !project || !token) return null;

  try {
    // `statsPeriod` only sets the stats bucket — it does NOT filter the issue
    // list by age — so `is:unresolved` alone counts ALL-TIME unresolved issues
    // (including ones older than the 14d UI window). `lastSeen:-24h` scopes the
    // count to issues actually seen in the last 24h, matching what this card claims.
    const query = encodeURIComponent("is:unresolved lastSeen:-24h");
    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?statsPeriod=24h&query=${query}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const issues: unknown = await res.json();
    return Array.isArray(issues) ? issues.length : null;
  } catch {
    return null;
  }
}

// /admin/status refreshes every 20s; without this each tick (per tab) hit the
// Sentry API. Cache the count for 120s so it's ~1 call/2min regardless of viewers
// (also eases Sentry's tight rate limit on the issues-search endpoint). The card
// is ≤120s stale — fine for an at-a-glance health dot.
export const getCachedErrorCount = unstable_cache(
  async () => getRecentErrorCount(),
  ["status:sentry-error-count"],
  { revalidate: 120 }
);
