/**
 * Wraps the global `fetch` with a hard upper bound so a hung dependency
 * rejects instead of hanging forever. Used by the service-role admin client
 * on the Twilio voice path: an aborted query lands in the route's existing
 * try/catch → apology TwiML, never dead air.
 */
export function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    // Honour any caller-supplied signal by racing it against our timeout.
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    return fetch(input, { ...init, signal });
  };
}
