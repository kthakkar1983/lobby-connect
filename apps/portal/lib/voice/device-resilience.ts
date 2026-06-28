/** The slice of the Twilio Voice Device we need to keep its token fresh. */
export interface RefreshableDevice {
  on(event: string, handler: (...args: unknown[]) => void): void;
  updateToken(token: string): void;
}

export interface TokenAutoRefreshOptions {
  /** Fetches a fresh Voice access token (e.g. from `/api/twilio/token`). */
  readonly fetchToken: () => Promise<string>;
  /** Invoked if a refresh attempt throws, so the caller can surface a fallback. */
  readonly onRefreshError?: (error: unknown) => void;
}

/**
 * Keep a Twilio Device's access token fresh for the life of the page.
 *
 * The Device is minted with a 1-hour token; without this it silently
 * deregisters at expiry and only a page reload recovers it ("phone line
 * disconnected — reload to reconnect"). Twilio fires `tokenWillExpire` a few
 * minutes before expiry — we refetch a token and hand it back via
 * `updateToken`, so the registration never lapses.
 */
export function attachTokenAutoRefresh(
  device: RefreshableDevice,
  { fetchToken, onRefreshError }: TokenAutoRefreshOptions,
): void {
  device.on("tokenWillExpire", () => {
    void (async () => {
      try {
        device.updateToken(await fetchToken());
      } catch (error) {
        onRefreshError?.(error);
      }
    })();
  });
}

/**
 * Whether to re-register the Device when the tab regains focus/visibility.
 *
 * `attachTokenAutoRefresh` keeps a *live* page registered, but it can't help a
 * tab the browser froze overnight: its timers and `tokenWillExpire` never fire,
 * the token lapses, and the Device drops to the `error` state. The fix is to
 * self-heal when the agent comes back — but only then, so we never thrash the
 * token endpoint from a hidden/backgrounded tab.
 */
export function shouldReconnectDevice(
  phase: string,
  visibilityState: string,
): boolean {
  return visibilityState === "visible" && phase === "error";
}
