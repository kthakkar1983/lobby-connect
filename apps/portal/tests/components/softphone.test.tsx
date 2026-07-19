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

// The DutyProvider (which now owns Go on duty) calls armPush() inside goOnDuty();
// mock it so its Web Push arming resolves without jsdom's PushManager. pushArmed
// is retained for any code path that reads it, but the softphone no longer does.
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
import { DutyProvider, useDuty } from "@/components/dashboard/duty-provider";
import { OffDutyPromptProvider } from "@/components/dashboard/off-duty-prompt";

/**
 * Card-side consumer probe: exposes the audio ring count + an Answer button
 * wired to the registered accept dispatcher — the seam the real PropertyCard
 * uses. Answering the softphone in these tests goes through here.
 */
function CardProbe() {
  const { rings, actions, silenceRing, toggleCaptions } = useCallSurface();
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
      {/* Captions default OFF (spec D7) — this turns them on via the surface. */}
      <button type="button" onClick={() => toggleCaptions()}>
        enable captions
      </button>
    </div>
  );
}

/**
 * Duty-side probe: duty ownership moved OUT of the softphone into the
 * DutyProvider (Task 16 — the header renders the real DutyControl). These tests
 * observe/drive duty through this probe (its `duty-onduty`/`duty-onbreak`
 * read-outs + plain buttons) instead of the retired in-softphone duty buttons.
 */
function DutyProbe() {
  const { onDuty, onBreak, goOnDuty, endShift, takeBreak, resume } = useDuty();
  return (
    <div>
      <span data-testid="duty-onduty">{String(onDuty)}</span>
      <span data-testid="duty-onbreak">{String(onBreak)}</span>
      <button type="button" onClick={() => void goOnDuty()}>
        probe-go-on-duty
      </button>
      <button type="button" onClick={() => void endShift()}>
        probe-end-shift
      </button>
      <button type="button" onClick={() => void takeBreak()}>
        probe-take-break
      </button>
      <button type="button" onClick={() => void resume()}>
        probe-resume
      </button>
    </div>
  );
}

function renderSoftphone(role: "AGENT" | "ADMIN" = "AGENT") {
  return render(
    <CallSurfaceProvider>
      <DutyProvider>
        <Softphone role={role} />
        <CardProbe />
        <DutyProbe />
      </DutyProvider>
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
    await act(async () => screen.getByText("enable captions").click());

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
        <DutyProvider>
          <Softphone role="AGENT" />
          <VideoCallHost operatorId="op-1" />
          <CardProbe />
        </DutyProvider>
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
 * Error phase: when the line can't register (staging has no Twilio, or the prod
 * line briefly drops), the softphone shows "Phone line disconnected" and hides
 * its line-gated idle chrome (the Accepting toggle + "Incoming calls ring here").
 * The token fetch is forced to fail so connect() lands in phase "error". (Duty
 * controls are no longer here — they live in the header's DutyControl, which is
 * Twilio-independent and covered by duty-control.test.tsx.)
 */
describe("Softphone — error phase (line can't register)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows 'Phone line disconnected' and hides the idle Accepting chrome in the error phase", async () => {
    renderSoftphone("AGENT");

    // The line drops to error (token fetch failed) → disconnected message shows.
    await waitFor(() =>
      expect(screen.getByText(/Phone line disconnected — reload to reconnect/i)).toBeTruthy(),
    );

    // The line-gated idle chrome stays hidden in error.
    expect(screen.queryByText(/Accepting calls/i)).toBeNull();
    expect(screen.queryByText(/Incoming calls ring here/i)).toBeNull();
  });
});

/**
 * Task 16 (spec D6): End shift (now the header DutyControl → DutyProvider.endShift,
 * driven here via DutyProbe) flips duty off + POSTs /api/presence/end-shift; the
 * softphone mirrors the provider's onDuty into its heartbeat gate, so beats STOP
 * after End shift and RESUME (immediate stamp) on Go on duty. We count only POST
 * /api/presence (the beats) — the off-duty resync's GET /api/presence must not be
 * mistaken for a beat.
 */
