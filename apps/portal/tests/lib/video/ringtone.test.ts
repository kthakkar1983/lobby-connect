import { describe, it, expect, vi } from "vitest";

import { createRingtone } from "@/lib/video/ringtone";

function makeFakePlayer(play: () => Promise<void> | void = () => Promise.resolve()) {
  return {
    play: vi.fn(play),
    pause: vi.fn(),
    currentTime: 0,
  };
}

describe("createRingtone", () => {
  it("plays the player when started", () => {
    const player = makeFakePlayer();
    createRingtone(player).start();
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("does not restart while already ringing", () => {
    const player = makeFakePlayer();
    const ring = createRingtone(player);
    ring.start();
    ring.start();
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("pauses and rewinds to the start when stopped", () => {
    const player = makeFakePlayer();
    const ring = createRingtone(player);
    ring.start();
    player.currentTime = 5;
    ring.stop();
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
  });

  it("does nothing when stopped before it ever started", () => {
    const player = makeFakePlayer();
    createRingtone(player).stop();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it("can ring again after being stopped", () => {
    const player = makeFakePlayer();
    const ring = createRingtone(player);
    ring.start();
    ring.stop();
    ring.start();
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it("swallows a blocked-autoplay rejection instead of throwing", async () => {
    const player = makeFakePlayer(() => Promise.reject(new Error("blocked")));
    const ring = createRingtone(player);
    expect(() => ring.start()).not.toThrow();
    await Promise.resolve();
  });
});
