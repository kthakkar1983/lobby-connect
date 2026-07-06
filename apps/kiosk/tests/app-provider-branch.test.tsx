// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { KioskConfig } from "@/types";
import type { KioskVideoSession } from "@/lib/video/types";

// The provider ternary under test lives in onStartCall (apps/kiosk/src/App.tsx):
//   tok.provider === "livekit" ? joinLiveKit(...) : joinAgora(...)
// This is the crux of the Phase-4 provider seam but had no direct test — nothing
// proved an agora token routes to joinAgora (and NOT joinLiveKit) and vice versa.

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
const video = vi.hoisted(() => ({ joinAgora: vi.fn(), joinLiveKit: vi.fn() }));

vi.mock("@/lib/portal-api", () => api);
vi.mock("@/lib/video/agora", () => ({ joinAgora: video.joinAgora }));
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
// localAudioTrack.enabled, leave()) — same minimal shape regardless of provider, since
// App only reads the provider-agnostic KioskVideoSession, never provider internals.
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
  };
}

describe("App onStartCall — provider ternary routes to the matching join fn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.startCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
    api.endCall.mockResolvedValue(undefined);
    api.sendHeartbeat.mockResolvedValue(undefined);
  });

  it('provider "agora" routes to joinAgora with the token fields (and never joinLiveKit)', async () => {
    api.fetchVideoToken.mockResolvedValue({
      provider: "agora",
      appId: "app-1",
      channelName: "ch-1",
      token: "tok-1",
      uid: 123,
    });
    video.joinAgora.mockResolvedValue(fakeSession());

    render(<App />);

    const tap = await screen.findByRole("button", { name: /tap to connect/i });
    tap.click();

    await waitFor(() => {
      expect(video.joinAgora).toHaveBeenCalledTimes(1);
    });
    expect(video.joinAgora.mock.calls[0]![0]).toMatchObject({
      appId: "app-1",
      channel: "ch-1",
      token: "tok-1",
      uid: 123,
    });
    expect(video.joinLiveKit).not.toHaveBeenCalled();
  });

  it('provider "livekit" routes to joinLiveKit with url+token (and never joinAgora)', async () => {
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
    expect(video.joinAgora).not.toHaveBeenCalled();
  });
});
