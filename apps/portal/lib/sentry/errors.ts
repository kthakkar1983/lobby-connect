import "server-only";

// Count of unresolved issues in the last 24h, from the Sentry API. Server-only
// (uses the auth token). Returns null on any missing-config / failure so the
// /status card degrades to a link instead of breaking the page. `fetchImpl` is
// injectable for tests. The count is one page of issues (Sentry caps at 100),
// which is plenty of resolution for an at-a-glance health dot.
export async function getRecentErrorCount(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!org || !project || !token) return null;

  try {
    const query = encodeURIComponent("is:unresolved");
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
