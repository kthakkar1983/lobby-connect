// Keep the remote call audio audible without ever showing a customer-facing
// "tap to hear" prompt.
//
// The problem: on a cold first call after idle, the Agora join chain (answer
// route → token route → SDK import → join → remote publish) runs for seconds
// before the guest's audio `play()` is attempted. By then the start gesture's
// autoplay permission can have lapsed and an idle AudioContext may be suspended,
// so playback is silently blocked. A warm second call always works.
//
// Two-pronged, both invisible:
//  1. unlockAudioPlayback() — called inside the gesture that already starts the
//     call (kiosk "tap to connect" / agent "Accept") to keep output permitted.
//  2. recoverAudioOnNextGesture() — if Agora still reports a block, re-play on
//     the very next pointer/key interaction. No prompt, no UI.

let ctx: AudioContext | null = null;

type WebkitWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

/**
 * Unlock/resume audio output from within a user gesture. Idempotent and
 * best-effort: safe to call on every Accept/tap, never throws.
 */
export function unlockAudioPlayback(): void {
  try {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* best effort — autoplay recovery below is the guarantee */
  }
}

/**
 * Silent recovery: re-play on the very next pointer/key interaction, then stop
 * listening. On a live call an interaction follows within moments, so the audio
 * simply "comes on" with no prompt.
 */
export function recoverAudioOnNextGesture(replay: () => void): void {
  const run = () => {
    window.removeEventListener("pointerdown", run);
    window.removeEventListener("keydown", run);
    try {
      replay();
    } catch {
      /* ignore — nothing more we can do invisibly */
    }
  };
  window.addEventListener("pointerdown", run, { once: true });
  window.addEventListener("keydown", run, { once: true });
}
