// Task 15 (outbound-video-calls plan): CallBackShortcut renders a floating
// "Call back" pill for RECONNECT_WINDOW_MS after any call ends (only when the
// ended call carried a propertyId), driven entirely by
// CallSurfaceProvider.recentlyEnded. Rather than hand-mocking the surface
// (which would duplicate the provider's edge-detection logic as test
// fixtures — and risk testing the mock, not the wiring), these tests render
// the REAL CallSurfaceProvider and drive `active` transitions through a small
// Publisher harness, mirroring call-surface-provider.test.tsx's own style.
// That lets one set of tests exercise the component's render/click/error
// behavior AND the provider's recentlyEnded lifecycle (fires once on the
// ended edge, auto-clears, clears early on a new call, no leaked timer) as a
// real integration.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { RECONNECT_WINDOW_MS } from "@lc/shared";

const { fetchRemoteCredentials, launchRustdesk } = vi.hoisted(() => ({
  fetchRemoteCredentials: vi.fn(),
  launchRustdesk: vi.fn(),
}));
// The provider's Answer-time remote-access pre-warm effect fires for ANY
// active call carrying a propertyId (see call-surface-provider.tsx) — every
// call published below does, so this must be mocked or the pre-warm effect
// would hit a real, unmocked fetchRemoteCredentials. Mirrors
// call-surface-provider.test.tsx's own preamble.
vi.mock("@/lib/remote-access/connect", () => ({
  fetchRemoteCredentials: (...args: unknown[]) => fetchRemoteCredentials(...args),
  launchRustdesk: (...args: unknown[]) => launchRustdesk(...args),
}));

import {
  CallSurfaceProvider,
  useCallSurface,
  type ActiveCallInfo,
} from "@/components/dashboard/call-surface-provider";
import { CallBackShortcut } from "@/components/dashboard/call-back-shortcut";

const call1: ActiveCallInfo = {
  callId: "call-1",
  channel: "VIDEO",
  propertyId: "p1",
  propertyName: "Marlin",
  onHold: false,
  answeredAt: 1_000,
  timeZone: null,
};

const call2: ActiveCallInfo = {
  callId: "call-2",
  channel: "VIDEO",
  propertyId: "p2",
  propertyName: "Seaside",
  onHold: false,
  answeredAt: 2_000,
  timeZone: null,
};

const callNoProperty: ActiveCallInfo = {
  callId: "call-3",
  channel: "VIDEO",
  propertyId: null,
  propertyName: "Unknown property",
  onHold: false,
  answeredAt: 3_000,
  timeZone: null,
};

/** Drives active-call transitions through the real provider (publishActive),
 *  mirroring call-surface-provider.test.tsx's own Publisher harness. */
