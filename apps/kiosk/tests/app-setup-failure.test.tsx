// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { KioskConfig } from "@/types";

// The catch under test lives in onStartCall (apps/kiosk/src/App.tsx): after
// startCall() resolves (row created, callIdRef set), fetchVideoToken rejects.
// The fix must close the created row via endCall(id, "failed") before showing
// the apology screen; otherwise a live, answerable RINGING row leaks.

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
// here — stub them to inert nodes so the harness stays focused on the catch.
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

describe("App onStartCall — setup-failure catch closes the created row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.startCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
    // The failure under test: the row is created, then token acquisition throws.
    api.fetchVideoToken.mockRejectedValue(new Error("video-token 500"));
    api.endCall.mockResolvedValue(undefined);
    api.sendHeartbeat.mockResolvedValue(undefined);
  });

  it("calls endCall('call-1', 'failed') when startCall resolves but fetchVideoToken rejects", async () => {
    render(<App />);

    // Config loads → Home appears (the loading screen clears once fetchKioskConfig resolves).
    const tap = await screen.findByRole("button", { name: /tap to connect/i });

    // Trigger the call: onCall → onStartCall → startCall resolves, fetchVideoToken rejects.
    tap.click();

    await waitFor(() => {
      expect(api.endCall).toHaveBeenCalledWith("call-1", "failed");
    });
    // The token fetch failed before either provider join could run.
    expect(video.joinAgora).not.toHaveBeenCalled();
    expect(video.joinLiveKit).not.toHaveBeenCalled();
  });
});
