// @vitest-environment jsdom
// Needs a DOM: the recovery wiring attaches window pointer/key listeners.
import { describe, it, expect, vi } from "vitest";

import {
  recoverAudioOnNextGesture,
  unlockAudioPlayback,
} from "@/lib/video/audio-unlock";

describe("recoverAudioOnNextGesture", () => {
  it("replays once on the next pointer interaction, then stops listening", () => {
    const replay = vi.fn();
    recoverAudioOnNextGesture(replay);

    window.dispatchEvent(new Event("pointerdown"));
    expect(replay).toHaveBeenCalledTimes(1);

    // One-shot: a second interaction must not replay again.
    window.dispatchEvent(new Event("pointerdown"));
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("recovers on a key interaction too (not only pointer)", () => {
    const replay = vi.fn();
    recoverAudioOnNextGesture(replay);

    window.dispatchEvent(new Event("keydown"));
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("swallows a replay error so a still-blocked play never throws", () => {
    const replay = vi.fn(() => {
      throw new Error("still blocked");
    });
    recoverAudioOnNextGesture(replay);

    expect(() => window.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  });
});

describe("unlockAudioPlayback", () => {
  it("is best-effort and never throws when Web Audio is unavailable", () => {
    expect(() => unlockAudioPlayback()).not.toThrow();
  });
});
