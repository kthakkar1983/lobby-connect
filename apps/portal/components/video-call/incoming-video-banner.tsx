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

    // Unlock autoplay: browsers block audio.play() until the page has seen a user
    // gesture, so an idle agent's first incoming-call ring is silently dropped.
    // Prime the element on the first interaction (skipped if a ring is already
    // playing, so we never cut off an active ring).
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (!audio.paused) return;
      void Promise.resolve(audio.play())
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      ringtone.stop();
      ringtoneRef.current = null;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
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

  // Prominent fixed top-center overlay — an incoming video call must never be
  // buried at the bottom of a scrolled dashboard (VideoCallHost renders this at
  // the end of the workspace column).
  return (
    <div role="alert" aria-live="assertive" className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-card border border-live/40 bg-card p-4 text-sm shadow-lg ring-1 ring-live/20">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-live/15 text-primary">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping rounded-full bg-live/20 motion-reduce:animate-none"
          />
          <Video size={20} className="relative" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Incoming video call</p>
          <p className="truncate text-text-muted">{call!.propertyName}</p>
        </div>
        <button
          type="button"
          onClick={() => onAccept(call!)}
          className="shrink-0 rounded-button bg-live px-4 py-2 font-medium text-primary"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
