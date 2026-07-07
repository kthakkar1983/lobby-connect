"use client";
// Call-scoped Document-PiP tile (spec §3.3). requestWindow() must be invoked
// synchronously inside the user gesture — callers do: openCallTile() FIRST,
// then run their async accept flow. The tile is additive: every failure path
// leaves the call proceeding normally in the tab.
import { preparePipDocument } from "@/lib/duty-tile/pip-document";

const TILE_WIDTH = 380;
const TILE_HEIGHT = 300;

export interface CallTileHandle {
  mount: HTMLElement;
  close: () => void;
  window: Window;
}

export function docPipSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

/**
 * Open the PiP window synchronously-enough for the gesture: requestWindow is
 * called before this function returns control to awaiting code. onClosed fires
 * on user-close (the "reopen tile" affordance keys off it).
 */
export function openCallTile(onReady: (h: CallTileHandle) => void, onClosed: () => void): void {
  const docPip = window.documentPictureInPicture;
  if (!docPip) return;
  void docPip
    .requestWindow({ width: TILE_WIDTH, height: TILE_HEIGHT })
    .then((pip) => {
      // Review fold-in M-1: if preparing the PiP document throws (e.g. a
      // stylesheet CSSOM access explodes in a way preparePipDocument's own
      // try/catch didn't anticipate), close the just-opened window instead of
      // leaving an orphaned, handle-less PiP tile the agent can never reach —
      // the call must continue normally in the tab either way.
      try {
        const mount = preparePipDocument(pip.document);
        pip.addEventListener("pagehide", onClosed);
        onReady({ mount, window: pip, close: () => pip.close() });
      } catch {
        pip.close();
      }
    })
    .catch((err: unknown) => {
      /* no tile — call continues in the tab */
      // TEMP tile-debug (2026-07-07): surface WHY requestWindow rejected (the
      // "won't open with DevTools" case). Console-only; remove after diagnosis.
      console.log("[tile-debug] requestWindow rejected:", err);
    });
}
