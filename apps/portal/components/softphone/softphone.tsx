"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";
import { attachTokenAutoRefresh } from "@/lib/voice/device-resilience";
import type { PresenceStatus } from "@/lib/voice/presence";
import { useLineStatus } from "@/lib/dashboard/line-status";
import { reliableFetch } from "@/lib/http/reliable-fetch";
import { cn } from "@/lib/utils";

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
      if (res && res.ok) {
        setNotesSave("idle");
        setPendingNotes(null);
      } else {
        setNotesSave("failed");
        setPendingNotes(payload);
      }
    },
    [],
  );

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

  // Register the Twilio Device once.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let device: any;

    (async () => {
      try {
        const token = await fetchVoiceToken();

        const { Device } = await import("@twilio/voice-sdk");
        device = new Device(token, {
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
          if (!cancelled) setPhase("ready");
        });
        device.on("error", () => {
          if (!cancelled) setPhase("error");
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        device.on("incoming", (call: any) => {
          callRef.current = call;
          callIdRef.current = call.customParameters?.get("callId") ?? "";
          if (!cancelled) {
            setIncomingProperty(call.customParameters?.get("propertyName") ?? "");
            setPhase("incoming");
          }
          call.on("disconnect", () => {
            void endCall();
          });
          call.on("cancel", () => {
            callRef.current = null;
            if (!cancelled) setPhase("ready");
          });
        });

        await device.register();
        await postPresence("AVAILABLE");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        device?.destroy();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    call.accept();
    setMuted(false);
    setPhase("in-call");
    await reliableFetch(
      "/api/twilio/voice/answered",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: callIdRef.current }),
      },
      { label: "calls.answered" },
    );
  }, []);

  const declineCall = useCallback(() => {
    callRef.current?.reject();
    callRef.current = null;
    setPhase("ready");
  }, []);

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

      {phase !== "in-call" && phase !== "incoming" && phase !== "error" && (
        <div className="mt-2 flex flex-col items-center">
          {/* Seam-ring idle brand moment — decorative anchor, not a status light. */}
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

      {/* Incoming rings as a prominent fixed overlay (top-center) so a
          time-critical call is never buried at the bottom of a scrolled
          dashboard. Escapes the softphone card via `fixed`; visible whenever the
          softphone is mounted-and-shown (agent always-home; admin on home — admin
          off-home is covered by IncomingCallToast). */}
      {phase === "incoming" && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
        >
          <div className="flex w-full max-w-md items-center gap-3 rounded-card border border-live/40 bg-card p-4 shadow-lg ring-1 ring-live/20">
            <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-live/15 text-primary">
              <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-live/20" />
              <Phone size={20} className="relative" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">Incoming call</p>
              <p className="truncate text-text-muted">{incomingProperty || "Connecting…"}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void acceptCall()}
                className="flex items-center justify-center gap-2 rounded-button bg-live px-4 py-2 font-medium text-primary"
              >
                <Phone size={16} /> Accept
              </button>
              <button
                type="button"
                onClick={declineCall}
                className="flex items-center justify-center gap-2 rounded-button border border-border px-3 py-2 text-foreground"
              >
                <PhoneOff size={16} /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "in-call" && (
        <AudioCallOverlay
          propertyName={incomingProperty}
          callId={callIdRef.current}
          muted={muted}
          roomNumber={roomNumber}
          notes={notes}
          emergencyActive={emergencyActive}
          emergencyFailed={emergencyFailed}
          onToggleMute={toggleMute}
          onHangUp={() => void endCall()}
          onTriggerEmergency={() => void triggerEmergency()}
          onRoomNumberChange={setRoomNumber}
          onNotesChange={setNotes}
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
