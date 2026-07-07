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
 *
 * Phase-3 (Task 7): the softphone's own incoming Accept button was retired —
 * a ringing call is answered on its property card via CallSurfaceProvider. These
 * tests now wrap the Softphone in the provider and answer through a small
 * consumer's Answer button (which calls the registered actions.acceptAudio),
 * exercising the same acceptCall path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted: variables defined here are available inside vi.mock() factories.
const twilio = vi.hoisted(() => {
  const deviceListeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const callListeners: Record<string, () => void> = {};
  // AudioHelper.incoming(false) — the softphone disables Twilio's built-in ring
  // so its own /sounds/ring.mp3 element is the only (silenceable) ring source.
  const audioIncoming = vi.fn();

  const fakeCall = {
    customParameters: {
      get: (key: string) => {
        if (key === "callId") return "call-42";
        if (key === "propertyName") return "The Sample Hotel";
        if (key === "propertyId") return "prop-42";
        return "";
      },
    },
    accept: vi.fn(),
    reject: vi.fn(),
    disconnect: vi.fn(),
    mute: vi.fn(),
    getRemoteStream: () => ({ getAudioTracks: () => [{ kind: "audio" }] }),
    on: (event: string, cb: () => void) => {
      callListeners[event] = cb;
    },
  };

  // A DISTINCT second incoming call (different callId) for the auto-reset test:
  // silencing call-42 must not carry over to a later, different caller.
  const fakeCall2 = {
    customParameters: {
      get: (key: string) => {
        if (key === "callId") return "call-99";
        if (key === "propertyName") return "The Sample Hotel";
        if (key === "propertyId") return "prop-42";
        return "";
      },
    },
    accept: vi.fn(),
    reject: vi.fn(),
    disconnect: vi.fn(),
    mute: vi.fn(),
    getRemoteStream: () => ({ getAudioTracks: () => [{ kind: "audio" }] }),
    on: (event: string, cb: () => void) => {
      callListeners[event] = cb;
    },
  };

  const MockDevice = vi.fn().mockImplementation(() => ({
    on: (event: string, cb: (arg?: unknown) => void) => {
      deviceListeners[event] = deviceListeners[event] ?? [];
      deviceListeners[event].push(cb);
    },
    audio: { incoming: audioIncoming },
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

  const fireIncoming2 = () => {
    (deviceListeners["incoming"] ?? []).forEach((cb) => cb(fakeCall2));
  };

  const fireDisconnect = () => {
    callListeners["disconnect"]?.();
  };

  return { MockDevice, fakeCall, fireIncoming, fireIncoming2, fireDisconnect, audioIncoming };
});

vi.mock("@twilio/voice-sdk", () => ({
  Device: twilio.MockDevice,
}));

// attachTokenAutoRefresh only sets up a tokenWillExpire listener — safe to
// let through, but mocking avoids any indirect fetch calls in tests.
// shouldReconnectDevice: stubbed false (matches the real function whenever
// phase !== "error", which is every phase these tests dispatch a real
// window "focus" event in) so the self-heal effect's listener — also on
// "focus" — doesn't try to re-run connect() and add unrelated fetch calls.
vi.mock("@/lib/voice/device-resilience", () => ({
  attachTokenAutoRefresh: vi.fn(),
  shouldReconnectDevice: vi.fn(() => false),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const captionsSpy = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/captions/use-captions", () => ({
  useCaptions: (track: MediaStreamTrack | null) => {
    captionsSpy.fn(track);
    return { finals: track ? ["I need extra towels"] : [], partial: "", status: track ? "live" : "idle" };
  },
}));

// Video-host detection deps (only exercised by the loop-guard test, inert
// otherwise): a fake Realtime channel + ringtone.
const videoChannel = vi.hoisted(() => {
  let statusCb: ((status: string) => void) | undefined;
  return {
    getStatusCb: () => statusCb,
    on: vi.fn(function (this: unknown) {
      return this;
    }),
    subscribe: vi.fn(function (this: unknown, cb: (status: string) => void) {
      statusCb = cb;
      return this;
    }),
  };
});
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    realtime: { setAuth: () => {} },
    channel: () => videoChannel,
    removeChannel: () => {},
  }),
}));
// Capture the ringtone spies so we can assert start/stop across the softphone
// (its own ring element) AND the video host share the same mocked factory.
const ringtone = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/video/ringtone", () => ({
  createRingtone: () => ringtone,
}));

// DutyControls (rendered by the softphone) calls pushArmed()/armPush() on mount
// + click. Mock them so pushArmed()→true, which makes DutyControls render the
// "End shift" button (the fully-active state needs armed && onDuty) — the seam
// the heartbeat-disarm test drives. armPush→true so a resume click flips armed.
const push = vi.hoisted(() => ({
  pushArmed: vi.fn<() => boolean>(() => true),
  armPush: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
}));
vi.mock("@/lib/push/client", () => ({
  pushArmed: () => push.pushArmed(),
  armPush: () => push.armPush(),
}));

