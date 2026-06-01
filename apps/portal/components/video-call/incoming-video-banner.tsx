"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";

export interface IncomingVideoCall {
  id: string;
  channelName: string;
  propertyName: string;
}

const POLL_MS = 20_000;

export function IncomingVideoBanner({ onAccept }: { onAccept: (call: IncomingVideoCall) => void }) {
  const [calls, setCalls] = useState<IncomingVideoCall[]>([]);

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
