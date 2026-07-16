// Task 13: outbound "Calling…" phase. The agent originates the call — the row
// already exists as RINGING with the channel name in hand (start-outbound-video)
// — so VideoCall must NOT re-claim it via answer-video; it joins LiveKit
// directly on the `channelName` prop and waits for the kiosk to answer
// (onRemoteVideo/onRemoteAudioTrack), arming a 30s ring window that ends the
// call (NO_ANSWER via the already-generalized end-video, Task 8) if nobody
// picks up. Mirrors the mocking harness of video-call-livekit.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OUTBOUND_RING_WINDOW_MS } from "@lc/shared";

const lk = vi.hoisted(() => {
  const session = {
    localVideo: { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ enabled: true })) },
    localAudioMediaTrack: { enabled: true } as unknown as MediaStreamTrack,
    mediaWarning: null as "camera" | "mic" | "both" | null,
    setMicMuted: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
  };
  const joined: { opts: Record<string, unknown> | null } = { opts: null };
  const joinLiveKitCall = vi.fn(async (opts: Record<string, unknown>) => {
    joined.opts = opts;
    return session;
  });
  return { session, joinLiveKitCall, joined };
});
vi.mock("@/lib/video/livekit-session", () => ({ joinLiveKitCall: lk.joinLiveKitCall }));
vi.mock("@/components/call/playbook-panel", () => ({ PlaybookPanel: () => null }));
vi.mock("@/lib/captions/use-captions", () => ({
  useCaptions: () => ({ finals: [], partial: "", status: "idle" }),
}));

import { VideoCall } from "@/components/video-call/video-call";

function fakeRemoteHandle() {
  return { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ id: "guest-video" })) };
}

describe("VideoCall — outbound Calling phase (Task 13)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lk.joined.opts = null;
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video")) {
        // Should never be hit on the outbound path. Deliberately returns a
        // WRONG channel so a regression (calling this route by mistake) fails
        // loudly via the channel=call_abc token assertion below, rather than
        // silently passing.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channelName: "WRONG-inbound-claim" }),
        });
      }
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ provider: "livekit", url: "wss://lk", token: "jwt", channelName: "call_abc" }),
        });
      }
      // notes, end-video, etc.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("skips the answer-video claim, joins on the given channelName prop, and shows the Calling placeholder", async () => {
    const onClose = vi.fn();
    render(
      <VideoCall
        outbound
        channelName="call_abc"
        callId="c1"
        propertyName="Marlin"
        propertyId="p1"
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

    // No answer-video claim POST — the agent originated this call.
    expect(
      fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/api/calls/c1/answer-video")),
    ).toBe(false);

    // Token fetched for the channel the host handed down as a prop.
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/api/video/token") && u.includes("channel=call_abc"),
      ),
    ).toBe(true);
    expect(lk.joined.opts).toMatchObject({ url: "wss://lk", token: "jwt" });

    // The pre-connect "Calling…" placeholder is up, naming the property.
    const overlay = screen.getByTestId("outbound-calling-overlay");
    expect(overlay.textContent).toContain("Marlin");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("flips to the connected surface once the kiosk's remote video arrives", async () => {
    render(
      <VideoCall
        outbound
        channelName="call_abc"
        callId="c1"
        propertyName="Marlin"
        propertyId="p1"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());
    expect(screen.getByTestId("outbound-calling-overlay")).toBeTruthy();

    await act(async () => {
      (lk.joined.opts!.onRemoteVideo as (h: ReturnType<typeof fakeRemoteHandle>) => void)(fakeRemoteHandle());
    });

    // The calling placeholder is gone; the (always-mounted) stage is unobscured.
    expect(screen.queryByTestId("outbound-calling-overlay")).toBeNull();
    expect(screen.getByTestId("guest-video-stage")).toBeTruthy();
  });

  // The ring-window setTimeout is armed on MOUNT (real timers, well before any
  // fake-timer switch could adopt it), so — mirroring this file's sibling
  // video-call.test.tsx "auto-ends the call at the max-duration cap" test —
  // this spies on globalThis.setTimeout to capture and directly invoke the
  // OUTBOUND_RING_WINDOW_MS callback, rather than fighting real-vs-fake timer
  // adoption with vi.useFakeTimers().
  it("ends the call (NO_ANSWER via end-video) and closes when the 30s ring window elapses unanswered", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const onClose = vi.fn();
    render(
      <VideoCall
        outbound
        channelName="call_abc"
        callId="c1"
        propertyName="Marlin"
        propertyId="p1"
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

    // The ring-window timer is armed with OUTBOUND_RING_WINDOW_MS.
    await waitFor(() =>
      expect(setTimeoutSpy.mock.calls.some((c) => c[1] === OUTBOUND_RING_WINDOW_MS)).toBe(true),
    );
    const ringCall = setTimeoutSpy.mock.calls.find((c) => c[1] === OUTBOUND_RING_WINDOW_MS);
    const fireRingTimeout = ringCall![0] as () => void;

    // Fire the timeout: the call ends (end-video) and the overlay closes.
    await act(async () => {
      fireRingTimeout();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/api/calls/c1/end-video")),
    ).toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    setTimeoutSpy.mockRestore();
  });

  it("Cancel ends the call the same way the ring timeout does", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <VideoCall
        outbound
        channelName="call_abc"
        callId="c1"
        propertyName="Marlin"
        propertyId="p1"
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/api/calls/c1/end-video")),
      ).toBe(true),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // Regression guard: an inbound render (outbound omitted, defaulting false)
  // must still claim the call via answer-video exactly as before — proving the
  // outbound branch above didn't disturb the inbound path. (video-call.test.tsx
  // and video-call-livekit.test.tsx also exercise this inbound claim broadly;
  // this narrowly re-confirms it alongside the new outbound tests in this file.)
  it("inbound (outbound omitted) still POSTs answer-video to claim the call, and never shows the Calling placeholder", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channelName: "ch-inbound" }) });
      }
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ provider: "livekit", url: "wss://lk", token: "jwt", channelName: "ch-inbound" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<VideoCall callId="c2" propertyName="Marlin" propertyId="p1" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/api/calls/c2/answer-video")),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/api/video/token") && u.includes("channel=ch-inbound"),
      ),
    ).toBe(true);
    expect(screen.queryByTestId("outbound-calling-overlay")).toBeNull();
  });
});
