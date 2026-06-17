/**
 * Regression: Softphone was losing typed roomNumber/notes when the call
 * disconnected via the Twilio SDK "disconnect" event.
 *
 * Root cause: endCall() was created with useCallback([roomNumber, notes]).
 * The "incoming" → "disconnect" listener chain was set up inside a
 * useEffect([], []) and captured the *initial* endCall (empty strings).
 * Even after the agent typed room + notes, the stale closure ran with "" —
 * notes were never saved.
 *
 * Fix: ref-mirror roomNumber/notes; endCall reads roomNumberRef.current /
 * notesRef.current (deps become []). The stale closure always reaches the
 * current values via the mutable refs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted: variables defined here are available inside vi.mock() factories.
const twilio = vi.hoisted(() => {
  const deviceListeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const callListeners: Record<string, () => void> = {};

  const fakeCall = {
    customParameters: {
      get: (key: string) => {
        if (key === "callId") return "call-42";
        if (key === "propertyName") return "The Sample Hotel";
        return "";
      },
    },
    accept: vi.fn(),
    reject: vi.fn(),
    disconnect: vi.fn(),
    mute: vi.fn(),
    on: (event: string, cb: () => void) => {
      callListeners[event] = cb;
    },
  };

  const MockDevice = vi.fn().mockImplementation(() => ({
    on: (event: string, cb: (arg?: unknown) => void) => {
      deviceListeners[event] = deviceListeners[event] ?? [];
      deviceListeners[event].push(cb);
    },
    register: vi.fn().mockImplementation(() =>
      // Fire "registered" after the async register resolves.
      Promise.resolve().then(() => {
        (deviceListeners["registered"] ?? []).forEach((cb) => cb());
      }),
    ),
    destroy: vi.fn(),
    updateToken: vi.fn(),
  }));

  const fireIncoming = () => {
    (deviceListeners["incoming"] ?? []).forEach((cb) => cb(fakeCall));
  };

  const fireDisconnect = () => {
    callListeners["disconnect"]?.();
  };

  return { MockDevice, fakeCall, fireIncoming, fireDisconnect };
});

vi.mock("@twilio/voice-sdk", () => ({
  Device: twilio.MockDevice,
}));

// attachTokenAutoRefresh only sets up a tokenWillExpire listener — safe to
// let through, but mocking avoids any indirect fetch calls in tests.
vi.mock("@/lib/voice/device-resilience", () => ({
  attachTokenAutoRefresh: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { Softphone } from "@/components/softphone/softphone";

describe("Softphone — stale-closure regression (H1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "test-token" }),
        });
      }
      if (url.endsWith("/playbook")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hasPlaybook: false }),
        });
      }
      // presence, answered, notes, emergency
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("saves typed roomNumber+notes when call disconnects, not stale empty strings", async () => {
    const user = userEvent.setup();

    render(<Softphone role="AGENT" />);

    // Wait for Device.register() to fire "registered" → phase = "ready".
    await waitFor(() =>
      screen.getByText(/Accepting calls/i),
    );

    // Simulate an incoming call.
    await act(async () => {
      twilio.fireIncoming();
    });

    // Accept the call.
    await user.click(screen.getByText("Accept"));

    // Type room number and notes AFTER accepting — this is where the stale
    // closure bit: state updates happened after disconnect was registered.
    await user.type(screen.getByPlaceholderText("Room #"), "507");
    await user.type(screen.getByPlaceholderText("Call notes"), "VIP guest");

    // Simulate the remote party hanging up (Twilio SDK "disconnect" event).
    await act(async () => {
      twilio.fireDisconnect();
    });

    // Notes API must have been called with the TYPED values.
    const notesCalls = fetchMock.mock.calls.filter(
      (args) => (args[0] as string) === "/api/calls/notes",
    );
    expect(notesCalls).toHaveLength(1);

    const firstCall = notesCalls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse((firstCall?.[1] as { body: string }).body) as {
      callId: string;
      roomNumber: string;
      notes: string;
    };
    expect(body.roomNumber).toBe("507");
    expect(body.notes).toBe("VIP guest");
  });

  it("shows a preserved-text banner when the notes save fails, and Retry re-POSTs", async () => {
    const user = userEvent.setup();
    // Notes endpoint always 500s; everything else ok.
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t" }) });
      }
      if (url === "/api/calls/notes") return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, status: 200 });
    });

    render(<Softphone role="AGENT" />);
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await user.click(screen.getByText("Accept"));
    await user.type(screen.getByPlaceholderText("Room #"), "507");
    await user.type(screen.getByPlaceholderText("Call notes"), "VIP guest");
    await act(async () => twilio.fireDisconnect());

    // Banner appears after retries are exhausted (real backoff ~0.9s).
    await waitFor(
      () => {
        const el = screen.queryByText(/Couldn.t save notes/i);
        expect(el).toBeTruthy();
      },
      { timeout: 4000 },
    );

    // Let the notes endpoint succeed, click Retry, banner clears.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ ok: true, status: url === "/api/calls/notes" ? 204 : 200 }),
    );
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.queryByText(/Couldn.t save notes/i)).toBeNull());
  });

  it("renders the unified in-call overlay (with the playbook) after answering", async () => {
    const user = userEvent.setup();
    render(<Softphone role="AGENT" />);
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await user.click(screen.getByText("Accept"));

    // Overlay chrome appears with the property name from the incoming call.
    await waitFor(() => screen.getByText(/On call · The Sample Hotel/i));
    // The in-call controls (now inside the overlay) are still present.
    expect(screen.getByPlaceholderText("Room #")).toBeTruthy();
    expect(screen.getByText("Hang up")).toBeTruthy();
  });
});