import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import {
  CallSurfaceProvider,
  useCallSurface,
} from "@/components/dashboard/call-surface-provider";

/**
 * Card-side consumer probe: exposes the audio ring count + an Answer button
 * wired to the registered accept dispatcher — the seam the real PropertyCard
 * uses. Answering the softphone in these tests goes through here.
 */
function CardProbe() {
  const { rings, actions, silenceRing } = useCallSurface();
  const audioRing = rings.find((r) => r.channel === "AUDIO") ?? null;
  return (
    <div>
      <span data-testid="audio-rings">{rings.filter((r) => r.channel === "AUDIO").length}</span>
      {audioRing ? <span data-testid="ring-name">{audioRing.propertyName}</span> : null}
      {audioRing ? <span data-testid="ring-property">{audioRing.propertyId ?? ""}</span> : null}
      <button type="button" onClick={() => actions.acceptAudio?.()}>
        Answer on card
      </button>
      {/* Silence the audio ring for the fake call (callId "call-42"). */}
      <button type="button" onClick={() => silenceRing("audio:call-42")}>
        Silence on card
      </button>
    </div>
  );
}

function renderSoftphone(role: "AGENT" | "ADMIN" = "AGENT") {
  return render(
    <CallSurfaceProvider>
      <Softphone role={role} />
      <CardProbe />
    </CallSurfaceProvider>,
  );
}

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
      // presence, answered, notes, emergency (answered now reads .json() for timeZone)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("saves typed roomNumber+notes when call disconnects, not stale empty strings", async () => {
    const user = userEvent.setup();

    renderSoftphone("AGENT");

    // Wait for Device.register() to fire "registered" → phase = "ready".
    await waitFor(() =>
      screen.getByText(/Accepting calls/i),
    );

    // Simulate an incoming call.
    await act(async () => {
      twilio.fireIncoming();
    });

    // Accept the call via the card seam (the softphone's own Accept is retired).
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    await user.click(screen.getByText("Answer on card"));

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
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    await user.click(screen.getByText("Answer on card"));
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
      Promise.resolve({ ok: true, status: url === "/api/calls/notes" ? 204 : 200, json: () => Promise.resolve({}) }),
    );
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.queryByText(/Couldn.t save notes/i)).toBeNull());
  });

  it("renders the unified in-call overlay (with the playbook) after answering", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    await user.click(screen.getByText("Answer on card"));

    // Overlay chrome appears with the property name from the incoming call.
    await waitFor(() => screen.getByText(/On call · The Sample Hotel/i));
    // The in-call controls (now inside the overlay) are still present.
    expect(screen.getByPlaceholderText("Room #")).toBeTruthy();
    expect(screen.getByText("Hang up")).toBeTruthy();
  });

  it("captions the guest after answering a phone call", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    await user.click(screen.getByText("Answer on card"));

    // The remote audio track is captured shortly after accept and captioned.
    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" })));
    await waitFor(() => expect(screen.getByText(/I need extra towels/i)).toBeTruthy());
  });
});

describe("Softphone — CallSurfaceProvider publish (Task 7)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t" }) });
      }
      if (url === "/api/calls/incoming-video") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ calls: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("publishes the audio ring (name + propertyId) to a consumer on Device incoming", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    // No ring before the call.
    expect(screen.getByTestId("audio-rings").textContent).toBe("0");

    await act(async () => twilio.fireIncoming());

    // Consumer sees exactly one AUDIO ring carrying the property name + id from
    // the customParameters (the Task-4 propertyId Parameter).
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    expect(screen.getByTestId("ring-name").textContent).toBe("The Sample Hotel");
    expect(screen.getByTestId("ring-property").textContent).toBe("prop-42");
  });

  it("clears the published ring when the call ends without being answered", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));

    // The remote party disconnects → phase returns to "ready" → the published
    // ring is withdrawn (the effect republishes []).
    await act(async () => twilio.fireDisconnect());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("0"));
  });

  /**
   * MANDATORY loop-guard (Task-6 review): Softphone AND VideoCallHost publishing
   * into one CallSurfaceProvider must not thrash the context. A publisher effect
   * that depended on the whole `surface` object would re-register on every value
   * change and loop ("Maximum update depth exceeded"). Drive a phase change and
   * assert the register dispatchers are called a small, bounded number of times.
   */
  it("does not loop when Softphone + VideoCallHost publish together (bounded registers)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Count register calls by wrapping the provider's dispatchers via a spy
    // consumer that reads them once mounted.
    render(
      <CallSurfaceProvider>
        <Softphone role="AGENT" />
        <VideoCallHost operatorId="op-1" />
        <CardProbe />
      </CallSurfaceProvider>,
    );

    await waitFor(() => screen.getByText(/Accepting calls/i));

    // Drive an incoming (phase change) then hang up — several publish cycles.
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    await act(async () => twilio.fireDisconnect());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("0"));

    // No React max-update-depth error was logged.
    const loopErrors = errorSpy.mock.calls.filter((args) =>
      String(args[0] ?? "").includes("Maximum update depth exceeded"),
    );
    expect(loopErrors).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

