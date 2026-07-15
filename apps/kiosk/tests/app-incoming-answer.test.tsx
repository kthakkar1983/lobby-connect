// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KioskConfig } from "@/types";
import type { JoinCallbacks, KioskVideoSession } from "@/lib/video/types";

// Covers Task 10: the kiosk's home-only incoming-call discovery poll
// (App.tsx's fetchIncomingCall effect) and the Answer flow (App.tsx onAnswer)
// — an agent-initiated OUTBOUND call is discovered while idle on Home, the
// guest taps Answer, answerCall() claims it, and the kiosk joins the SAME
// LiveKit room the agent is already in. Mirrors app-video-join.test.tsx's
// harness: Home/Ringing/Connected/Apology are stubbed (irrelevant here), but
// IncomingCall is left real since it's the screen under test.

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

// The real screens render `motion`-driven connection lines that are irrelevant
// here — stub them to inert nodes so the harness stays focused on the poll +
// answer routing. IncomingCall is deliberately NOT mocked: it's the screen
// under test.
vi.mock("@/screens/Home", () => ({ Home: () => <div>home</div> }));
vi.mock("@/screens/Ringing", () => ({ Ringing: () => <div>ringing</div> }));
vi.mock("@/screens/Connected", () => ({ Connected: () => <div>connected</div> }));
vi.mock("@/screens/Apology", () => ({ Apology: () => <div>apology</div> }));

// Imported after the mocks are registered (both are hoisted by Vitest, mocks first).
import { App } from "@/App";

afterEach(cleanup);

// A session shape App can consume post-join — same minimal shape the
// provider-agnostic KioskVideoSession type promises (mirrors app-video-join's
// fakeSession/app-chat's fakeSession helpers).
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

describe("kiosk incoming-call discovery poll + Answer flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.sendHeartbeat.mockResolvedValue(undefined);
    api.endCall.mockResolvedValue(undefined);
    // The poll's "immediate first tick" (no need to wait out the real 3s
    // interval — see App.tsx's discovery-poll effect) finds a ringing call.
    api.fetchIncomingCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
  });

  it("polls fetchIncomingCall while idle on Home and renders the IncomingCall screen", async () => {
    render(<App />);

    expect(await screen.findByText(/the front desk is calling/i)).toBeTruthy();
    expect(api.fetchIncomingCall).toHaveBeenCalled();
    // Never rings while it isn't idle-on-Home — nothing to assert on directly
    // here (that's the reducer's own INCOMING_CALL home-only guard, covered in
    // tests/state/call-machine.test.ts), but this confirms the discovery path
    // itself is wired end to end.
  });

  it("Answer claims the call, joins the same LiveKit room, and proceeds to connected", async () => {
    api.answerCall.mockResolvedValue({ channelName: "ch-1" });
    api.fetchVideoToken.mockResolvedValue({
      provider: "livekit",
      url: "wss://lk",
      channelName: "ch-1",
      token: "jwt-1",
    });
    video.joinLiveKit.mockResolvedValue(fakeSession());

    render(<App />);

    const answerBtn = await screen.findByRole("button", { name: /answer/i });
    fireEvent.click(answerBtn);

    // answerCall claims the specific call the poll discovered.
    await waitFor(() => expect(api.answerCall).toHaveBeenCalledWith("call-1"));

    // The reused "ringing" (connecting) screen shows once the claim succeeds,
    // before the token fetch / LiveKit join resolve.
    expect(await screen.findByText("ringing")).toBeTruthy();

    await waitFor(() => expect(video.joinLiveKit).toHaveBeenCalledTimes(1));
    // Token is fetched for the CLAIMED channel (answerCall's response), not a
    // stale client-side value.
    expect(api.fetchVideoToken).toHaveBeenCalledWith("ch-1", expect.any(Number));
    expect(video.joinLiveKit.mock.calls[0]![0]).toMatchObject({ url: "wss://lk", token: "jwt-1" });

    const opts = video.joinLiveKit.mock.calls[0]![0] as JoinCallbacks;
    // Flush the async continuation after `await joinLiveKit(...)` inside
    // App's onAnswer (sessionRef assignment) before simulating the agent's
    // track — the agent is ALREADY in the room, so onAgentJoined (not a ring
    // timeout) is what promotes ringing -> connected here.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => opts.onAgentJoined());

    expect(await screen.findByText("connected")).toBeTruthy();
  });

  it("a gone/claimed-elsewhere call (answerCall -> null) returns home without joining", async () => {
    // First poll tick discovers the call (so Answer is tappable); once the
    // claim fails and the reducer returns home, the effect re-arms and polls
    // again — resolve every poll after the first to "nothing ringing" so the
    // screen doesn't immediately cycle back to "incoming".
    api.fetchIncomingCall
      .mockResolvedValueOnce({ callId: "call-1", channelName: "ch-1" })
      .mockResolvedValue(null);
    api.answerCall.mockResolvedValue(null);

    render(<App />);

    const answerBtn = await screen.findByRole("button", { name: /answer/i });
    fireEvent.click(answerBtn);

    await waitFor(() => expect(api.answerCall).toHaveBeenCalledWith("call-1"));
    expect(await screen.findByText("home")).toBeTruthy();
    expect(api.fetchVideoToken).not.toHaveBeenCalled();
    expect(video.joinLiveKit).not.toHaveBeenCalled();
  });

  // Regression: onAnswer must dispatch ANSWER (incoming -> ringing) SYNCHRONOUSLY
  // before `await answerCall`, exactly as onStartCall dispatches TAP_CALL before
  // its first await. Otherwise the Answer button stays mounted for the whole
  // claim round-trip and a double-tap orphans an IN_PROGRESS call: tap#1 wins the
  // server claim then bails on a now-stale aborted() check (never joining) while
  // tap#2 gets the 409 and returns home. Holding answerCall pending exposes that
  // window — with the fix the incoming screen is already gone, so there's no
  // button left to tap a second time.
  it("moves off the incoming screen before the claim resolves, so a double-tap can't orphan a call", async () => {
    // Hold the first claim pending: this IS the double-tap window.
    let resolveClaim: (v: { channelName: string } | null) => void = () => {};
    api.answerCall.mockReturnValueOnce(
      new Promise<{ channelName: string } | null>((r) => {
        resolveClaim = r;
      }),
    );
    api.fetchVideoToken.mockResolvedValue({
      provider: "livekit",
      url: "wss://lk",
      channelName: "ch-1",
      token: "jwt-1",
    });
    video.joinLiveKit.mockResolvedValue(fakeSession());

    render(<App />);

    const answerBtn = await screen.findByRole("button", { name: /answer/i });
    fireEvent.click(answerBtn);

    // With the claim still pending, the incoming screen (Answer button) has
    // ALREADY been replaced by the reused "ringing" connecting screen. Under the
    // buggy ordering the button would still be here for the whole round-trip.
    await waitFor(() => expect(screen.queryByRole("button", { name: /answer/i })).toBeNull());
    expect(screen.getByText("ringing")).toBeTruthy();

    // A second tap on the now-detached button reaches no React handler (root
    // event delegation) — no competing claim generation is ever started.
    fireEvent.click(answerBtn);
    expect(api.answerCall).toHaveBeenCalledTimes(1);

    // Settle the held claim so the flow finishes cleanly (no dangling promise).
    await act(async () => {
      resolveClaim({ channelName: "ch-1" });
    });
    await waitFor(() => expect(video.joinLiveKit).toHaveBeenCalledTimes(1));
  });
});
