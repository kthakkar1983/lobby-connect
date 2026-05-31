"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";

import type { PresenceStatus } from "@/lib/voice/presence";

type Phase = "connecting" | "ready" | "incoming" | "in-call" | "error";

interface SoftphoneProps {
  readonly role: "AGENT" | "ADMIN";
}

const HEARTBEAT_MS = 20_000;

async function postPresence(status: PresenceStatus): Promise<void> {
  await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

export function Softphone({ role }: SoftphoneProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [ready, setReady] = useState(true); // login defaults to AVAILABLE
  const [muted, setMuted] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const callIdRef = useRef<string>("");
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Current intended presence, derived from local UI state.
  const intendedStatus = useCallback((): PresenceStatus => {
    if (phase === "in-call") return "ON_CALL";
    return readyRef.current ? "AVAILABLE" : "AWAY";
  }, [phase]);

  // Register the Twilio Device once.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let device: any;

    (async () => {
      try {
        const res = await fetch("/api/twilio/token");
        if (!res.ok) throw new Error("token");
        const { token } = (await res.json()) as { token: string };

        const { Device } = await import("@twilio/voice-sdk");
        device = new Device(token, { closeProtection: true });
        deviceRef.current = device;

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
          if (!cancelled) setPhase("incoming");
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
    await fetch("/api/twilio/voice/answered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId: callIdRef.current }),
    }).catch(() => {});
  }, []);

  const declineCall = useCallback(() => {
    callRef.current?.reject();
    callRef.current = null;
    setPhase("ready");
  }, []);

  const endCall = useCallback(async () => {
    const id = callIdRef.current;
    try {
      callRef.current?.disconnect();
    } catch {
      // ignore
    }
    callRef.current = null;
    if (id && (roomNumber || notes)) {
      await fetch("/api/calls/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: id, roomNumber, notes }),
      }).catch(() => {});
    }
    setRoomNumber("");
    setNotes("");
    setMuted(false);
    setPhase("ready");
    await postPresence(readyRef.current ? "AVAILABLE" : "AWAY");
  }, [roomNumber, notes]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }, [muted]);

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

      {role === "AGENT" && phase !== "in-call" && phase !== "incoming" && (
        <button
          type="button"
          onClick={toggleReady}
          className="mt-3 w-full rounded-md border border-border px-3 py-2 text-foreground"
        >
          {ready ? "Ready — accepting calls" : "Away — not accepting"}
        </button>
      )}

      {phase === "incoming" && (
        <div className="mt-3 space-y-2">
          <p className="text-text-muted">Incoming call…</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void acceptCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground"
            >
              <Phone size={16} /> Accept
            </button>
            <button
              type="button"
              onClick={declineCall}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-foreground"
            >
              <PhoneOff size={16} /> Decline
            </button>
          </div>
        </div>
      )}

      {phase === "in-call" && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-foreground"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void endCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2 text-destructive-foreground"
            >
              <PhoneOff size={16} /> Hang up
            </button>
          </div>
          <input
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            placeholder="Room #"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Call notes"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
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
        ok ? "bg-primary" : "bg-muted"
      }`}
      aria-label={ok ? "connected" : "disconnected"}
    />
  );
}
