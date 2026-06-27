"use client";

import { useCallback, useEffect, useState } from "react";

// Per-agent caption preference, remembered across calls + reloads. Captions
// are billed per audio-minute, so an agent who doesn't need them can switch
// them off (which also tears down the upstream audio that competes with the
// live call media — see lib/captions/provider.ts).
const STORAGE_KEY = "lc.captions.enabled";

/**
 * Whether the agent wants live captions, persisted in localStorage. Defaults
 * ON. SSR-safe: renders `true` first, then reconciles from storage after mount
 * so there's no hydration mismatch.
 */
export function useCaptionsEnabled(): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setEnabled(stored === "true");
    } catch {
      /* private mode / storage unavailable — keep the default */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore — the in-memory state still updates for this session */
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
