import { useEffect } from "react";

/**
 * Flash the browser tab title while an incoming call is ringing, then restore the
 * prior title when it stops (or the component unmounts).
 *
 * Incoming calls otherwise leave no tab-level signal: during the s1 test a tab
 * started ringing while everyone was in a meeting and no one could tell which tab
 * it was (the ring plays from a mounted component, with no tab-title or favicon
 * change). Changing the title makes the ringing tab identifiable at a glance.
 *
 * `title` is captured into the effect, so a changing title (e.g. the property name
 * resolving) updates the tab while still restoring the original on stop.
 */
export function useRingingTabTitle(ringing: boolean, title: string): void {
  useEffect(() => {
    if (!ringing || typeof document === "undefined") return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [ringing, title]);
}
