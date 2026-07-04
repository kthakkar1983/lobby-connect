"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { attachTokenAutoRefresh, shouldReconnectDevice } from "@/lib/voice/device-resilience";
import type { PresenceStatus } from "@/lib/voice/presence";
import { useLineStatus } from "@/lib/dashboard/line-status";
import { useRingingTabTitle } from "@/lib/hooks/use-ringing-tab-title";
import { reliableFetch } from "@/lib/http/reliable-fetch";
import { cn } from "@/lib/utils";
import { useCaptions } from "@/lib/captions/use-captions";
import { useCaptionsEnabled } from "@/lib/captions/use-captions-enabled";

type Phase = "connecting" | "ready" | "incoming" | "in-call" | "error";

interface SoftphoneProps {
  readonly role: "AGENT" | "ADMIN";
}

const HEARTBEAT_MS = 20_000;
// Fire the Device's `tokenWillExpire` 30s before expiry (SDK default is 10s,
// too tight to reliably refetch before the token lapses).
const TOKEN_REFRESH_LEAD_MS = 30_000;

async function postPresence(status: PresenceStatus): Promise<void> {
  await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

async function fetchVoiceToken(): Promise<string> {
  const res = await fetch("/api/twilio/token");
  if (!res.ok) throw new Error("token");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export function Softphone({ role }: SoftphoneProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [ready, setReady] = useState(true); // login defaults to AVAILABLE
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
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Ref-mirror roomNumber/notes so the stale SDK event-listener closures
  // (device "incoming" → call "disconnect") always read the current values.
  const roomNumberRef = useRef(roomNumber);
  roomNumberRef.current = roomNumber;
  const notesRef = useRef(notes);
  notesRef.current = notes;

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

  const { enabled: captionsEnabled, toggle: toggleCaptions } = useCaptionsEnabled();
  // Gating the track (not just hiding the band) tears down the STT stream when
  // captions are off — stops the upstream audio + the per-minute billing.
  const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);

  // Current intended presence, derived from local UI state.
  const intendedStatus = useCallback((): PresenceStatus => {
    if (phase === "in-call") return "ON_CALL";
    return readyRef.current ? "AVAILABLE" : "AWAY";
  }, [phase]);

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

  // Publish the audio incoming ring (id comes from the new propertyId Parameter).
  useEffect(() => {
    if (!publishRings) return;
    publishRings(
      "audio",
      phase === "incoming"
        ? [
            {
              key: callIdRef.current || "audio",
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
    publishActive(
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
      await postPresence("AVAILABLE");
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

  // Heartbeat: keep last_seen + status fresh while mounted.
  useEffect(() => {
    const id = setInterval(() => {
      void postPresence(intendedStatus());
    }, HEARTBEAT_MS);
    const onFocus = () => void postPresence(intendedStatus());
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [intendedStatus]);

  // Clean up the caption-grab poll if the component unmounts mid-call.
  useEffect(() => () => {
    if (captionGrabRef.current) clearInterval(captionGrabRef.current);
  }, []);

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
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
    await postPresence(readyRef.current ? "AVAILABLE" : "AWAY");
    if (id && (room || note)) {
      void saveNotes({ callId: id, roomNumber: room, notes: note });
    }
  }, [saveNotes]);

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

  const toggleReady = useCallback(() => {
    const next = !ready;
    setReady(next);
    void postPresence(next ? "AVAILABLE" : "AWAY");
  }, [ready]);

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
              aria-pressed={ready}
              className={cn(
                "mt-3 w-full rounded-button border px-3 py-2 font-medium transition-colors",
                ready
                  ? "border-transparent bg-live/15 text-live-foreground"
                  : "border-border text-text-muted",
              )}
            >
              {ready ? "Accepting calls" : "Not accepting calls"}
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