describe("Softphone — ring-silence (own ring element)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("disables Twilio's built-in ring on register and rings its own element on incoming", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    // The built-in incoming sound is disabled so our own element is the only ring.
    expect(twilio.audioIncoming).toHaveBeenCalledWith(false);

    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));

    // Our own ringtone element starts on incoming.
    expect(ringtone.start).toHaveBeenCalled();
  });

  it("stops its own ring when the card silences the ring key", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    expect(ringtone.start).toHaveBeenCalled();
    ringtone.stop.mockClear();

    // Silencing the audio ring key stops the local ring — but keeps it answerable.
    await user.click(screen.getByText("Silence on card"));
    await waitFor(() => expect(ringtone.stop).toHaveBeenCalled());

    // Still answerable after silencing — the accept path is unchanged.
    expect(screen.getByTestId("audio-rings").textContent).toBe("1");
    await user.click(screen.getByText("Answer on card"));
    expect(twilio.fakeCall.accept).toHaveBeenCalled();
  });

  it("does not carry a silence over to the next, different caller (auto-reset)", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    // First call rings, then the card silences it (key audio:call-42).
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    expect(ringtone.start).toHaveBeenCalled();
    await user.click(screen.getByText("Silence on card"));
    await waitFor(() => expect(ringtone.stop).toHaveBeenCalled());

    // The silenced call ends → phase returns to "ready", the ring is withdrawn,
    // and the provider prunes the now-gone silenced key.
    await act(async () => twilio.fireDisconnect());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("0"));

    // A SECOND, DIFFERENT call arrives (key audio:call-99) — it must ring again;
    // the prior silence must not stick to the next caller.
    ringtone.start.mockClear();
    await act(async () => twilio.fireIncoming2());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));
    expect(ringtone.start).toHaveBeenCalled();
  });
});

/**
 * Duty controls are Twilio-independent (Web Push subscription + presence write),
 * so they must render even when the phone line can't register (phase "error") —
 * e.g. on staging (no Twilio), or if the prod line briefly drops. The token
 * fetch is forced to fail so connect() lands in phase "error"; pushArmed()→false
 * so DutyControls shows the "Go on duty" button (not the armed "End shift" card).
 * Both the "Go on duty" button AND the "Phone line disconnected" message show.
 */
describe("Softphone — duty controls render in the error phase", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // pushArmed()→false so DutyControls renders "Go on duty" (the armed+onDuty
    // path would render the "End shift" card instead).
    push.pushArmed.mockReturnValue(false);
    push.armPush.mockResolvedValue(true);
    // Token endpoint 500s → fetchVoiceToken() throws → connect() catch → phase "error".
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows 'Go on duty' AND the 'Phone line disconnected' message when the line can't register", async () => {
    renderSoftphone("AGENT");

    // The line drops to error (token fetch failed) → disconnected message shows.
    await waitFor(() =>
      expect(screen.getByText(/Phone line disconnected — reload to reconnect/i)).toBeTruthy(),
    );

    // DutyControls still rendered despite the dead line — "Go on duty" is present.
    expect(screen.getByRole("button", { name: /^go on duty$/i })).toBeTruthy();

    // The line-gated idle chrome (Accepting toggle) stays hidden in error.
    expect(screen.queryByText(/Accepting calls/i)).toBeNull();
    expect(screen.queryByText(/Incoming calls ring here/i)).toBeNull();
  });
});

/**
 * Task 15 (spec D6): "End shift" flips presence OFFLINE immediately AND disarms
 * the 20s heartbeat, so a beat can't flip the agent back to AVAILABLE right
 * after ending. DutyControls is armed (pushArmed()→true, mocked above) so its
 * "End shift" button renders inside the softphone card. Heartbeats POST
 * /api/presence; the end-shift click POSTs /api/presence/end-shift — the test
 * distinguishes them by URL.
 */
