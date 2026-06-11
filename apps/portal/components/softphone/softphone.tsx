"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { attachTokenAutoRefresh } from "@/lib/voice/device-resilience";
import type { PresenceStatus } from "@/lib/voice/presence";
import { useLineStatus } from "@/lib/dashboard/line-status";
import { reliableFetch } from "@/lib/http/reliable-fetch";

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
    if (emergencyActiveRef.current) {
      // The agent's leg was redirected into the conference; the browser SDK can no
      // longer control it, so mute via the server-side Conference Participant API.
      const id = callIdRef.current;
      if (id) {
        void fetch(`/api/calls/${id}/emergency/control`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: next ? "mute" : "unmute" }),
        }).catch(() => {});
      }
    } else {
      callRef.current?.mute(next);
    }
    setMuted(next);
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
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">Softphone</span>
        <ConnectionDot phase={phase} />
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

      {role === "AGENT" && phase !== "in-call" && phase !== "incoming" && (
        <>
          {/* Idle glow ring — decorative anchor, not a status indicator */}
          <div className="relative mx-auto mt-2 h-16 w-16">
            <span
              aria-hidden="true"
              className="lc-seam-drift absolute -inset-1 rounded-full opacity-40 blur-md"
            />
            <span className="absolute inset-0 grid place-items-center rounded-full border-2 border-border bg-card">
              <Phone size={20} className="text-primary" />
            </span>
          </div>
          <button
            type="button"
            onClick={toggleReady}
            className="mt-3 w-full rounded-button border border-border px-3 py-2 text-foreground"
          >
            {ready ? "Ready — accepting calls" : "Away — not accepting"}
          </button>
        </>
      )}

      {phase === "incoming" && (
        <div className="mt-3 space-y-2">
          <p className="text-text-muted">
            {incomingProperty ? `Incoming call · ${incomingProperty}` : "Incoming call…"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void acceptCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-button bg-live px-3 py-2 font-medium text-primary"
            >
              <Phone size={16} /> Accept
            </button>
            <button
              type="button"
              onClick={declineCall}
              className="flex flex-1 items-center justify-center gap-2 rounded-button border border-border px-3 py-2 text-foreground"
            >
              <PhoneOff size={16} /> Decline
            </button>
          </div>
        </div>
      )}

      {phase === "in-call" && (
        <div className="mt-3 space-y-3">
          {/* Seam hairline — "connected" cue (drifting gradient angle) */}
          <div className="lc-seam-drift h-px w-full" aria-hidden="true" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className="flex flex-1 items-center justify-center gap-2 rounded-button border border-border px-3 py-2 text-foreground"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void endCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-button bg-accent-strong px-3 py-2 text-[1.1875rem] font-bold leading-none text-accent-foreground"
            >
              <PhoneOff size={18} /> Hang up
            </button>
          </div>
          {emergencyActive && !emergencyFailed && (
            <p className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Emergency active — 911 is being conferenced in. Stay on the line and relay the
              property address and room number.
            </p>
          )}
          {emergencyFailed && (
            <p className="rounded-input border border-destructive bg-destructive/15 px-3 py-2 text-sm font-medium text-destructive">
              911 dispatch failed. Relay the property address and room number verbally, and have
              the guest hang up and dial 911 directly.
            </p>
          )}
          <input
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            placeholder="Room #"
            className="w-full rounded-input border border-border bg-background px-3 py-2 text-foreground"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Call notes"
            rows={3}
            className="w-full rounded-input border border-border bg-background px-3 py-2 text-foreground"
          />
          <hr className="my-3 border-border" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={emergencyActive}
                className="flex w-full items-center justify-center gap-2 rounded-button bg-destructive px-3 py-2 font-medium text-destructive-foreground disabled:opacity-50"
              >
                <AlertTriangle size={16} /> {emergencyActive ? "911 active" : "Call 911 — emergency"}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Call emergency services (911)?</AlertDialogTitle>
                <AlertDialogDescription>
                  This conferences 911 into the live call — the guest, you, and the dispatcher on one line — and logs a high-priority incident.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Not life-threatening? Cancel and use the property&apos;s local non-emergency number instead. Only continue for a genuine emergency.
              </div>
              {/* FORWARD-COMPAT SEAM: when the on-call-manager notify feature lands (cut from v1), add an
                  "also alerts the admin, owner, and property GM" line above. Don't render it until the
                  backend actually sends those alerts. */}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void triggerEmergency()}
                  className="bg-destructive text-destructive-foreground"
                >
                  Yes — call 911
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {phase === "error" && (
        <p className="mt-3 text-text-muted">
          Phone line disconnected — reload to reconnect.
        </p>
      )}
    </div>
  );
}

function ConnectionDot({ phase }: { readonly phase: Phase }) {
  const ok = phase === "ready" || phase === "incoming" || phase === "in-call";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? "bg-live" : "bg-muted-foreground/40"
      }`}
      aria-label={ok ? "connected" : "disconnected"}
    />
  );
}
