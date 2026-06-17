"use client";

import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";

import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import { cn } from "@/lib/utils";

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

  // A persistent card in the right column, directly under the softphone (its
  // sibling) — so video has its own home in that dead space instead of floating
  // over the screen. Shows an idle "ready" state until a call rings, then the
  // mint-accented Accept state.
  const call = calls[0];
  const ringing = Boolean(call);

  return (
    <div
      className={cn(
        "rounded-card border bg-card p-4 text-sm shadow-md",
        ringing ? "border-live/40 ring-1 ring-live/20" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Video
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
            ringing ? "bg-live/15 text-live-foreground" : "bg-muted text-text-muted",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              ringing ? "bg-live" : "bg-muted-foreground/50",
            )}
          />
          {ringing ? "Incoming" : "Ready"}
        </span>
      </div>

      {ringing ? (
        <div className="mt-3" role="alert" aria-live="assertive">
          <div className="flex items-center gap-3">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-live/15 text-primary">
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-live/20 motion-reduce:animate-none"
              />
              <Video size={18} className="relative" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">Incoming video call</p>
              <p className="truncate text-text-muted">{call!.propertyName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAccept(call!)}
            className="mt-3 w-full rounded-button bg-live px-3 py-2 font-medium text-primary"
          >
            Accept video call
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col items-center">
          <div className="relative mx-auto mt-1 h-16 w-16">
            <span
              aria-hidden="true"
              className="lc-seam-drift absolute -inset-1 rounded-full opacity-40 blur-md"
            />
            <span className="absolute inset-0 grid place-items-center rounded-full border-2 border-border bg-card">
              <Video size={20} className="text-primary" />
            </span>
          </div>
          <p className="mt-3 text-center text-text-muted">Video calls ring here.</p>
          <p className="mt-1 text-center text-xs text-text-muted">
            Guests calling from a lobby kiosk.
          </p>
        </div>
      )}
    </div>
  );
}
