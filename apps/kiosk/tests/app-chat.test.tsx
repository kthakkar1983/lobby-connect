// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { decodeChat, encodeChat } from "@lc/shared";
import type { KioskConfig } from "@/types";
import type { JoinCallbacks, KioskVideoSession } from "@/lib/video/types";

// Covers Tasks 11+12: the kiosk's in-call chat state (App.tsx onData/sendChat/
// sendTyping) and the Option A UI it renders through the REAL Connected screen.
// Home/Ringing/Apology are irrelevant here and stay stubbed, mirroring
// app-video-join.test.tsx's mocking approach — Connected is intentionally NOT
// mocked so these tests exercise the real chat thread/input.

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

vi.mock("@/screens/Home", () => ({
  Home: ({ onCall }: { onCall: () => void }) => (
    <button type="button" onClick={onCall}>
      tap to connect
    </button>
  ),
}));
vi.mock("@/screens/Ringing", () => ({ Ringing: () => <div>ringing</div> }));
vi.mock("@/screens/Apology", () => ({ Apology: () => <div>apology</div> }));

import { App } from "@/App";

afterEach(cleanup);

function fakeSession(sendData: (bytes: Uint8Array, reliable: boolean) => void = vi.fn()): KioskVideoSession {
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
    sendData,
  };
}

/**
 * Taps "connect", captures the join callbacks passed to (mocked) joinLiveKit,
 * and drives the call all the way to CONNECTED — the real Connected screen
 * mounting is confirmed via its "Type" control, which only Connected's
 * CallControls renders (Ringing's CallControls has no onType).
 */
async function connectCall(sendData?: (bytes: Uint8Array, reliable: boolean) => void): Promise<JoinCallbacks> {
  api.fetchVideoToken.mockResolvedValue({
    provider: "livekit",
    url: "wss://lk",
    channelName: "ch-1",
    token: "jwt-1",
  });
  video.joinLiveKit.mockResolvedValue(fakeSession(sendData));

  render(<App />);
  const tap = await screen.findByRole("button", { name: /tap to connect/i });
  fireEvent.click(tap);

  await waitFor(() => expect(video.joinLiveKit).toHaveBeenCalledTimes(1));
  const opts = video.joinLiveKit.mock.calls[0]![0] as JoinCallbacks;

  // Flush the async continuation after `await joinLiveKit(...)` inside App's
  // onStartCall (sessionRef assignment + CALL_STARTED) before simulating the
  // agent joining: a macrotask boundary guarantees every queued microtask in
  // that chain has already run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() => opts.onAgentJoined());

  await screen.findByRole("button", { name: "Type" }); // real Connected mounted
  return opts;
}

describe("kiosk in-call chat (Tasks 11+12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchKioskConfig.mockResolvedValue(config);
    api.startCall.mockResolvedValue({ callId: "call-1", channelName: "ch-1" });
    api.endCall.mockResolvedValue(undefined);
    api.sendHeartbeat.mockResolvedValue(undefined);
  });

  it("an inbound agent message auto-opens chat and renders a received line", async () => {
    const opts = await connectCall();

    const env = { v: 1, type: "msg" as const, id: "m1", text: "hello from the front desk", ts: Date.now() };
    act(() => opts.onData?.(encodeChat(env), "agent-42"));

    expect(await screen.findByText("hello from the front desk")).toBeTruthy();
    expect(screen.getByPlaceholderText(/type a message/i)).toBeTruthy();
  });

  it("redacts a Luhn-valid card number before it ever reaches sendData", async () => {
    const sendData = vi.fn();
    await connectCall(sendData);

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    const input = await screen.findByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "4111 1111 1111 1111" } }); // Visa test PAN, Luhn-valid
    fireEvent.keyDown(input, { key: "Enter" });

    expect(sendData).toHaveBeenCalled();
    // The typing ping (reliable=false) fired first on the change event above —
    // find the reliable "msg" send specifically rather than assuming call order.
    const msgCall = sendData.mock.calls.find(([, reliable]) => reliable === true);
    expect(msgCall).toBeTruthy();
    const decoded = decodeChat(msgCall![0] as Uint8Array);
    const text = decoded?.type === "msg" ? decoded.text : "";
    expect(text).not.toContain("4111");
    expect(text).toMatch(/hidden/i);

    // The local echo in the thread is the SAME redacted text — never the raw PAN.
    expect(screen.queryByText(/4111/)).toBeNull();
    expect(screen.getByText(/hidden/i)).toBeTruthy();
  });
});
