/**
 * Migrated from incoming-video-banner.test.tsx (Phase 3, Task 7): the incoming
 * detection — realtime subscribe on the operator's private channel, tick()
 * refetch, reconnect catch-up, error resubscribe, 60s safety-net poll, unmount
 * cleanup, and the ringtone — moved verbatim into useIncomingVideoCalls. The
 * banner UI is gone; a tiny probe component renders the hook's output instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";

const channel = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  let statusCb: ((status: string) => void) | undefined;
  return {
    handlers,
    getStatusCb: () => statusCb,
    on: vi.fn(function (this: unknown, _type: string, opts: { event: string }, cb: (p: unknown) => void) {
      handlers[opts.event] = cb;
      return this;
    }),
    subscribe: vi.fn(function (this: unknown, cb: (status: string) => void) {
      statusCb = cb;
      return this;
    }),
  };
});
const removeChannel = vi.fn();
const setAuth = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    realtime: { setAuth: () => setAuth() },
    channel: () => channel,
    removeChannel: (ch: unknown) => removeChannel(ch),
  }),
}));
const ringtone = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/video/ringtone", () => ({
  createRingtone: () => ringtone,
}));

import {
  useIncomingVideoCalls,
  type IncomingVideoCall,
} from "@/lib/hooks/use-incoming-video-calls";

// Minimal consumer so the hook has a host component; renders the detected calls.
function Probe({ operatorId }: { operatorId: string }) {
  const { calls } = useIncomingVideoCalls(operatorId);
  return (
    <div>
      <span data-testid="count">{calls.length}</span>
      {calls.map((c: IncomingVideoCall) => (
        <span key={c.id} data-testid="call">
          {c.propertyName}
        </span>
      ))}
    </div>
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ calls: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  channel.on.mockClear();
  channel.subscribe.mockClear();
  removeChannel.mockClear();
  setAuth.mockClear();
  ringtone.start.mockClear();
  ringtone.stop.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useIncomingVideoCalls", () => {
  it("subscribes to the operator's private channel and authenticates", async () => {
    render(<Probe operatorId="op-1" />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    expect(setAuth).toHaveBeenCalled();
    expect(channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "calls-changed" },
      expect.any(Function),
    );
  });

  it("refetches on a calls-changed broadcast and rings", async () => {
    render(<Probe operatorId="op-1" />);
    await waitFor(() => expect(channel.on).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        calls: [
          {
            id: "c1",
            channelName: "ch",
            propertyName: "The Hotel",
            propertyId: "p1",
            ringStartedAt: null,
          },
        ],
      }),
    });
    await act(async () => {
      channel.handlers["calls-changed"]?.({});
    });
    expect(await screen.findByText("The Hotel")).toBeTruthy();
    // Rings while a call is waiting.
    await waitFor(() => expect(ringtone.start).toHaveBeenCalled());
  });

  it("stops ringing once the waiting call clears", async () => {
    render(<Probe operatorId="op-1" />);
    await waitFor(() => expect(channel.on).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        calls: [
          { id: "c1", channelName: "ch", propertyName: "The Hotel", propertyId: "p1", ringStartedAt: null },
        ],
      }),
    });
    await act(async () => channel.handlers["calls-changed"]?.({}));
    await waitFor(() => expect(ringtone.start).toHaveBeenCalled());
    // Next refetch returns no calls → ring stops.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ calls: [] }) });
    await act(async () => channel.handlers["calls-changed"]?.({}));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    await waitFor(() => expect(ringtone.stop).toHaveBeenCalled());
  });

  it("refetches once on SUBSCRIBED (reconnect catch-up)", async () => {
    render(<Probe operatorId="op-1" />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    fetchMock.mockClear();
    await act(async () => {
      channel.getStatusCb()?.("SUBSCRIBED");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resubscribes after a channel error", async () => {
    vi.useFakeTimers();
    render(<Probe operatorId="op-1" />);
    channel.getStatusCb()?.("CHANNEL_ERROR");
    // Removed the dead channel before the second subscribe heals it.
    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(channel.subscribe).toHaveBeenCalledTimes(2);
  });

  it("fires the 60s safety-net poll", async () => {
    vi.useFakeTimers();
    render(<Probe operatorId="op-1" />);
    // subscribe + the interval are set up synchronously in the effect — no
    // waitFor (which would hang under fake timers).
    expect(channel.subscribe).toHaveBeenCalled();
    fetchMock.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("removes the channel on unmount", async () => {
    const { unmount } = render(<Probe operatorId="op-1" />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
