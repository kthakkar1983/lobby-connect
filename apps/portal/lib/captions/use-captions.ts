"use client";

import { useEffect, useState } from "react";
import { createCaptionStream, type CaptionStream } from "@/lib/captions/provider";

// Keep only the most recent finalized lines (bounds memory on long calls).
const MAX_FINAL_LINES = 8;

export interface CaptionState {
  finals: string[];
  partial: string;
  status: "idle" | "live" | "error";
}

/**
 * Live captions for a single remote audio track. Pass the guest's
 * MediaStreamTrack (or null when there is no live call). Captions are an
 * enhancement: any failure resolves to status "error" and never throws into
 * the call UI.
 */
export function useCaptions(track: MediaStreamTrack | null): CaptionState {
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [status, setStatus] = useState<"idle" | "live" | "error">("idle");

  useEffect(() => {
    if (!track) {
      setFinals([]);
      setPartial("");
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let stream: CaptionStream | null = null;

    (async () => {
      try {
        const res = await fetch("/api/captions/token");
        if (!res.ok) throw new Error("token");
        const { token } = (await res.json()) as { token: string };
        if (cancelled) return;

        stream = createCaptionStream(token);
        await stream.start(
          track,
          (t) => {
            if (!cancelled) setPartial(t);
          },
          (t) => {
            if (cancelled) return;
            setPartial("");
            if (t) setFinals((f) => [...f, t].slice(-MAX_FINAL_LINES));
          },
        );
        if (!cancelled) setStatus("live");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      stream?.stop();
    };
  }, [track]);

  return { finals, partial, status };
}
