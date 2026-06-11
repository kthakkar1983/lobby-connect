import * as Sentry from "@sentry/nextjs";

type ReliableOpts = {
  /** A short, stable label for Sentry grouping, e.g. "calls.notes". */
  label: string;
  /** Additional attempts after the first. Default 2 (≤3 total). */
  retries?: number;
  /** Backoff before retry N (0-indexed). Default 300ms · 2^N. Injectable for tests. */
  backoffMs?: (attempt: number) => number;
};

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * A fetch that retries transient failures (thrown / 5xx) and reports to Sentry
 * when it ultimately fails. Returns the Response for any received response
 * (including 4xx, which is NOT retried), or null when every attempt threw.
 * Callers treat `null || !res.ok` as failure.
 */
export async function reliableFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: ReliableOpts,
): Promise<Response | null> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? ((n: number) => 300 * 2 ** n);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // Only a 5xx is retryable; success / 4xx / unknown-status return as-is.
      if (!(res.status >= 500)) return res;
      if (attempt === retries) {
        Sentry.captureException(new Error(`reliableFetch ${opts.label} ${res.status}`), {
          extra: { label: opts.label, status: res.status },
        });
        return res;
      }
    } catch (err) {
      if (attempt === retries) {
        Sentry.captureException(err, { extra: { label: opts.label } });
        return null;
      }
    }
    await delay(backoff(attempt));
  }
  return null; // unreachable; satisfies the type checker
}
