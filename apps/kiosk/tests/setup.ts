import { vi } from "vitest";

// jsdom doesn't implement HTMLMediaElement.play/pause. The kiosk's incoming-call
// ringtone (App.tsx) plays/pauses a hidden <audio> element on screen changes, so
// stub them to inert spies: component tests stay quiet (no "Not implemented"
// noise) and non-flaky, and a test can still assert the ring was triggered. The
// ring actually SOUNDING is a live-smoke concern (jsdom can't verify audio) —
// verified on the real iPad. Guarded so the shared node-environment test files
// (where HTMLMediaElement is undefined) are untouched.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
}
