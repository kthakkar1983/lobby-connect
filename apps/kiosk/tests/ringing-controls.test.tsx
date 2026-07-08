// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Ringing } from "@/screens/Ringing";
import type { VideoTrackHandle } from "@/lib/video/types";

// Root-cause guard (App.tsx): the ringing screen renders the instant the guest
// taps to call, but the local audio/video tracks aren't assigned until the
// startCall -> token -> joinLiveKit chain resolves (App.tsx:138-139). Pressing
// Mute / Camera-off before then no-ops on a null track while the UI flips state,
// so the guest looks muted but is live for the whole call. Fix: the mic/camera
// controls are gated on track readiness (`localVideo` present) so they cannot be
// actuated before they would work.

function makeHandle(): VideoTrackHandle {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    mediaStreamTrack: () => ({ enabled: true }) as MediaStreamTrack,
  };
}

const noop = () => {};
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

afterEach(cleanup);

describe("Ringing — mic/camera controls gated on track readiness", () => {
  it("disables Mute and Camera-off while the local track is not ready (localVideo null)", () => {
    render(
      <Ringing
        localVideo={null}
        muted={false}
        cameraOff={false}
        onMute={noop}
        onCamera={noop}
        onCancel={noop}
      />,
    );
    expect(btn("Mute").disabled).toBe(true);
    expect(btn("Camera off").disabled).toBe(true);
    // Cancel must ALWAYS stay usable so the guest can abort a dialing call.
    expect(btn("Cancel").disabled).toBe(false);
  });

  it("enables Mute and Camera-off once the local track is ready (localVideo set)", () => {
    render(
      <Ringing
        localVideo={makeHandle()}
        muted={false}
        cameraOff={false}
        onMute={noop}
        onCamera={noop}
        onCancel={noop}
      />,
    );
    expect(btn("Mute").disabled).toBe(false);
    expect(btn("Camera off").disabled).toBe(false);
  });
});
