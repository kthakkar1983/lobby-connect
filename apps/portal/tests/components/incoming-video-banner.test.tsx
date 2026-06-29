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
vi.mock("@/lib/video/ringtone", () => ({
  createRingtone: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/lib/video/audio-unlock", () => ({ unlockAudioPlayback: vi.fn() }));

import { IncomingVideoBanner } from "@/components/video-call/incoming-video-banner";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ calls: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  channel.on.mockClear();
  channel.subscribe.mockClear();
  removeChannel.mockClear();
  setAuth.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("IncomingVideoBanner Realtime", () => {
  it("subscribes to the operator's private channel and authenticates", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    expect(setAuth).toHaveBeenCalled();
    expect(channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "calls-changed" },
      expect.any(Function),
    );
  });

  it("refetches on a calls-changed broadcast and rings", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.on).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ calls: [{ id: "c1", channelName: "ch", propertyName: "The Hotel" }] }),
    });
    await act(async () => {
      channel.handlers["calls-changed"]?.({});
    });
    expect(await screen.findByText("The Hotel")).toBeTruthy();
  });

  it("refetches once on SUBSCRIBED (reconnect catch-up)", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    fetchMock.mockClear();
    await act(async () => {
      channel.getStatusCb()?.("SUBSCRIBED");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resubscribes after a channel error", async () => {
    vi.useFakeTimers();
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
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
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
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
    const { unmount } = render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
