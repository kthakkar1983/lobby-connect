/**
 * Task 12: startOutboundVideo + registerStartOutbound plumbing on
 * CallSurfaceProvider. Covers the contract a future property-card "Kiosk"
 * button (Task 14) and the video host (video-call-host.tsx) rely on:
 *
 *  - success: POSTs {propertyId} to /api/calls/start-outbound-video, and on
 *    {callId, channelName} invokes the registered OutboundStarter with the
 *    full {callId, channelName, propertyId, propertyName} args, returning
 *    {ok:true}.
 *  - a 409 (property already busy, or the agent already on a call) returns
 *    {ok:false, busy:true} and does NOT invoke the starter.
 *  - any other non-ok response, or a network failure, returns {ok:false} and
 *    does NOT invoke the starter.
 *
 * Mirrors call-surface-provider.test.tsx's harness style (render a small
 * consumer of useCallSurface(), drive it via button clicks, assert on
 * rendered text) rather than reaching into the provider's internals.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";

import {
  CallSurfaceProvider,
  useCallSurface,
  type OutboundStarter,
} from "@/components/dashboard/call-surface-provider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Harness: registers `onStart` as the outbound starter (mirroring what
 * video-call-host.tsx does), exposes a button that drives startOutboundVideo,
 * and renders its resolved result so tests can assert on it.
 */
function OutboundHarness({ onStart }: { onStart: OutboundStarter }) {
  const { registerStartOutbound, startOutboundVideo } = useCallSurface();
  const [result, setResult] = useState("none");

  useEffect(() => {
    registerStartOutbound(onStart);
    return () => registerStartOutbound(null);
  }, [registerStartOutbound, onStart]);

  return (
    <div>
      <div data-testid="result">{result}</div>
      <button
        onClick={async () => {
          const r = await startOutboundVideo("prop-1", "The Grand Hotel");
          setResult(JSON.stringify(r));
        }}
      >
        start outbound
      </button>
    </div>
  );
}

describe("CallSurfaceProvider — startOutboundVideo / registerStartOutbound", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("POSTs {propertyId}, invokes the registered starter, and resolves {ok:true}", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ callId: "call-9", channelName: "call_abc123" }),
    });
    const started: unknown[] = [];

    render(
      <CallSurfaceProvider>
        <OutboundHarness onStart={(args) => started.push(args)} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("start outbound").click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/calls/start-outbound-video",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: "prop-1" }),
      }),
    );

    await waitFor(() =>
      expect(started).toEqual([
        { callId: "call-9", channelName: "call_abc123", propertyId: "prop-1", propertyName: "The Grand Hotel" },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe(JSON.stringify({ ok: true })),
    );
  });

  it("a 409 response returns {ok:false, busy:true} and does NOT invoke the starter", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "A call is already active for this property" }),
    });
    const started: unknown[] = [];

    render(
      <CallSurfaceProvider>
        <OutboundHarness onStart={(args) => started.push(args)} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("start outbound").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe(
        JSON.stringify({ ok: false, busy: true }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(started).toEqual([]);
  });

  it("a non-ok, non-409 response returns {ok:false} and does NOT invoke the starter", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Could not start call" }),
    });
    const started: unknown[] = [];

    render(
      <CallSurfaceProvider>
        <OutboundHarness onStart={(args) => started.push(args)} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("start outbound").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe(JSON.stringify({ ok: false })),
    );
    expect(started).toEqual([]);
  });

  it("a network failure (fetch rejects) returns {ok:false} and does NOT invoke the starter", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const started: unknown[] = [];

    render(
      <CallSurfaceProvider>
        <OutboundHarness onStart={(args) => started.push(args)} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("start outbound").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe(JSON.stringify({ ok: false })),
    );
    expect(started).toEqual([]);
  });

  it("resolves {ok:true} even when no starter is registered (the ref is simply null)", async () => {
    // A future property-card click that races the video host's mount effect
    // must not throw — startOutboundRef.current is optional-chained.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ callId: "call-1", channelName: "ch-1" }),
    });

    function NakedConsumer() {
      const { startOutboundVideo } = useCallSurface();
      const [result, setResult] = useState("none");
      return (
        <div>
          <div data-testid="result">{result}</div>
          <button
            onClick={async () => setResult(JSON.stringify(await startOutboundVideo("prop-1", "Hotel A")))}
          >
            start outbound
          </button>
        </div>
      );
    }

    render(
      <CallSurfaceProvider>
        <NakedConsumer />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("start outbound").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("result").textContent).toBe(JSON.stringify({ ok: true })),
    );
  });
});
