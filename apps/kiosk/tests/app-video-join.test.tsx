// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { KioskConfig } from "@/types";
import type { KioskVideoSession } from "@/lib/video/types";

// Covers onStartCall (apps/kiosk/src/App.tsx) routing a video-token response
// into the LiveKit join:
//   const session = await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks });
// VideoTokenResult's `provider` field is now a single-member "livekit" literal
// (the wire discriminator, no longer a narrowing union) — there is no other
// provider value to route to the setup-failure path.

const config: KioskConfig = {
  propertyId: "p1",
  logoUrl: null,
  welcomeHeading: "Welcome",
  welcomeMessage: null,
  checkinTime: null,
  checkoutTime: null,
  wifiNetwork: null,
  wifiPassword: null,
  breakfastHours: null,
  apologyMessage: null,
  phoneNumber: null,
  ctaStyle: "warm",
};

// Hoisted so the vi.mock factories (which are lifted above these declarations)
// can reference the spies directly instead of through lazy wrappers.
const api = vi.hoisted(() => ({
  fetchKioskConfig: vi.fn(),
  startCall: vi.fn(),
  fetchVideoToken: vi.fn(),
  endCall: vi.fn(),
  sendHeartbeat: vi.fn(),
}));
const video = vi.hoisted(() => ({ joinLiveKit: vi.fn() }));

vi.mock("@/lib/portal-api", () => api);
vi.mock("@/lib/video/livekit", () => ({ joinLiveKit: video.joinLiveKit }));
vi.mock("@/lib/audio-unlock", () => ({
  unlockAudioPlayback: vi.fn(),
}));
vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// The real screens render `motion`-driven connection lines that are irrelevant
// here — stub them to inert nodes so the harness stays focused on the routing.
vi.mock("@/screens/Home", () => ({
  Home: ({ onCall }: { onCall: () => void }) => (
    <button type="button" onClick={onCall}>
      tap to connect
    </button>
  ),
}));
vi.mock("@/screens/Ringing", () => ({ Ringing: () => <div>ringing</div> }));
vi.mock("@/screens/Connected", () => ({ Connected: () => <div>connected</div> }));
vi.mock("@/screens/Apology", () => ({ Apology: () => <div>apology</div> }));

// Imported after the mocks are registered (both are hoisted by Vitest, mocks first).
import { App } from "@/App";

// A session shape App can consume post-join (localVideo.attach/detach/mediaStreamTrack,
// localAudioTrack.enabled, leave()) — same minimal shape the provider-agnostic
// KioskVideoSession type promises; App never reads provider internals.
function fakeSession(): KioskVideoSession {
  return {
    localVideo: {
      attach: vi.fn(),
      detach: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mediaStreamTrack: vi.fn(() => ({ enabled: true }) as any),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    localAudioTrack: { enabled: true } as any,
    leave: vi.fn(async () => {}),
    sendData: vi.fn(),
  };
}

describe("App onStartCall — routes the video token to the LiveKit join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.startCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
    api.endCall.mockResolvedValue(undefined);
    api.sendHeartbeat.mockResolvedValue(undefined);
  });

  it('provider "livekit" routes to joinLiveKit with url+token', async () => {
    api.fetchVideoToken.mockResolvedValue({
      provider: "livekit",
      url: "wss://lk",
      channelName: "ch-1",
      token: "jwt-1",
    });
    video.joinLiveKit.mockResolvedValue(fakeSession());

    render(<App />);

    const tap = await screen.findByRole("button", { name: /tap to connect/i });
    tap.click();

    await waitFor(() => {
      expect(video.joinLiveKit).toHaveBeenCalledTimes(1);
    });
    expect(video.joinLiveKit.mock.calls[0]![0]).toMatchObject({
      url: "wss://lk",
      token: "jwt-1",
    });
  });
});
