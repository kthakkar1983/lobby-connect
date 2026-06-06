/** The slice of an HTMLAudioElement a ringtone needs. */
export interface RingtonePlayer {
  play(): Promise<void> | void;
  pause(): void;
  currentTime: number;
}

export interface Ringtone {
  start(): void;
  stop(): void;
}

/**
 * Wrap an audio element as an idempotent ringtone: `start()` plays it (a no-op
 * if already ringing), `stop()` pauses and rewinds to the beginning. Looping is
 * configured on the element itself, not here.
 */
export function createRingtone(player: RingtonePlayer): Ringtone {
  let ringing = false;
  return {
    start(): void {
      if (ringing) return;
      ringing = true;
      // play() rejects if the browser blocks autoplay before any user gesture;
      // swallow it so the caller never sees an unhandled rejection.
      void Promise.resolve(player.play()).catch(() => {});
    },
    stop(): void {
      if (!ringing) return;
      ringing = false;
      player.pause();
      player.currentTime = 0;
    },
  };
}