describe("Softphone — End shift disarms the heartbeat (D6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  const presenceBeats = () =>
    fetchMock.mock.calls.filter(
      (args) =>
        args[0] === "/api/presence" && (args[1] as RequestInit | undefined)?.method === "POST",
    );
  const endShiftCalls = () =>
    fetchMock.mock.calls.filter((args) => (args[0] as string) === "/api/presence/end-shift");

  it("stops heartbeat POSTs after End shift, then resumes an immediate beat on Go on duty", async () => {
    // Real timers for the async connect()/dynamic-import + userEvent clicks;
    // fake timers only to DRIVE the 20s heartbeat interval deterministically.
    const user = userEvent.setup();
    render(
      <CallSurfaceProvider>
        <DutyProvider>
          <Softphone role="AGENT" />
          <CardProbe />
          <DutyProbe />
        </DutyProvider>
      </CallSurfaceProvider>,
    );

    // Let connect() resolve (token + register → "ready") AND hydration settle so
    // the first on-duty beat has posted (proves the heartbeat is armed).
    await waitFor(() => expect(screen.getByText(/Accepting calls/i)).toBeTruthy());
    await waitFor(() => expect(presenceBeats().length).toBeGreaterThan(0));

    // Drive one heartbeat window under fake timers → still beating while on duty.
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(presenceBeats().length).toBeGreaterThan(0);

    // Back to real timers to click "End shift" (via the header provider handler).
    vi.useRealTimers();
    await user.click(screen.getByRole("button", { name: /probe-end-shift/i }));
    await waitFor(() => expect(endShiftCalls().length).toBe(1));
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    const atEnd = presenceBeats().length;

    // With the heartbeat disarmed, advance well past two windows — NO further
    // /api/presence beat fires (the off-duty resync GET is not a beat).
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(presenceBeats().length).toBe(atEnd);

    // Resume via Go on duty → the registered beat stamps immediately.
    vi.useRealTimers();
    await user.click(screen.getByRole("button", { name: /probe-go-on-duty/i }));
    await waitFor(() => expect(presenceBeats().length).toBeGreaterThan(atEnd));
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

  /**
   * Presence POSTs carrying a specific intended status. The interval beat POSTs
   * too — it gates on onDuty alone, so an agent on a BREAK still beats — which
   * means a raw count cannot distinguish "the guard withheld the flip" from "no
   * beat happened to land yet". That only passes because HEARTBEAT_MS is 20s
   * and the test finishes in well under a second: a margin that is real but
   * implicit, and this file has flake history (fd3fbdb) earned exactly that way.
   * Filtering on the status the toggle WOULD have sent removes it entirely.
   */
  function presencePostsWithStatus(status: string) {
    return presencePosts().filter((post) => {
      const body = JSON.parse((post[1] as RequestInit).body as string) as { status?: string };
      return body.status === status;
    });
  }

  /**
   * Same tree as renderSoftphone, plus the real OffDutyPromptProvider. The
   * default helper deliberately omits it (mirroring the surfaces that mount
   * PropertyCard with neither provider), which means useDutyGuard's ctx is null
   * there and a gated click is silently swallowed — so those tests can only
   * ever prove the WITHHOLDING half of the guard. This one proves the OFFERING
   * half, which is the whole justification for leaving the control enabled.
   */
  function renderSoftphoneWithPrompt(role: "AGENT" | "ADMIN" = "AGENT") {
    return render(
      <CallSurfaceProvider>
        <DutyProvider>
          <OffDutyPromptProvider>
            <Softphone role={role} />
            <CardProbe />
            <DutyProbe />
          </OffDutyPromptProvider>
        </DutyProvider>
      </CallSurfaceProvider>,
    );
  }

  it("hydrates OFF duty from the server and suppresses ALL beats (incl. the registration stamp)", async () => {
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    // Zero POSTs total: the Device-registration stamp inside connect() rides
    // the duty gate too (it used to post a hardcoded AVAILABLE — the last
    // client path that could re-enter a shift on mount), and the focus beat
    // is suppressed while off duty. The off-duty resync GET is not a POST.
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

  it("a gated beat ({onDuty:false}) flips the tab off duty (via the provider)", async () => {
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i)); // hydrated on duty
    beatResponse = { status: 200, body: { onDuty: false } };
    await act(async () => {
      window.dispatchEvent(new Event("focus")); // force a beat
    });
    // The gated beat calls markOffDuty on the provider → the header (probe) flips off.
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
  });

  it("Go on duty calls the dedicated route, not a bare beat", async () => {
    hydration = { onDuty: false, accepting: true };
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    await user.click(screen.getByText("probe-go-on-duty"));
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

  // ---------------------------------------------------------------------
  // Spec §3.2 — the ring becomes the go-on-duty control while off duty.
  //
  // These live in THIS describe block because `hydration` is the only real
  // lever for duty state here, and it is scoped to this block. Do NOT add a
  // vi.mock of duty-provider to this file to drive duty more directly: the
  // accept-gate tests below import the REAL provider to prove
  // softphone.tsx's `if (!canWorkRef.current) return;` blocks an off-duty
  // answer, and with no server-side duty check on /api/twilio/voice/answered
  // that is the authoritative client-side gate for answering audio. A mock
  // would make those tests vacuous while leaving them green.
  // ---------------------------------------------------------------------

  it("turns the ring into a go-on-duty control while off duty", async () => {
    hydration = { onDuty: false, accepting: true };
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));

    const ring = screen.getByRole("button", { name: "Go on duty" });
    // The disc's two children are absolutely positioned, so their wrapper must
    // be their positioning context. Without `relative` they escape to the
    // nearest positioned ancestor and the ring visibly falls apart — a pure-CSS
    // defect jsdom cannot see through layout, so it is pinned structurally.
    // Resolved via the glow's parent rather than a test-only attribute, so it
    // follows the wrapper wherever the markup puts it.
    const disc = ring.querySelector(".lc-seam-drift")?.parentElement;
    expect(disc?.className).toContain("relative");

    // The visible caption must be INSIDE the button: users click labels, and a
    // click that lands on the words and does nothing is a dead control on the
    // one thing that starts her shift.
    expect(ring.textContent).toContain("Go on duty");

    await user.click(ring);

    // Same route the retired header button drove — asserted through the fetch
    // mock rather than a spy, because this file uses the real DutyProvider.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((args) => args[0] === "/api/presence/go-on-duty"),
      ).toBe(true),
    );
  });

  it("swaps the ring's sub-copy to 'Your line is offline.' while off duty", async () => {
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    expect(screen.getByText("Your line is offline.")).toBeTruthy();
    expect(screen.queryByText("Incoming calls ring here.")).toBeNull();
    // The caption IS the accessible name (it lives inside the button), so there
    // is only one string to keep true — sighted and screen-reader users cannot
    // be told the control is called two different things.
    expect(screen.getByRole("button", { name: "Go on duty" })).toBeTruthy();
  });

  it("announces the duty flip through a live region rather than in silence", async () => {
    // Activating the ring unmounts the focused button, so focus falls back to
    // <body> with nothing to announce the shift actually started. The sub-copy
    // is one persistent element across the flip precisely so it can carry that.
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Your line is offline.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Go on duty" }));

    // Same node, new text — that is what makes it announce. A branch per state
    // would remount it and say nothing.
    await waitFor(() => expect(status.textContent).toBe("Incoming calls ring here."));
    expect(screen.getByRole("status")).toBe(status);
  });

  it("leaves the ring decorative while on duty", async () => {
    // Hydrate with accepting:false — a value the provider's fail-open defaults
    // (onDuty/accepting both true) cannot produce, so waiting on it proves the
    // GET actually landed and applied. Waiting on an on-duty read-out instead
    // would pass on the very first render, before hydration resolved, and the
    // test would assert the default rather than server truth.
    hydration = { onDuty: true, accepting: false };
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByRole("button", { name: "Not accepting calls" }));
    expect(screen.getByTestId("duty-onduty").textContent).toBe("true");
    expect(screen.queryByRole("button", { name: "Go on duty" })).toBeNull();
    expect(screen.getByText("Incoming calls ring here.")).toBeTruthy();
  });

  it("leaves the ring decorative on a BREAK — go-on-duty must never fire mid-shift", async () => {
    // She is gated on a break but she is NOT off duty, and goOnDuty() would
    // POST /api/presence/go-on-duty, whose openShift() closes her live shift
    // and inserts a new one: one continuous night recorded as two shifts. The
    // ring therefore keys on onDuty, never on canWork. Resume lives on the
    // shift card, and the guard dialog offers Resume rather than Start.
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("true"));

    await user.click(screen.getByRole("button", { name: /probe-take-break/i }));
    await waitFor(() => expect(screen.getByTestId("duty-onbreak").textContent).toBe("true"));

    expect(screen.queryByRole("button", { name: "Go on duty" })).toBeNull();
    expect(
      fetchMock.mock.calls.some((args) => args[0] === "/api/presence/go-on-duty"),
    ).toBe(false);
  });

  it("gates the accepting toggle on a BREAK too, and never claims she is accepting", async () => {
    // The gate is `canWork` (onDuty && !onBreak), so a break gates the toggle
    // exactly as being off duty does. The label must move with it: a control
    // that reads "Accepting calls" while wearing the gated fill is telling her
    // two different things at once, and the server will not ring her either way.
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    // Hydration witness: an on-duty hydration fires the first beat, so a POST
    // proves the GET landed AND resolved on duty. The "Accepting calls" label
    // alone is the provider's fail-open default and matches on the very first
    // render, before hydration has resolved anything.
    await waitFor(() => expect(presencePosts().length).toBeGreaterThan(0));
    await waitFor(() => screen.getByRole("button", { name: "Accepting calls" }));

    await user.click(screen.getByRole("button", { name: /probe-take-break/i }));
    await waitFor(() => expect(screen.getByTestId("duty-onbreak").textContent).toBe("true"));

    const toggle = await screen.findByRole("button", { name: "Not accepting calls" });
    expect(toggle.className).toContain("bg-muted");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    // She was accepting, so a flip that got through would POST AWAY. Beats on a
    // break post AVAILABLE, so this cannot be satisfied by beat timing.
    expect(presencePostsWithStatus("AWAY")).toHaveLength(0);
  });

  it("reads 'Not accepting calls' while off duty even when the server says accepting", async () => {
    // Off duty the server will not ring her, so rendering the raw `accepting`
    // flag would claim a readiness she does not have.
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    expect(screen.getByText("Not accepting calls")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not accepting calls" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("WITHHOLDS the accepting toggle while off duty — enabled, but it posts nothing", async () => {
    // The load-bearing test for spec §3.4 on this control: it is deliberately
    // NOT `disabled` (a disabled button fires no click and so cannot be
    // intercepted or offered a shift), so nothing else proves a click cannot
    // get through to the presence POST.
    hydration = { onDuty: false, accepting: true };
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));

    const toggle = screen.getByRole("button", { name: "Not accepting calls" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);

    await user.click(toggle);

    expect(presencePosts()).toHaveLength(0);
    expect(screen.getByText("Not accepting calls")).toBeTruthy();
  });

  it("carries the recessed gated FILL off duty, and drops it on duty", async () => {
    // Spec §3.2 says the toggle is *visually* gated, and since it is
    // deliberately not `disabled` there is no other signal that clicking will
    // prompt rather than toggle. Pinned on the class because the cue must stay
    // a FILL: dimming the element would composite its label too, and an ENABLED
    // control has no WCAG 1.4.3 inactive-component exemption to lean on.
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    const gatedToggle = screen.getByRole("button", { name: "Not accepting calls" });
    expect(gatedToggle.className).toContain("bg-muted");
    // Never element opacity — that is the trap this recipe exists to avoid.
    expect(gatedToggle.className).not.toMatch(/(^|\s)opacity-/);

    cleanup();
    hydration = { onDuty: true, accepting: true };
    renderSoftphone("AGENT");
    const liveToggle = await screen.findByRole("button", { name: "Accepting calls" });
    expect(liveToggle.className).not.toContain("bg-muted");
  });

  it("leaves ADMIN with the static Covering copy and no Accepting toggle, ring control included", async () => {
    // The Accepting toggle is AGENT-only and stays that way: an admin is dialed
    // in via each property's Covering flag, not a personal AWAY switch. Duty
    // itself is not role-scoped though, so the ring is still her way on shift.
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("ADMIN");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));

    expect(screen.getByText("You're dialed in for properties set to Covering.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accepting calls/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Go on duty" })).toBeTruthy();
  });

  it("OFFERS to start the shift when the gated toggle is clicked (the guard's other half)", async () => {
    // The withholding half is pinned above; this is the half that justifies
    // leaving the control enabled at all. Without it, unmounting
    // OffDutyPromptProvider from app-shell would leave every softphone test
    // green while the agent got a dead click and no explanation.
    hydration = { onDuty: false, accepting: true };
    const user = userEvent.setup();
    renderSoftphoneWithPrompt("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));

    await user.click(screen.getByRole("button", { name: "Not accepting calls" }));

    expect(await screen.findByText("You're off duty")).toBeTruthy();
    // Off duty, not on a break: the action must be Start my shift, never Resume
    // (resume's route has a BREAK-only guard and would no-op).
    expect(screen.getByRole("button", { name: "Start my shift" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    // Still withheld — offering is not doing.
    expect(presencePosts()).toHaveLength(0);
  });

  it("offers RESUME rather than Start my shift when the gated toggle is clicked on a break", async () => {
    // Routing a break through goOnDuty would POST go-on-duty, whose openShift()
    // closes her live shift and inserts a new one: one night, two rows.
    const user = userEvent.setup();
    renderSoftphoneWithPrompt("AGENT");
    await waitFor(() => expect(presencePosts().length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: /probe-take-break/i }));
    await waitFor(() => expect(screen.getByTestId("duty-onbreak").textContent).toBe("true"));

    await user.click(await screen.findByRole("button", { name: "Not accepting calls" }));

    expect(await screen.findByText("You're on a break")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start my shift" })).toBeNull();
  });

  it("still toggles Accepting normally while on duty (the guard must not over-block)", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    // Hydration witness (see the BREAK test) — the label is the fail-open
    // default and would match before the GET resolved.
    await waitFor(() => expect(presencePosts().length).toBeGreaterThan(0));
    await waitFor(() => screen.getByRole("button", { name: "Accepting calls" }));

    await user.click(screen.getByRole("button", { name: "Accepting calls" }));

    await waitFor(() => screen.getByRole("button", { name: "Not accepting calls" }));
    await waitFor(() => {
      const away = presencePosts().some((post) => {
        const body = JSON.parse((post[1] as RequestInit).body as string) as { status: string };
        return body.status === "AWAY";
      });
      expect(away).toBe(true);
    });
  });

  it("an OFF-duty tab resyncs to ON duty via focus when the shift resumed elsewhere", async () => {
    // Smoke finding (2026-07-06): tab B sat off duty forever after tab A clicked
    // Go on duty — off-duty tabs beat nothing, so they need a read-only resync.
    hydration = { onDuty: false, accepting: true };
    renderSoftphone("AGENT");
    await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
    // Tab A (elsewhere) went on duty with Accepting OFF — server truth changed.
    hydration = { onDuty: true, accepting: false };
    await act(async () => {
      window.dispatchEvent(new Event("focus")); // resync tick
    });
    // The tab flips on duty AND applies accepting BEFORE its follow-up beat, so
    // the beat posts AWAY (never the pre-resync accepting default).
    await waitFor(() => screen.getByText("Not accepting calls"));
    await waitFor(() => {
      const posts = presencePosts();
      expect(posts.length).toBeGreaterThan(0);
      // Every beat after the resync must carry the resynced accepting=false (AWAY),
      // never the pre-resync accepting default (AVAILABLE). Assert on all posts
      // rather than an exact count of 1: a timing-raced extra AWAY beat is still
      // correct behaviour, whereas `expect(length).toBe(1)` inside waitFor was
      // flaky — the counter only grows, so an overshoot to 2 could never settle
      // back to 1 (CI failure 2026-07-16).
      for (const post of posts) {
        const body = JSON.parse((post[1] as RequestInit).body as string) as {
          status: string;
        };
        expect(body.status).toBe("AWAY");
      }
    });
  });
});

/**
 * Finding #3 (spec §7.1): audio Accept must be duty-gated. An agent who was
 * AVAILABLE when the call started ringing, then went on break, must NOT be able
 * to answer the already-ringing audio call — /api/twilio/voice/answered is
 * ungated and would flip her ON_CALL. The dial presence-gates who RINGS; this
 * closes the "flipped to break while it was ringing" edge, client-side.
 */
describe("Softphone — duty gate on accept (finding #3 / spec §7.1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.unstubAllGlobals();
    cleanup();
  });

  const answeredCalls = () =>
    fetchMock.mock.calls.filter((args) => (args[0] as string) === "/api/twilio/voice/answered");

  it("does NOT accept an in-flight audio call while the agent is on break", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    // Go on break — canWork becomes false (on duty, not working).
    await user.click(screen.getByRole("button", { name: /probe-take-break/i }));
    await waitFor(() => expect(screen.getByTestId("duty-onbreak").textContent).toBe("true"));

    // A call that was already ringing when she flipped to break.
    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));

    // Answering must no-op: the Twilio call is never accepted and the answered
    // route (which would flip her ON_CALL server-side) is never hit.
    await user.click(screen.getByText("Answer on card"));
    expect(twilio.fakeCall.accept).not.toHaveBeenCalled();
    expect(answeredCalls()).toHaveLength(0);
  });

  it("accepts normally when on duty and not on break (gate open)", async () => {
    const user = userEvent.setup();
    renderSoftphone("AGENT");
    await waitFor(() => screen.getByText(/Accepting calls/i));

    await act(async () => twilio.fireIncoming());
    await waitFor(() => expect(screen.getByTestId("audio-rings").textContent).toBe("1"));

    await user.click(screen.getByText("Answer on card"));
    expect(twilio.fakeCall.accept).toHaveBeenCalled();
    await waitFor(() => expect(answeredCalls().length).toBe(1));
  });
});