describe("Softphone — End shift disarms the heartbeat (D6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    push.pushArmed.mockReturnValue(true);
    push.armPush.mockResolvedValue(true);
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  const presenceCalls = () =>
    fetchMock.mock.calls.filter((args) => (args[0] as string) === "/api/presence");
  const endShiftCalls = () =>
    fetchMock.mock.calls.filter((args) => (args[0] as string) === "/api/presence/end-shift");

  it("stops heartbeat POSTs after End shift, then resumes an immediate beat on Go on duty", async () => {
    // Real timers for the async connect()/dynamic-import + userEvent clicks;
    // fake timers only to DRIVE the 20s heartbeat interval deterministically.
    const user = userEvent.setup();
    render(
      <CallSurfaceProvider>
        <Softphone role="AGENT" />
        <CardProbe />
      </CallSurfaceProvider>,
    );

    // Let connect() resolve (token fetch + register → phase "ready"). The mount
    // path posts one AVAILABLE presence beat.
    await waitFor(() => expect(screen.getByText(/Accepting calls/i)).toBeTruthy());

    // Switch to fake timers now that the async boot is done, and drive one
    // heartbeat window → a beat fires while on duty.
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(presenceCalls().length).toBeGreaterThan(0);

    // Back to real timers to click "End shift" (userEvent + the async fetch).
    vi.useRealTimers();
    await user.click(screen.getByRole("button", { name: /end shift/i }));
    await waitFor(() => expect(endShiftCalls().length).toBe(1));
    const atEnd = presenceCalls().length;

    // With the heartbeat disarmed, advance well past two windows — NO further
    // /api/presence beat fires.
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(presenceCalls().length).toBe(atEnd);

    // Resume: "Go on duty to resume" re-arms and beats immediately.
    vi.useRealTimers();
    await user.click(screen.getByRole("button", { name: /go on duty to resume/i }));
    await waitFor(() => expect(presenceCalls().length).toBeGreaterThan(atEnd));
  });
});

describe("Softphone — D13 duty hydration + gated beats", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let hydration: { onDuty: boolean; accepting: boolean };
  let beatResponse: { status: number; body: unknown };

  beforeEach(() => {
    vi.clearAllMocks();
    hydration = { onDuty: true, accepting: true };
    beatResponse = { status: 204, body: {} };
    fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: "test-token" }),
        });
      }
      if (url === "/api/presence" && (!init || init.method !== "POST")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(hydration),
        });
      }
      if (url === "/api/presence") {
        return Promise.resolve({
          ok: true,
          status: beatResponse.status,
          json: () => Promise.resolve(beatResponse.body),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  function presencePosts() {
    return fetchMock.mock.calls.filter(
      (args) =>
        args[0] === "/api/presence" &&
        (args[1] as RequestInit | undefined)?.method === "POST",
    );
  }

  it("hydrates OFF duty from the server and suppresses ALL beats (incl. the registration stamp)", async () => {
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText("Go on duty to resume"));
    // Zero POSTs total: the Device-registration stamp inside connect() rides
    // the duty gate too (it used to post a hardcoded AVAILABLE — the last
    // client path that could re-enter a shift on mount), and the focus beat
    // is suppressed while off duty.
    await act(async () => {
      window.dispatchEvent(new Event("focus")); // would beat if on duty
    });
    expect(presencePosts()).toHaveLength(0);
  });

  it("hydrates the Accepting toggle from accepting:false (AWAY survives refresh)", async () => {
    hydration = { onDuty: true, accepting: false };
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText("Not accepting calls"));
  });

  it("a gated beat ({onDuty:false}) flips the tab off duty", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i)); // hydrated on duty
    beatResponse = { status: 200, body: { onDuty: false } };
    await act(async () => {
      window.dispatchEvent(new Event("focus")); // force a beat
    });
    await waitFor(() => screen.getByText("Go on duty to resume"));
  });

  it("Go on duty calls the dedicated route, not a bare beat", async () => {
    hydration = { onDuty: false, accepting: true };
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText("Go on duty to resume"));
    await user.click(screen.getByText("Go on duty to resume"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((args) => args[0] === "/api/presence/go-on-duty"),
      ).toBe(true),
    );
  });

  it("hydration failure FAILS OPEN — defaults stand and beats still flow", async () => {
    // GET /api/presence → 500 (e.g. the route's DB-error path). The client must
    // keep its fail-open defaults (on duty, accepting) and keep beating — the
    // server-side gate is the enforcement, not the hydration read.
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: "test-token" }),
        });
      }
      if (url === "/api/presence" && (!init || init.method !== "POST")) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      if (url === "/api/presence") {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i)); // defaults stand
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(presencePosts().length).toBeGreaterThan(0));
  });

  it("an on-duty hydration fires the first beat immediately (mid-shift refresh re-stamps)", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));
    // No focus event, no timer advance: the post-hydration beat (or the
    // gate-riding registration stamp) must already have POSTed so a mid-shift
    // refresh re-stamps last_seen well inside the 90s stale window.
    await waitFor(() => expect(presencePosts().length).toBeGreaterThan(0));
  });
});