function CallPublisher() {
  const { publishActive } = useCallSurface();
  return (
    <div>
      <button onClick={() => publishActive("VIDEO", call1)}>start call 1</button>
      <button onClick={() => publishActive("VIDEO", call2)}>start call 2</button>
      <button onClick={() => publishActive("VIDEO", callNoProperty)}>start call (no property)</button>
      <button onClick={() => publishActive("VIDEO", null)}>end call</button>
    </div>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing configured — none of these tests exercise Connect/prewarm
  // itself, they just need the pre-warm effect to resolve without hitting a
  // real network call.
  fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: true });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("CallBackShortcut", () => {
  it("renders nothing outside a CallSurfaceProvider", () => {
    const { container } = render(<CallBackShortcut />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing before any call has ended", () => {
    render(
      <CallSurfaceProvider>
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders nothing while a call is active", async () => {
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    expect(screen.queryByRole("button", { name: "Call Marlin back" })).toBeNull();
  });

  it("shows a 'Call <property> back' pill on the active-call-to-null edge", async () => {
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });
    expect(screen.getByRole("button", { name: "Call Marlin back" })).toBeTruthy();
  });

  it("does not show the pill when the ended call had no propertyId", async () => {
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call (no property)").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });
    // Only the publisher's own four control buttons — no pill appeared.
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["start call 1", "start call 2", "start call (no property)", "end call"]);
  });

  it("clicking the pill calls the real startOutboundVideo, POSTing the ended call's propertyId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ callId: "call-9", channelName: "ch-9" }),
    });
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Call Marlin back" }).click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/calls/start-outbound-video",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: "p1" }),
      }),
    );
  });

  it("the pill auto-clears after RECONNECT_WINDOW_MS elapses", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });
    expect(screen.getByRole("button", { name: "Call Marlin back" })).toBeTruthy();

    // The timer is armed on a real setTimeout well before any fake-timer
    // switch could adopt it, so — mirroring video-call-outbound.test.tsx's
    // OUTBOUND_RING_WINDOW_MS idiom — this spies on globalThis.setTimeout and
    // invokes the captured callback directly, rather than fighting real-vs-
    // fake timer adoption with vi.useFakeTimers().
    const reconnectCall = setTimeoutSpy.mock.calls.find((c) => c[1] === RECONNECT_WINDOW_MS);
    expect(reconnectCall).toBeTruthy();
    const fireClear = reconnectCall![0] as () => void;
    await act(async () => {
      fireClear();
    });

    expect(screen.queryByRole("button", { name: "Call Marlin back" })).toBeNull();
  });

  it("clears the pill immediately AND cancels the pending auto-clear timer when a new call goes active (no leak)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });
    expect(screen.getByRole("button", { name: "Call Marlin back" })).toBeTruthy();

    const idx = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === RECONNECT_WINDOW_MS);
    expect(idx).toBeGreaterThanOrEqual(0);
    const timerId = setTimeoutSpy.mock.results[idx]!.value;

    // A new call for a DIFFERENT property goes active with no intervening
    // null (the call-B-overwrites-call-A transition) — the stale pill must
    // not survive into it, and the 10s timer that would have cleared it must
    // be CANCELED, not left to fire a later no-op (a leak).
    await act(async () => {
      screen.getByText("start call 2").click();
    });

    expect(screen.queryByRole("button", { name: "Call Marlin back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Call Seaside back" })).toBeNull(); // on a call — no pill
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
  });

  it("a non-busy failure shows the try-again message and leaves the pill up", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Call Marlin back" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Could not start the call. Try again."),
    );
    expect(screen.getByRole("button", { name: "Call Marlin back" })).toBeTruthy();
  });

  it("a busy (409, property/agent already on a call) failure shows the already-on-a-call message", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({}) });
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Call Marlin back" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Already on a call. Try again shortly."),
    );
  });

  it("does not carry a stale error from Property A's failed call-back onto a later, unrelated Property B pill", async () => {
    // The bug this pins: CallBackShortcut is a SINGLE persistent instance whose
    // subject changes over its lifetime, so a stale error left in local state
    // after A's window lapsed would render under a later B pill (against which
    // no attempt was ever made). The fix resets error/busy on each new pill.
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({}) });
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );

    // Cycle 1: Property A ends → click → 409 → the error renders.
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Call Marlin back" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Already on a call. Try again shortly."),
    );

    // Cycle 2: a new, unrelated call with Property B ends. Publishing
    // active(B)-then-null forces the recentlyEnded null->{B} transition (a
    // fresh pill) directly, the same edge the 10s auto-clear would reach.
    await act(async () => {
      screen.getByText("start call 2").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });

    // The B pill renders WITHOUT A's stale error.
    expect(screen.getByRole("button", { name: "Call Seaside back" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the pill while the request is in flight, then re-enables on completion", async () => {
    let resolveFetch!: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(
      <CallSurfaceProvider>
        <CallPublisher />
        <CallBackShortcut />
      </CallSurfaceProvider>,
    );
    await act(async () => {
      screen.getByText("start call 1").click();
    });
    await act(async () => {
      screen.getByText("end call").click();
    });

    const btn = screen.getByRole("button", { name: "Call Marlin back" }) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(btn.disabled).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ callId: "call-9", channelName: "ch-9" }),
      });
    });
    expect(btn.disabled).toBe(false);
  });
});
