// Task 7: video-call owns chat publish/subscribe. Verifies inbound identity
// derivation (kiosk -> "guest"), and outbound redaction + local echo + reliable send.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { encodeChat, decodeChat, CHAT_PROTOCOL_VERSION } from "@lc/shared";

const lkSession = vi.hoisted(() => {
  const session = {
    localVideo: { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ enabled: true })) },
    localAudioMediaTrack: { enabled: true } as unknown as MediaStreamTrack,
    mediaWarning: null as "camera" | "mic" | "both" | null,
    setMicMuted: vi.fn(async () => {}),
    sendData: vi.fn(),
    leave: vi.fn(async () => {}),
  };
  const joined: { opts: Record<string, unknown> | null } = { opts: null };
  const joinLiveKitCall = vi.fn(async (opts: Record<string, unknown>) => {
    joined.opts = opts;
    return session;
  });
  return { session, joinLiveKitCall, joined };
});
vi.mock("@/lib/video/livekit-session", () => ({ joinLiveKitCall: lkSession.joinLiveKitCall }));
vi.mock("@/components/call/playbook-panel", () => ({ PlaybookPanel: () => null }));
vi.mock("@/lib/captions/use-captions", () => ({
  useCaptions: () => ({ finals: [], partial: "", status: "idle" }),
}));

import { VideoCall } from "@/components/video-call/video-call";
import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";

function ChatProbe() {
  const s = useCallSurface();
  const snap = useSyncExternalStore(s.subscribeChat, s.getChatSnapshot);
  return (
    <div>
      <div data-testid="lines">{snap.lines.map((l) => `${l.from}:${l.text}`).join("|")}</div>
      <button onClick={() => s.callControls?.sendChat?.("card 4111 1111 1111 1111")}>send card</button>
    </div>
  );
}

describe("VideoCall — chat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    lkSession.joined.opts = null;
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channelName: "call_lk" }) });
      if (typeof url === "string" && url.includes("/api/video/token"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: "livekit", url: "wss://lk", channelName: "call_lk", token: "jwt" }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("maps an inbound kiosk message to a guest line", async () => {
    render(
      <CallSurfaceProvider>
        <VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" propertyId="prop-1" />
        <ChatProbe />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lkSession.joined.opts).not.toBeNull());
    const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: "m1", text: "1425 Oak St", ts: 1 };
    await act(async () => {
      (lkSession.joined.opts!.onData as (b: Uint8Array, id: string) => void)(encodeChat(env), "kiosk");
    });
    expect(screen.getByTestId("lines").textContent).toBe("guest:1425 Oak St");
  });

  it("redacts a card number on send, local-echoes it as agent, and sends reliably", async () => {
    render(
      <CallSurfaceProvider>
        <VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" propertyId="prop-1" />
        <ChatProbe />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lkSession.joined.opts).not.toBeNull());
    await act(async () => { screen.getByText("send card").click(); });
    expect(screen.getByTestId("lines").textContent).toBe("agent:card •••• (card number hidden)");
    expect(lkSession.session.sendData).toHaveBeenCalledTimes(1);
    const [bytes, reliable] = lkSession.session.sendData.mock.calls[0]!;
    expect(reliable).toBe(true);
    const decoded = decodeChat(bytes as Uint8Array);
    expect(decoded).toMatchObject({ type: "msg", text: "card •••• (card number hidden)" });
  });
});
