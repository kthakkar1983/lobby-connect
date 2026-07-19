"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDutyOptional } from "@/components/dashboard/duty-provider";
import { docPipSupported } from "@/lib/duty-tile/call-tile-manager";
import { attachTokenAutoRefresh, shouldReconnectDevice } from "@/lib/voice/device-resilience";
import type { PresenceStatus } from "@/lib/voice/presence";
import { useLineStatus } from "@/lib/dashboard/line-status";
import { useRingingTabTitle } from "@/lib/hooks/use-ringing-tab-title";
import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import { primeRingtone } from "@/lib/video/prime";
import { reliableFetch } from "@/lib/http/reliable-fetch";
import { cn } from "@/lib/utils";
import { useCaptions } from "@/lib/captions/use-captions";

type Phase = "connecting" | "ready" | "incoming" | "in-call" | "error";

interface SoftphoneProps {
  readonly role: "AGENT" | "ADMIN";
}

const HEARTBEAT_MS = 20_000;
// Fire the Device's `tokenWillExpire` 30s before expiry (SDK default is 10s,
// too tight to reliably refetch before the token lapses).
const TOKEN_REFRESH_LEAD_MS = 30_000;

type BeatResult = "ok" | "off-duty" | "failed";

// D13: a beat can come back "off-duty" (the server gated it — the shift ended
// in another tab or lapsed); the caller flips local duty state to match. Only
// an explicit `onDuty: false` counts — anything shapeless/non-JSON is ok/failed,
// NEVER off-duty, so a proxy hiccup can't end a shift client-side (fail-open;
// the server gate is the enforcement).
async function postPresence(status: PresenceStatus): Promise<BeatResult> {
  try {
    const res = await fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.status === 200) {
      const body = (await res.json().catch(() => null)) as { onDuty?: boolean } | null;
      if (body?.onDuty === false) return "off-duty";
    }
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

async function fetchVoiceToken(): Promise<string> {
  const res = await fetch("/api/twilio/token");
  if (!res.ok) throw new Error("token");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export function Softphone({ role }: SoftphoneProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [muted, setMuted] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [incomingProperty, setIncomingProperty] = useState("");
  const [callTimeZone, setCallTimeZone] = useState<string | null>(null);
  const [guestAudioTrack, setGuestAudioTrack] = useState<MediaStreamTrack | null>(null);
  const captionGrabRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [emergencyActive, setEmergencyActive] = useState(false);
  // True once a 911 trigger came back as failed/degraded — the agent must fall
  // back to verbal relay / instruct the guest to dial 911 directly.
  const [emergencyFailed, setEmergencyFailed] = useState(false);
  // Mirror into a ref so the SDK-vs-conference branch in the callbacks below
  // always reads the current value without re-creating the callbacks.
  const emergencyActiveRef = useRef(emergencyActive);
  emergencyActiveRef.current = emergencyActive;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const callIdRef = useRef<string>("");
  // Phase-3 publish seam (Task 7): the ringing property's id (from the new
  // propertyId Parameter), the client ms the ring surfaced, and the client ms
  // the agent answered — mirrored into the CallSurfaceProvider for the cards.
  const incomingPropertyIdRef = useRef<string | null>(null);
  const incomingSinceRef = useRef<number>(0);
  const answeredAtRef = useRef<number>(0);
  // Mirror phase + guard reconnects so the focus/visibility self-heal can read
  // the latest phase and never run two registrations at once.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  // Ref-mirror roomNumber/notes so the stale SDK event-listener closures
  // (device "incoming" → call "disconnect") always read the current values.
  const roomNumberRef = useRef(roomNumber);
  roomNumberRef.current = roomNumber;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Task 16: duty is owned by the DutyProvider (the header renders the control).
  // The softphone is a CONSUMER — it mirrors the provider's onDuty / accepting /
  // hydrated into refs for the heartbeat's SYNCHRONOUS gate + intendedStatus,
  // keeps the beat loop, and reports gate verdicts (a gated beat, an off-duty
  // resync) back UP to the provider. useDutyOptional so the softphone still
  // renders without a provider (fail-open defaults) in isolated contexts.
  const duty = useDutyOptional();
  const onDuty = duty?.onDuty ?? true; // no provider -> fail-open on duty
  // The Accepting toggle UI stays here, but its VALUE lives in the provider so
  // hydration + cross-tab resync converge in one place. readyRef mirrors it for
  // the beat's synchronous read; the toggle pushes optimistic flips back up.
  const accepting = duty?.accepting ?? true;
  // Beats wait for hydration so the first one can't post the pre-hydration
  // Accepting default over a real AWAY (spec §3.4 ordering rule). No provider ->
  // treat as hydrated (fail-open, beats flow).
  const dutyHydrated = duty ? duty.hydrated : true;
  // Duty hard-gate for in-flight audio (spec §7.1): whether the agent may work
  // right now (on duty AND not on break). No provider -> fail-open (work
  // allowed). Mirrored into a ref below for acceptCall's []-stable closure.
  const canWork = duty?.canWork ?? true;

  // Synchronous mirrors. The `= value` on every render tracks the provider; the
  // gate helpers below also set these synchronously (e.g. applyBeatResult flips
  // onDutyRef before the re-render lands) — the provider setState that follows
  // makes the next render agree.
  //
  // INVARIANT (Task 16, finding #5): the "no stray beat after End shift" safety
  // relies on the softphone re-rendering SYNCHRONOUSLY with the DutyProvider.
  // When DutyControl calls endShift(), the provider flips onDuty=false; React 19
  // flushes this consumer in the SAME update, so onDutyRef.current becomes false
  // before the next heartbeat tick can read it and beat() self-gates. A future
  // React.memo or Suspense boundary inserted BETWEEN DutyProvider and this
  // softphone (see app-shell.tsx) could defer that flush and widen the window
  // for a stray beat. The server duty gate is the ultimate backstop (a stray
  // AVAILABLE beat after End shift hits status=OFFLINE and is gated), but do not
  // rely on it alone — keep the provider→softphone consumer path boundary-free.
  const onDutyRef = useRef(onDuty);
  onDutyRef.current = onDuty;
  const readyRef = useRef(accepting);
  readyRef.current = accepting;
  const dutyHydratedRef = useRef(dutyHydrated);
  dutyHydratedRef.current = dutyHydrated;
  const canWorkRef = useRef(canWork);
  canWorkRef.current = canWork;
  // Mirror the provider methods so the softphone's callbacks can stay []-stable
  // (interval/effect deps) while still calling the current provider fns.
  const refreshFromServerRef = useRef(duty?.refreshFromServer);
  refreshFromServerRef.current = duty?.refreshFromServer;
  const markOffDutyRef = useRef(duty?.markOffDuty);
  markOffDutyRef.current = duty?.markOffDuty;
  const setAcceptingRef = useRef(duty?.setAccepting);
  setAcceptingRef.current = duty?.setAccepting;

  // Notes save is decoupled from call phase: a failure surfaces in a banner that
  // outlives the call so the typed text is never silently lost.
  const [notesSave, setNotesSave] = useState<"idle" | "saving" | "failed">("idle");
  const [pendingNotes, setPendingNotes] = useState<
    { callId: string; roomNumber: string; notes: string } | null
  >(null);

  const saveNotes = useCallback(
    async (payload: { callId: string; roomNumber: string; notes: string }) => {
      setNotesSave("saving");
      const res = await reliableFetch(
        "/api/calls/notes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        { label: "calls.notes" },
      );
      const ok = !!res && res.ok;
      if (ok) {
        setNotesSave("idle");
        setPendingNotes(null);
      } else {
        setNotesSave("failed");
        setPendingNotes(payload);
      }
      return ok;
    },
    [],
  );

  const saveNotesNow = useCallback(async (): Promise<boolean> => {
    const id = callIdRef.current;
    const room = roomNumberRef.current;
    const note = notesRef.current;
    if (!id || (!room && !note)) return true;
    return saveNotes({ callId: id, roomNumber: room, notes: note });
  }, [saveNotes]);

  // Current intended presence, derived from local UI state.
  const intendedStatus = useCallback((): PresenceStatus => {
    if (phase === "in-call") return "ON_CALL";
    return readyRef.current ? "AVAILABLE" : "AWAY";
  }, [phase]);

  // The server gated a beat (shift ended/lapsed elsewhere): suppress the very
  // next beat synchronously, then flip the header off via the provider (no POST —
  // the server already ended it). Stable ([]).
  const applyBeatResult = useCallback((result: BeatResult) => {
    if (result === "off-duty") {
      onDutyRef.current = false;
      markOffDutyRef.current?.();
    }
  }, []);

  // Gated beat: the interval tick + the Device-registration stamp use this — it
  // no-ops until hydrated and while off duty; the gate's answer is applied either
  // way. Same [intendedStatus] stability as the old inline beats.
  const beat = useCallback(async () => {
    if (!dutyHydratedRef.current || !onDutyRef.current) return;
    applyBeatResult(await postPresence(intendedStatus()));
  }, [intendedStatus, applyBeatResult]);
  // Ref-mirror so one-shot effects can fire a beat without depending on `beat`'s
  // identity (it changes with phase — DEP-HYGIENE).
  const beatRef = useRef(beat);
  beatRef.current = beat;

  // "Beat now": fired right after go-on-duty / resume (we ARE on duty) and after
  // an off-duty resync flips us on — so the onDuty ref-mirror's one-render lag
  // can't suppress the immediate stamp. Gated on hydration only. Registered with
  // the provider (registerBeat) so goOnDuty()/resume() stamp last_seen at once.
  const beatNow = useCallback(async () => {
    if (!dutyHydratedRef.current) return;
    applyBeatResult(await postPresence(intendedStatus()));
  }, [intendedStatus, applyBeatResult]);
  const beatNowRef = useRef(beatNow);
  beatNowRef.current = beatNow;

  // D13 follow-up (2026-07-06 smoke finding): an OFF-duty tab beats nothing, so
  // it would never learn a shift RESUMED from another tab. Resync by delegating
  // the read to the provider (refreshFromServer) on the beat cadence — READ-ONLY,
  // so it can never resurrect a shift; the server gate stays the enforcement, and
  // routing the read through the provider makes the HEADER converge too. When it
  // flips us back on, stamp last_seen right away with the just-applied accepting
  // (set synchronously first so the beat can't post a stale default over AWAY).
  // Self-gates: no-op while on duty or pre-hydration (mirror image of beat()).
  const resyncTick = useCallback(async () => {
    if (!dutyHydratedRef.current || onDutyRef.current) return;
    const applied = await refreshFromServerRef.current?.();
    if (applied && applied.onDuty === true) {
      onDutyRef.current = true;
      if (typeof applied.accepting === "boolean") readyRef.current = applied.accepting;
      void beatNowRef.current();
    }
  }, []);

  // Beacon: report line phase to the LineStatusContext so the greeting widget
  // can reflect live status. The default context is a no-op, so this is safe
  // in layouts that don't mount a provider (admin layout).
  const { report } = useLineStatus();
  useEffect(() => { report(phase); }, [phase, report]);

  // Phase-3 (Task 7): PUBLISH the audio incoming ring + active-call info into the
  // CallSurfaceProvider so the property cards can show + answer them. This mirrors
  // existing state; the Twilio Device machinery is untouched. The `Optional`
  // variant keeps softphone tests without a provider passing (returns null).
  //
  // ⚠ DEP-HYGIENE (Task-6 review): the register/publish dispatchers are
  // useCallback([])-stable, so publisher effects depend on the STABLE dispatcher
  // functions — NEVER on the whole `surface` object (registering a handler
  // mutates the context value and would loop).
  const surface = useCallSurfaceOptional();
  const publishRings = surface?.publishRings;
  const publishActive = surface?.publishActive;
  const registerAcceptAudio = surface?.registerAcceptAudio;
  // Read the silenced-key set (plain state value — never depend on `surface`).
  // When a card silences this ring, the set's identity changes → the ring effect
  // below re-runs and stops our own ringtone element. With no provider it's
  // undefined, so nothing is ever silenced (the ring always plays).
  const silencedKeys = surface?.silencedKeys;
  // Task 17: register this call's controls with the tile + surface the "Reopen
  // tile" affordance. registerCallControls is []-stable (mirrors the pattern
  // above); tileClosedByUser/openTileForCall are read as plain values/functions,
  // never depended on inside a publisher-style effect.
  const registerCallControls = surface?.registerCallControls;
  const tileClosedByUser = surface?.tileClosedByUser ?? false;
  const openTileForCall = surface?.openTileForCall;
  // Spec D2: while the call tile is mounted it owns the controls, so the overlay
  // collapses its call card to full-width playbook. Read as a plain value.
  const tileMount = surface?.tileMount ?? null;

  // Captions (spec D6–D8): enabled state now lives in the surface (shared by the
  // overlay + tile toggles, default OFF, reset per call). No provider → OFF + no-op.
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const publishCaptions = surface?.publishCaptions;
  // Gating the track (not just hiding the band) tears down the STT stream when
  // captions are off — stops the upstream audio + the per-minute billing.
  const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);
  // Feed the tile's caption band (spec D8). Local band render is unchanged.
  // DEP-HYGIENE: depend on the STABLE dispatcher + caption text, never `surface`.
  useEffect(() => {
    publishCaptions?.(captions.finals, captions.partial);
  }, [publishCaptions, captions.finals, captions.partial]);

  const ringtoneRef = useRef<Ringtone | null>(null);
  // The raw ring audio element, so "Go on duty" can prime the REAL element the
  // ring plays (not a throwaway) inside its own user gesture.
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);

  // Publish the audio incoming ring (id comes from the new propertyId Parameter).
  useEffect(() => {
    if (!publishRings) return;
    publishRings(
      "audio",
      phase === "incoming"
        ? [
            {
              key: `audio:${callIdRef.current || "incoming"}`,
              channel: "AUDIO",
              callId: callIdRef.current || null,
              propertyId: incomingPropertyIdRef.current,
              propertyName: incomingProperty || "Unknown property",
              since: incomingSinceRef.current,
            },
          ]
        : [],
    );
  }, [publishRings, phase, incomingProperty]);

  // Publish active-call info while in-call.
  useEffect(() => {
    if (!publishActive) return;
    // Channel-tagged (post-smoke fix): this AUDIO publisher re-runs on every
    // phase change — incl. the error-phase reconnect self-heal firing on tab
    // focus — so its null must never clear a live VIDEO call's slot. The
    // provider enforces the ownership; the tag says who's asking.
    publishActive(
      "AUDIO",
      phase === "in-call" && callIdRef.current
        ? {
            callId: callIdRef.current,
            channel: "AUDIO",
            propertyId: incomingPropertyIdRef.current,
            propertyName: incomingProperty || "Unknown property",
            onHold: false, // dormant seam — hold is deferred out of Phase 3 (spec §3.6)
            answeredAt: answeredAtRef.current,
            timeZone: callTimeZone, // captured from the answered route today
          }
        : null,
    );
  }, [publishActive, phase, incomingProperty, callTimeZone]);

  // Flash the tab title while a call is ringing so a backgrounded tab is
  // identifiable (the s1-test "whose browser is ringing?" gap).
  useRingingTabTitle(
    phase === "incoming",
    incomingProperty ? `Incoming call · ${incomingProperty}` : "Incoming call",
  );

  // Own the audio ring element (client-only), mirroring use-incoming-video-calls.
  // Twilio's built-in incoming sound CANNOT be stopped mid-ring (the SDK reads
  // device.audio.incoming() once when the call arrives, then only stops on
  // accept/reject/cancel/disconnect). To make a live ring silenceable we play
  // our OWN element and disable the built-in ring in the `registered` handler
  // below, so there is exactly one ring source and we control it.
  useEffect(() => {
    const audio = new Audio("/sounds/ring.mp3");
    audio.loop = true;
    audio.preload = "auto";
    ringAudioRef.current = audio;
    const ringtone = createRingtone(audio);
    ringtoneRef.current = ringtone;

    // Unlock autoplay: browsers block audio.play() until the page has seen a
    // user gesture, so an idle agent's first incoming-call ring is silently
    // dropped. Prime the element on the first interaction (skipped if a ring is
    // already playing, so we never cut off an active ring).
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      primeRingtone(audio);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      ringtone.stop();
      ringtoneRef.current = null;
      ringAudioRef.current = null;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Stable prime callback for the "Go on duty" control: primes the REAL ring
  // element (autoplay unlock) inside the click's user gesture.
  const primeRing = useCallback(() => primeRingtone(ringAudioRef.current), []);

  // Task 16: register the ring-prime + the "beat now" with the DutyProvider so
  // its goOnDuty()/resume() (in the header) can unlock our real ring element and
  // stamp last_seen immediately — WITHOUT the provider ever owning the <audio>
  // element or the heartbeat loop. registerPrime/registerBeat are []-stable and
  // primeRing is []-stable, so this runs once.
  const registerPrime = duty?.registerPrime;
  const registerBeat = duty?.registerBeat;
  useEffect(() => {
    registerPrime?.(primeRing);
    registerBeat?.(() => void beatNowRef.current());
    return () => {
      registerPrime?.(null);
      registerBeat?.(null);
    };
  }, [registerPrime, registerBeat, primeRing]);

  // Ring while an incoming call is waiting, UNLESS the card silenced this ring
  // key. Silencing changes `silencedKeys` identity → this effect re-runs →
  // rt.stop(). A NEW incoming has a new callId/phase/incomingProperty → new key
  // (not silenced) → rt.start(). Answering (phase → "in-call") → rt.stop().
  // Reading callIdRef.current inside mirrors the audio-publish effect's deps.
  useEffect(() => {
    const rt = ringtoneRef.current;
    if (!rt) return;
    const key = `audio:${callIdRef.current || "incoming"}`;
    const silenced = silencedKeys?.has(key) ?? false;
    if (phase === "incoming" && !silenced) rt.start();
    else rt.stop();
  }, [phase, silencedKeys, incomingProperty]);

  // Connect (or reconnect) the Twilio Device: tear down any prior instance,
  // mint a token, register, and wire the call handlers. Reused by the initial
  // mount and the focus/visibility self-heal below.
  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    try {
      deviceRef.current?.destroy();
    } catch {
      // ignore
    }
    deviceRef.current = null;
    setPhase("connecting");
    try {
      const token = await fetchVoiceToken();

      const { Device } = await import("@twilio/voice-sdk");
      const device = new Device(token, {
        closeProtection: true,
        tokenRefreshMs: TOKEN_REFRESH_LEAD_MS,
      });
      deviceRef.current = device;

      // The access token is short-lived (1h). Refresh it in place before it
      // expires so the Device never deregisters mid-shift — otherwise the
      // line silently drops and only a page reload recovers it.
      attachTokenAutoRefresh(device, {
        fetchToken: fetchVoiceToken,
        onRefreshError: (error) =>
          console.error("[softphone] token refresh failed:", error),
      });

      device.on("registered", () => {
        // Disable Twilio's built-in incoming ring so our own /sounds/ring.mp3
        // element is the ONLY ring — that ring is silenceable mid-call; the
        // built-in one is not. `registered` runs after the AudioHelper is set up
        // and before any incoming call, and re-applies on every reconnect (this
        // handler is re-wired each time connect() builds a fresh Device).
        try {
          device.audio?.incoming(false);
        } catch {
          // older/edge SDK without the AudioHelper — ignore
        }
        if (mountedRef.current) setPhase("ready");
      });
      device.on("error", () => {
        if (mountedRef.current) setPhase("error");
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      device.on("incoming", (call: any) => {
        callRef.current = call;
        callIdRef.current = call.customParameters?.get("callId") ?? "";
        // Capture the ringing property's id (Task 4's additive Parameter) + the
        // moment it surfaced, for the CallSurfaceProvider publish below.
        incomingPropertyIdRef.current = call.customParameters?.get("propertyId") ?? null;
        incomingSinceRef.current = Date.now();
        if (mountedRef.current) {
          setIncomingProperty(call.customParameters?.get("propertyName") ?? "");
          setPhase("incoming");
        }
        call.on("disconnect", () => {
          void endCall();
        });
        call.on("cancel", () => {
          callRef.current = null;
          if (mountedRef.current) setPhase("ready");
        });
      });

      await device.register();
      // Registration stamp rides the duty gate (D13): beat() posts the real
      // intendedStatus (not a hardcoded AVAILABLE, which used to overwrite an
      // AWAY toggle) and no-ops while off duty or pre-hydration — the hydration
      // effect fires the first beat itself.
      await beatRef.current();
    } catch {
      if (mountedRef.current) setPhase("error");
    } finally {
      connectingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the Twilio Device on mount; destroy it on unmount.
  useEffect(() => {
    mountedRef.current = true;
    void connect();
    return () => {
      mountedRef.current = false;
      try {
        deviceRef.current?.destroy();
      } catch {
        // ignore
      }
    };
  }, [connect]);

  // Self-heal: a tab the browser froze overnight drops to `error` (its token
  // lapses with no `tokenWillExpire` firing, so attachTokenAutoRefresh can't
  // help). Re-register when the agent returns to the tab — but only then, so we
  // never thrash the token endpoint from a hidden/backgrounded tab.
  useEffect(() => {
    const maybeReconnect = () => {
      if (shouldReconnectDevice(phaseRef.current, document.visibilityState)) {
        void connect();
      }
    };
    window.addEventListener("focus", maybeReconnect);
    document.addEventListener("visibilitychange", maybeReconnect);
    return () => {
      window.removeEventListener("focus", maybeReconnect);
      document.removeEventListener("visibilitychange", maybeReconnect);
    };
  }, [connect]);

  // Heartbeat + off-duty resync, one cadence: each tick fires both paths and
  // each self-gates on the opposite duty state (beat() while on duty, resync
  // while off). Refs are read inside the interval so a duty flip never tears
  // the interval down; deps rebuild exactly when [intendedStatus] did
  // (resyncTick is []-stable).
  useEffect(() => {
    const tick = () => {
      void beat();
      void resyncTick();
    };
    const id = setInterval(tick, HEARTBEAT_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [beat, resyncTick]);

  // D13 hydration is now OWNED by the DutyProvider (one GET, shared with the
  // header) — the softphone only mirrors `duty.hydrated`. But the immediate
  // first beat stays the softphone's job (it owns the heartbeat): fire a gated
  // beat the moment hydration settles so a mid-shift refresh re-stamps last_seen
  // before the 90s window lapses (hydration read it as live at up-to-89s). Gated,
  // so an off-duty hydration posts nothing (incl. the registration stamp above).
  useEffect(() => {
    if (dutyHydrated) void beatRef.current();
  }, [dutyHydrated]);

  // Clean up the caption-grab poll if the component unmounts mid-call.
  useEffect(() => () => {
    if (captionGrabRef.current) clearInterval(captionGrabRef.current);
  }, []);

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    // Duty hard-gate (spec §7.1, finding #3): an agent who went off-duty or
    // on-break AFTER this call started ringing must not be able to answer it.
    // The dial already presence-gates who rings, but a flip-to-break while a
    // call is mid-ring is the uncovered edge — and /api/twilio/voice/answered is
    // ungated (it would flip her ON_CALL server-side). accept() is the only path
    // to the media + that route, so guarding here fully blocks the answer.
    //
    // BOTH channels are now gated in the card UI as well (spec §3.6 —
    // PropertyCard and the unmatched-ring fallback). That does NOT make this
    // line redundant and it must not be deleted as duplication of the card
    // guard. The card guard is presentation only: it withholds a click and
    // offers to start the shift, and it decides from the `gated` value of its
    // LAST RENDER — so a flip to off-duty between that render and the click
    // passes straight through it. That is the exact mid-ring edge named above,
    // and this reads the ref at invocation instead. With no server-side duty
    // check on /api/twilio/voice/answered, this is the authoritative gate for
    // answering audio.
    // No DutyProvider (owner surfaces / isolated tests) -> canWork = true.
    if (!canWorkRef.current) return;
    call.accept();
    answeredAtRef.current = Date.now();
    setMuted(false);
    setPhase("in-call");
    // The remote MediaStream isn't ready synchronously after accept(); poll
    // briefly until Twilio exposes it, then caption it. Bounded so a call that
    // never connects media doesn't poll forever.
    if (captionGrabRef.current) clearInterval(captionGrabRef.current);
    let tries = 0;
    captionGrabRef.current = setInterval(() => {
      const t = call.getRemoteStream?.()?.getAudioTracks?.()[0] ?? null;
      if (t || ++tries > 25) {
        if (captionGrabRef.current) clearInterval(captionGrabRef.current);
        captionGrabRef.current = null;
        if (t) setGuestAudioTrack(t);
      }
    }, 200);
    const ans = await reliableFetch(
      "/api/twilio/voice/answered",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: callIdRef.current }),
      },
      { label: "calls.answered" },
    );
    if (ans && ans.ok) {
      const data = (await ans.json().catch(() => null)) as { timeZone?: string | null } | null;
      if (data && typeof data.timeZone === "string") setCallTimeZone(data.timeZone);
    }
  }, []);

  // Expose accept to the property cards — via a STABLE wrapper (acceptCall is
  // already useCallback-stable), registered/unregistered on the ring edge. Kept
  // beside acceptCall so its [acceptCall] dep is defined (no temporal-dead-zone).
  const acceptAudioForCards = useCallback(() => {
    void acceptCall();
  }, [acceptCall]);
  useEffect(() => {
    if (!registerAcceptAudio) return;
    registerAcceptAudio(phase === "incoming" ? acceptAudioForCards : null);
    return () => registerAcceptAudio(null);
  }, [registerAcceptAudio, phase, acceptAudioForCards]);

  const endCall = useCallback(async () => {
    const id = callIdRef.current;
    if (emergencyActiveRef.current && id) {
      // SDK can't disconnect the redirected leg — remove the agent from the
      // conference server-side. Guest + 911 continue (endConferenceOnExit=false).
      await reliableFetch(
        `/api/calls/${id}/emergency/control`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "leave" }),
        },
        { label: "emergency.control" },
      );
    }
    try {
      callRef.current?.disconnect();
    } catch {
      // ignore
    }
    callRef.current = null;
    // Capture typed values before clearing, then reset the call UI immediately
    // (the call is over). The save runs in the background; a failure shows a
    // phase-independent banner without blocking a new incoming call.
    const room = roomNumberRef.current;
    const note = notesRef.current;
    setRoomNumber("");
    setNotes("");
    setMuted(false);
    setEmergencyActive(false);
    setEmergencyFailed(false);
    setCallTimeZone(null);
    if (captionGrabRef.current) {
      clearInterval(captionGrabRef.current);
      captionGrabRef.current = null;
    }
    setGuestAudioTrack(null);
    setPhase("ready");
    // Post-call restore also applies the gate's verdict (D13): if the shift
    // lapsed mid-call (slept machine), the tab flips off duty now instead of
    // waiting for the next interval beat.
    applyBeatResult(await postPresence(readyRef.current ? "AVAILABLE" : "AWAY"));
    if (id && (room || note)) {
      void saveNotes({ callId: id, roomNumber: room, notes: note });
    }
  }, [saveNotes, applyBeatResult]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next); // optimistic
    if (emergencyActiveRef.current) {
      // The agent's leg was redirected into the conference; the browser SDK can no
      // longer control it, so mute via the server-side Conference Participant API.
      // On a live 911 call a wrong mute state matters, so report failures and
      // revert the optimistic toggle if the server didn't take it.
      const id = callIdRef.current;
      if (id) {
        void reliableFetch(
          `/api/calls/${id}/emergency/control`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: next ? "mute" : "unmute" }),
          },
          { label: "emergency.control" },
        ).then((res) => {
          if (!res || !res.ok) setMuted((m) => (m === next ? !next : m));
        });
      }
    } else {
      callRef.current?.mute(next);
    }
  }, [muted]);

  const triggerEmergency = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    setEmergencyActive(true); // optimistic; the conference merge is server-side
    setEmergencyFailed(false);
    try {
      const res = await fetch(`/api/calls/${id}/emergency`, { method: "POST" });
      if (!res.ok) {
        // Dispatch failed. Roll emergencyActive back to whether the agent's own
        // leg was actually redirected into the conference: if it wasn't, the
        // agent is still on the normal SDK bridge, so mute/hangup must use the
        // SDK again (and the button re-enables for a retry). If it was, keep it
        // true so controls stay server-side. Either way, surface the failure.
        const body = (await res.json().catch(() => ({}))) as {
          agentRedirected?: boolean;
        };
        setEmergencyActive(Boolean(body.agentRedirected));
        setEmergencyFailed(true);
        console.error("[softphone] emergency trigger failed:", res.status);
        Sentry.captureException(new Error(`emergency.trigger ${res.status}`), {
          extra: { label: "emergency.trigger", status: res.status },
        });
      }
    } catch (err) {
      // Unknown server state — keep controls server-side (safer) and warn.
      setEmergencyFailed(true);
      console.error("[softphone] emergency trigger error:", err);
      Sentry.captureException(err, { extra: { label: "emergency.trigger" } });
    }
  }, []);

  // Task 17: register this call's controls with the CallSurfaceProvider so the
  // tile can drive mute/hang-up/911. Reuses the EXISTING handlers verbatim —
  // toggleMute/endCall/triggerEmergency are untouched; triggerEmergency here IS
  // the real 911 POST trigger (the same function the AudioCallOverlay's confirm
  // dialog invokes), not a re-implementation.
  useEffect(() => {
    if (!registerCallControls) return;
    if (phase !== "in-call") {
      registerCallControls(null);
      return;
    }
    registerCallControls({
      toggleMute,
      muted,
      hangUp: () => void endCall(),
      triggerEmergency: () => void triggerEmergency(),
    });
    return () => registerCallControls(null);
  }, [registerCallControls, phase, toggleMute, muted, endCall, triggerEmergency]);

  // The "Accepting calls" AWAY toggle stays here (the softphone owns the beat),
  // but its VALUE is the provider's `accepting` (readyRef mirrors it). Flip the
  // provider optimistically so the label + the beat's intendedStatus agree, set
  // the ref synchronously for the immediate POST + interval beat, then post.
  // Duty ownership (go-on-duty / end-shift) has MOVED to the header DutyControl.
  const toggleReady = useCallback(() => {
    const next = !readyRef.current;
    readyRef.current = next; // synchronous for the interval beat's intendedStatus
    setAcceptingRef.current?.(next); // provider is the accepting source of truth
    void postPresence(next ? "AVAILABLE" : "AWAY").then(applyBeatResult);
  }, [applyBeatResult]);

  // Phase E (Task 19b): the current call's propertyId for the overlay's Connect
  // button — read at render from the ref the "incoming" handler already set.
  const connectPropertyId = incomingPropertyIdRef.current;

  return (
    <div className="rounded-card border border-border bg-card p-4 text-sm shadow-md">
      <div className="flex items-center justify-between">
        <span className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Softphone
        </span>
        <LinePill phase={phase} />
      </div>

      {pendingNotes && (
        <div className="mt-3 rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Couldn&apos;t save notes from the last call.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={notesSave === "saving"}
              onClick={() => void saveNotes(pendingNotes)}
              className="rounded-button bg-destructive px-3 py-1 font-medium text-destructive-foreground disabled:opacity-50"
            >
              {notesSave === "saving" ? "Saving…" : "Retry"}
            </button>
            <button
              type="button"
              disabled={notesSave === "saving"}
              onClick={() => {
                setPendingNotes(null);
                setNotesSave("idle");
              }}
              className="rounded-button border border-border px-3 py-1 text-foreground disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Duty control (Go on duty / On duty timer / Take a break / End shift) now
          lives in the header (DashboardWorkspace → DutyControl), owned by the
          DutyProvider. The softphone consumes that duty state for its heartbeat
          gate but renders no duty buttons of its own. */}

      {phase !== "in-call" && phase !== "error" && (
        <div className="mt-2 flex flex-col items-center">
          {/* Seam-ring idle brand moment — decorative anchor, not a status light.
              Renders through the "incoming" phase too now that the incoming block
              is retired, so the Accepting toggle stays put while a call rings. */}
          <div className="relative mx-auto mt-1 h-16 w-16">
            <span
              aria-hidden="true"
              className="lc-seam-drift absolute -inset-1 rounded-full opacity-40 blur-md"
            />
            <span className="absolute inset-0 grid place-items-center rounded-full border-2 border-border bg-card">
              <Phone size={20} className="text-primary" />
            </span>
          </div>
          <p className="mt-3 text-center text-text-muted">Incoming calls ring here.</p>
          {role === "AGENT" ? (
            <button
              type="button"
              onClick={toggleReady}
              aria-pressed={accepting}
              className={cn(
                "mt-3 w-full rounded-button border px-3 py-2 font-medium transition-colors",
                accepting
                  ? "border-transparent bg-live/15 text-live-foreground"
                  : "border-border text-text-muted",
              )}
            >
              {accepting ? "Accepting calls" : "Not accepting calls"}
            </button>
          ) : (
            <p className="mt-3 text-center text-xs text-text-muted">
              You&apos;re dialed in for properties set to Covering.
            </p>
          )}
        </div>
      )}

      {/* Phase-3 (Task 7): the incoming-block UI is retired — a ringing call now
          surfaces + is answered on its property card via the CallSurfaceProvider.
          The ringtone, tab-title flash, and accept logic stay; the card owns the
          visual + the Answer button. The idle ready/Accepting block above keeps
          rendering through the "incoming" phase. */}

      {phase === "in-call" && (
        <AudioCallOverlay
          propertyName={incomingProperty}
          callId={callIdRef.current}
          muted={muted}
          roomNumber={roomNumber}
          notes={notes}
          timeZone={callTimeZone}
          emergencyActive={emergencyActive}
          emergencyFailed={emergencyFailed}
          onToggleMute={toggleMute}
          onHangUp={() => void endCall()}
          onTriggerEmergency={() => void triggerEmergency()}
          onRoomNumberChange={setRoomNumber}
          onNotesChange={setNotes}
          onSaveNotes={saveNotesNow}
          captionFinals={captions.finals}
          captionPartial={captions.partial}
          captionsEnabled={captionsEnabled}
          onToggleCaptions={toggleCaptions}
          collapsed={tileMount != null}
          showReopenTile={tileClosedByUser && docPipSupported()}
          onReopenTile={() => openTileForCall?.()}
          onConnect={
            surface?.connectToProperty && connectPropertyId
              ? () => void surface.connectToProperty(connectPropertyId)
              : undefined
          }
        />
      )}

      {phase === "error" && (
        <p className="mt-3 text-text-muted">
          Phone line disconnected — reload to reconnect.
        </p>
      )}
    </div>
  );
}

function LinePill({ phase }: { readonly phase: Phase }) {
  const ok = phase === "ready" || phase === "incoming" || phase === "in-call";
  const label =
    phase === "in-call"
      ? "On call"
      : phase === "incoming"
        ? "Incoming"
        : phase === "ready"
          ? "Line ready"
          : phase === "error"
            ? "Offline"
            : "Connecting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        ok ? "bg-live/15 text-live-foreground" : "bg-muted text-text-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          ok ? "bg-live" : "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}
