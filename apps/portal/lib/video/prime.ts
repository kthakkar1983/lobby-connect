// Autoplay unlock: browsers block audio.play() until the page has seen a user
// gesture. Priming (play→immediately pause) inside a gesture unlocks the element
// so a later programmatic ring actually plays. Shared by the softphone ring unlock
// and the "Go on duty" arming click. No-op if the element is null or already playing
// (so we never cut off a live ring).
export function primeRingtone(audio: HTMLAudioElement | null): void {
  if (!audio || !audio.paused) return;
  void Promise.resolve(audio.play())
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
    })
    .catch(() => {});
}
