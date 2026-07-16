// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KioskConfig } from "@/types";
import type { JoinCallbacks, KioskVideoSession } from "@/lib/video/types";
import { copy } from "@/lib/copy";

// Covers Task 11: a LiveKit terminal drop (interpretConnectionState ===
// "terminal") from a CONNECTED call must return the kiosk to the real Home
// screen with tap-to-call disabled for the 10s RECONNECT_WINDOW_MS lockout
// (App.tsx's onConnectionStateChange "terminal" branch + Home's lockedOut
// prop) — while the Home-only incoming-call discovery poll (Task 10) keeps
// running underneath, so an agent's immediate call-back still reaches the
// Answer screen despite the lockout. A pre-connect terminal failure (still
// ringing) must keep the pre-existing apology behavior, unchanged.
//
// Home and IncomingCall are deliberately left REAL here (unlike the other
// app-*.test.tsx harnesses, which mock Home to a plain button) since both are
// under test; Ringing/Connected/Apology are irrelevant to this file and stay
// stubbed, mirroring app-video-join.test.tsx's approach.

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

const api = vi.hoisted(() => ({
  fetchKioskConfig: vi.fn(),
  startCall: vi.fn(),
  fetchVideoToken: vi.fn(),
  endCall: vi.fn(),
  sendHeartbeat: vi.fn(),
  fetchIncomingCall: vi.fn(),
  answerCall: vi.fn(),
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

vi.mock("@/screens/Ringing", () => ({ Ringing: () => <div>ringing</div> }));
vi.mock("@/screens/Connected", () => ({ Connected: () => <div>connected</div> }));
vi.mock("@/screens/Apology", () => ({ Apology: () => <div>apology</div> }));

// Imported after the mocks are registered (both are hoisted by Vitest, mocks first).
import { App } from "@/App";

afterEach(cleanup);

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

describe("kiosk terminal-drop tap lockout (Task 11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.startCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
    api.endCall.mockResolvedValue(undefined);
    api.sendHeartbeat.mockResolvedValue(undefined);
    // No ring until a test arms one — otherwise the initial home-poll would
    // immediately flip to "incoming" before the guest ever taps to call out.
    api.fetchIncomingCall.mockResolvedValue({ status: "idle" });
    api.fetchVideoToken.mockResolvedValue({
      provider: "livekit",
      url: "wss://lk",
      channelName: "ch-1",
      token: "jwt-1",
    });
    video.joinLiveKit.mockResolvedValue(fakeSession());
  });

  /** Taps Home, captures the join callbacks, and drives the call to CONNECTED. */
  async function connectCall(): Promise<JoinCallbacks> {
    render(<App />);
    const tap = await screen.findByRole("button", { name: /tap to connect with the front desk/i });
    fireEvent.click(tap);

    await waitFor(() => expect(video.joinLiveKit).toHaveBeenCalledTimes(1));
    const opts = video.joinLiveKit.mock.calls[0]![0] as JoinCallbacks;

    // Flush the async continuation after `await joinLiveKit(...)` inside
    // App's onStartCall (sessionRef assignment + CALL_STARTED) before
    // simulating the agent joining — mirrors app-chat.test.tsx's connectCall.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => opts.onAgentJoined());
    expect(await screen.findByText("connected")).toBeTruthy();
    return opts;
  }

  it("a terminal drop from CONNECTED returns to a locked Home with the tap disabled and the reconnecting message shown", async () => {
    const opts = await connectCall();

    // Simulate LiveKit giving up on the LIVE call: a DISCONNECTED with a
    // reason other than "LEAVE" (a clean hang-up) is what interpretConnectionState
    // maps to "terminal".
    act(() => opts.onConnectionStateChange("DISCONNECTED", "CONNECTED", "UNKNOWN"));

    const home = await screen.findByRole("button", { name: /tap to connect with the front desk/i });
    expect(home.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(copy.home.reconnecting)).toBeTruthy();

    // Tapping during the lockout must NOT start a fresh call.
    fireEvent.click(home);
    expect(api.startCall).toHaveBeenCalledTimes(1); // only the earlier, pre-drop tap
  });

  it("the still-running incoming poll surfaces an agent call-back despite the lockout", async () => {
    const opts = await connectCall();

    // Arm the discovery poll's very next tick (fired the instant its effect
    // re-arms on the return-to-home transition below) with an agent
    // call-back — sidesteps waiting out the real 3s interval, mirroring
    // app-incoming-answer.test.tsx's "immediate first tick" trick.
    api.fetchIncomingCall.mockResolvedValue({ status: "ringing", call: { callId: "call-2", channelName: "ch-2" } });

    act(() => opts.onConnectionStateChange("DISCONNECTED", "CONNECTED", "UNKNOWN"));

    // The lockout does not stop the discovery poll: it discovers the agent's
    // call-back and flips straight to the Answer screen despite the tap
    // lockout still being in effect underneath.
    expect(await screen.findByRole("button", { name: /answer/i })).toBeTruthy();
  });

  it("a terminal drop while still ringing (not yet connected) keeps the existing apology behavior, unchanged", async () => {
    // Hold the join deliberately unresolved: the call must still be
    // "ringing" (never reached "connected") when the terminal event fires.
    video.joinLiveKit.mockReturnValueOnce(new Promise<KioskVideoSession>(() => {}));

    render(<App />);
    const tap = await screen.findByRole("button", { name: /tap to connect with the front desk/i });
    fireEvent.click(tap);

    await waitFor(() => expect(video.joinLiveKit).toHaveBeenCalledTimes(1));
    const opts = video.joinLiveKit.mock.calls[0]![0] as JoinCallbacks;

    act(() => opts.onConnectionStateChange("DISCONNECTED", "CONNECTED", "UNKNOWN"));

    // Falls through to the apology screen, same as before this task — no
    // lockout is armed for a pre-connect failure.
    expect(await screen.findByText("apology")).toBeTruthy();
  });
});
