"use client";
// Incoming-video detection, extracted verbatim from IncomingVideoBanner (Phase 3,
// Task 7). Owns the realtime subscribe (private operator channel), the tick()
// refetch of /api/calls/incoming-video, the 60s safety-net poll, focus refetch,
// the ringtone (rings while any call is waiting), and the ringing tab-title flash.
// Returns the raw incoming-call list; the UI now lives on the property cards and
// the video host, not in a banner.

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import { useRingingTabTitle } from "@/lib/hooks/use-ringing-tab-title";
import { INCOMING_VIDEO_FALLBACK_POLL_MS } from "@lc/shared";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";

export interface IncomingVideoCall {
  id: string;
  channelName: string;
  propertyName: string;
  // The API already returns these; the cards need the id to place the ring and
  // ringStartedAt to seed the on-card elapsed timer.
  propertyId: string | null;
  ringStartedAt: string | null;
}

export function useIncomingVideoCalls(operatorId: string): { calls: IncomingVideoCall[] } {
  const [calls, setCalls] = useState<IncomingVideoCall[]>([]);
  const ringtoneRef = useRef<Ringtone | null>(null);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;
    let resubscribeTimer: ReturnType<typeof setTimeout> | undefined;

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

    const supabase = createBrowserSupabaseClient();
    // Attach the agent JWT so the private-channel RLS authorizes the subscribe.
    // Fire-and-forget: setAuth attaches the JWT before subscribe sends its frame. On a cold first subscribe the SUBSCRIBE may race the token and bounce once to CHANNEL_ERROR; the 1s resubscribe below heals it.
    void supabase.realtime.setAuth();

    const subscribe = () => {
      channel = supabase
        .channel(operatorCallsChannelTopic(operatorId), { config: { private: true } })
        .on("broadcast", { event: CALLS_CHANGED_EVENT }, () => void tick())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Catch up on (re)connect — the refetch is authoritative, so any
            // broadcast missed while disconnected is reconciled here.
            void tick();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Self-heal: drop the dead channel and resubscribe shortly.
            if (channel) void supabase.removeChannel(channel);
            channel = null;
            resubscribeTimer = setTimeout(subscribe, 1_000);
          }
        });
    };
    subscribe();

    // Initial load + slow safety-net poll + focus refetch. Realtime push is the
    // primary path; this 60s poll only backstops a silently-dead subscription.
    void tick();
    const pollId = setInterval(tick, INCOMING_VIDEO_FALLBACK_POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(pollId);
      if (resubscribeTimer) clearTimeout(resubscribeTimer);
      window.removeEventListener("focus", onFocus);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [operatorId]);

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
  // (Answering clears the ring via the card flow, which empties this list — the
  // host publishes [] and the overlay takes over.)
  const isRinging = calls.length > 0;
  useEffect(() => {
    if (isRinging) ringtoneRef.current?.start();
    else ringtoneRef.current?.stop();
  }, [isRinging]);

  // Flash the tab title while ringing so a backgrounded tab is identifiable
  // (the s1-test "whose browser is ringing?" gap).
  const ringingProperty = calls[0]?.propertyName ?? "";
  useRingingTabTitle(
    isRinging,
    ringingProperty ? `Incoming video call · ${ringingProperty}` : "Incoming video call",
  );

  return { calls };
}
