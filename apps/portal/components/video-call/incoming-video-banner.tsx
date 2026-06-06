"use client";

import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";

import { createRingtone, type Ringtone } from "@/lib/video/ringtone";

export interface IncomingVideoCall {
  id: string;
  channelName: string;
  propertyName: string;
}

// Poll briskly so the ring starts within a few seconds of the guest tapping
// Call (the agent has no push signal for video — see the kiosk-video design doc).
const POLL_MS = 3_000;

export function IncomingVideoBanner({ onAccept }: { onAccept: (call: IncomingVideoCall) => void }) {
  const [calls, setCalls] = useState<IncomingVideoCall[]>([]);
  const ringtoneRef = useRef<Ringtone | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/calls/incoming-video");
        if (!res.ok) return;
        const body = (await res.json()) as { calls: IncomingVideoCall[] };
        if (active) setCalls(body.calls);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Build the ringtone once, on the client only (new Audio needs the browser).
  useEffect(() => {
    const audio = new Audio("/sounds/ring.mp3");
    audio.loop = true;
    audio.preload = "auto";
    const ringtone = createRingtone(audio);
    ringtoneRef.current = ringtone;
    return () => {
      ringtone.stop();
      ringtoneRef.current = null;
    };
  }, []);

  // Ring while a call is waiting; silence it once answered, declined, or gone.
  // (Accepting unmounts this banner, whose cleanup also stops the ring.)
  const isRinging = calls.length > 0;
  useEffect(() => {
    if (isRinging) ringtoneRef.current?.start();
    else ringtoneRef.current?.stop();
  }, [isRinging]);

  if (calls.length === 0) return null;
  const call = calls[0];

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Video size={16} /> Incoming video call · {call!.propertyName}
      </div>
      <button
        type="button"
        onClick={() => onAccept(call!)}
        className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-primary-foreground"
      >
        Accept video call
      </button>
    </div>
  );
}
