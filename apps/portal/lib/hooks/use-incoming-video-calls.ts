"use client";
// Incoming-video detection, extracted verbatim from IncomingVideoBanner (Phase 3,
// Task 7). Owns the realtime subscribe (private operator channel), the tick()
// refetch of /api/calls/incoming-video, the 60s safety-net poll, focus refetch,
// the ringtone (rings while any call is waiting), and the ringing tab-title flash.
// Returns the raw incoming-call list; the UI now lives on the property cards and
// the video host, not in a banner.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function useIncomingVideoCalls(
  operatorId: string,
  silencedKeys?: ReadonlySet<string>,
  activeCallId?: string | null,
): { calls: IncomingVideoCall[] } {
  const [calls, setCalls] = useState<IncomingVideoCall[]>([]);
  const ringtoneRef = useRef<Ringtone | null>(null);

  // Track live-ness so a refetch that resolves after unmount can't setState.
  // Was a per-effect `active` closure flag; lifted to a ref so the now-stable
  // `tick` (shared by the realtime AND SW-message effects) can honor it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable across renders — the empty dep array is correct: tick closes over only
  // the literal /api/calls/incoming-video URL, the stable mountedRef, and the
  // stable setCalls setter (no render-scoped values). If a future edit references
  // operatorId/silencedKeys/activeCallId inside tick, that value MUST be added here.
  // BOTH the realtime-subscription effect and the SW-message effect reference this
  // SAME identity, so the SW effect's [tick] dep can't churn and loop.
  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/calls/incoming-video");
      if (!res.ok) return;
      const body = (await res.json()) as { calls: IncomingVideoCall[] };
      if (mountedRef.current) setCalls(body.calls);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let resubscribeTimer: ReturnType<typeof setTimeout> | undefined;

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
      clearInterval(pollId);
      if (resubscribeTimer) clearTimeout(resubscribeTimer);
      window.removeEventListener("focus", onFocus);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [operatorId, tick]);

  // Web Push wake-up (Phase 3, Task 12): the service worker posts every push to
  // open tabs. An incoming-call or call-cleared message just nudges the SAME
  // tick() — ring start AND stop derive from /api/calls/incoming-video truth, so
  // push, realtime, and poll can never disagree. (focus-home is a route action,
  // handled in dashboard-workspace; the hook doesn't know routes and ignores it.)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string };
      if (data?.source !== "lc-push") return;
      if (data.type === "incoming-call" || data.type === "call-cleared") void tick();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [tick]);

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

  // Once a call is answered locally it must stop ringing IMMEDIATELY and never
  // re-ring — do NOT wait for the server refetch that drops it from `calls`. When
  // the agent answers, `answer-video` broadcasts a refresh, but a just-focused
  // tab's realtime socket may still be re-subscribing and miss it, so the answered
  // call lingers until the 60s fallback poll and the ringtone blares ~30s OVER the
  // connected call. (The audio path avoids this by stopping on the local phase
  // change, not a refetch.) `activeCallId` is the call the agent just answered;
  // the answered-id set keeps it excluded after it ends too (so it can't re-ring
  // in the window before the end-video refetch clears it from `calls`).
  const answeredIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeCallId) answeredIdsRef.current.add(activeCallId);
  }, [activeCallId]);
  // Memoized so the array IDENTITY is stable when its inputs are unchanged: the
  // video host's publishRings effect depends on this list, so a fresh .filter()
  // array every render would re-fire that effect → setState → re-render → an
  // infinite loop (OOM). answeredIdsRef is a stable ref read inside; it's kept in
  // sync with activeCallId (a dep), so the memo recomputes exactly when it must.
  const waiting = useMemo(
    () => calls.filter((c) => c.id !== activeCallId && !answeredIdsRef.current.has(c.id)),
    [calls, activeCallId],
  );

  // Split "has a waiting call" (visual — tab-title flash) from "should play audio"
  // (honors local silence). Ring while a call is waiting AND not silenced; silence
  // is local audio only, so the tab-title cue stays through a silence.
  const hasIncoming = waiting.length > 0;
  const shouldRing = waiting.some((c) => !(silencedKeys?.has(`video:${c.id}`) ?? false));
  useEffect(() => {
    if (shouldRing) ringtoneRef.current?.start();
    else ringtoneRef.current?.stop();
  }, [shouldRing]);

  // Flash the tab title while a call is waiting so a backgrounded tab is
  // identifiable (the s1-test "whose browser is ringing?" gap). Uses hasIncoming,
  // NOT shouldRing — silencing must never stop the visual flash.
  const ringingProperty = waiting[0]?.propertyName ?? "";
  useRingingTabTitle(
    hasIncoming,
    ringingProperty ? `Incoming video call · ${ringingProperty}` : "Incoming video call",
  );

  return { calls: waiting };
}
