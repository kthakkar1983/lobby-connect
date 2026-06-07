/**
 * Debounce guard for the window-focus refresh in <AutoRefresh>.
 *
 * Rapidly regaining focus (tab switching, alt-tab) could otherwise fire a
 * router.refresh() per focus event. We allow a refresh only when at least
 * `minGapMs` has elapsed since the last one. `lastMs` of 0 (never refreshed)
 * always passes.
 */
export function shouldRefresh(lastMs: number, nowMs: number, minGapMs = 5000): boolean {
  return nowMs - lastMs >= minGapMs;
}
