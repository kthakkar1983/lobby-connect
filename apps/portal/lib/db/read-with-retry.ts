/**
 * Retry a Supabase single-row read (the `{ data, error }` shape) until it
 * succeeds (no error) or attempts run out, returning the final attempt.
 *
 * Used on the 911 re-join path in `/api/twilio/voice/dial-result`: that read
 * decides whether the guest's parent leg joins the emergency conference, so a
 * single transient blip must NOT silently fall through to a hangup mid-911.
 */
export async function readWithRetry<T>(
  read: () => PromiseLike<{ data: T; error: unknown }>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<{ data: T; error: unknown }> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 150;
  let result = await read();
  for (let attempt = 1; attempt < attempts && result.error; attempt++) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    result = await read();
  }
  return result;
}
