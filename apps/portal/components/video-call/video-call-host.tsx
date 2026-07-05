"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import {
  useIncomingVideoCalls,
  type IncomingVideoCall,
} from "@/lib/hooks/use-incoming-video-calls";
import { unlockAudioPlayback } from "@/lib/video/audio-unlock";

// Agora is a client-only SDK (touches window/WebRTC on import), so load the
// call surface lazily and skip SSR entirely.
const VideoCall = dynamic(() => import("./video-call").then((m) => m.VideoCall), {
  ssr: false,
});

/**
 * Headless video-call host: detects incoming video calls (via the extracted
 * hook), PUBLISHES the ring set into the CallSurfaceProvider so the property
 * cards can show + answer it, and mounts the full-screen VideoCall once a call
 * is accepted from a card. No visible banner of its own.
 */
export function VideoCallHost({ operatorId }: { operatorId: string }) {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);
  const surface = useCallSurfaceOptional();
  // Read the silenced set as a plain value (never depend on `surface` itself)
  // and pass it into the hook so a silenced video ring mutes the audio ringer
  // while the tab-title flash + card ring stay visible.
  const silencedKeys = surface?.silencedKeys;
  const { calls } = useIncomingVideoCalls(operatorId, silencedKeys);
  const publishRings = surface?.publishRings;
  const registerAcceptVideo = surface?.registerAcceptVideo;

  // ⚠ DEP-HYGIENE (Task-6 review): depend on the stable dispatchers, never on
  // `surface` — registering mutates the context value and would loop.
  useEffect(() => {
    if (!publishRings) return;
    publishRings(
      "video",
      active
        ? []
        : calls.map((c) => ({
            key: `video:${c.id}`,
            channel: "VIDEO" as const,
            callId: c.id,
            propertyId: c.propertyId,
            propertyName: c.propertyName,
            since: (() => {
              const parsed = Date.parse(c.ringStartedAt ?? "");
              return Number.isNaN(parsed) ? Date.now() : parsed;
            })(),
          })),
    );
  }, [publishRings, calls, active]);

  // Registered callback must be identity-stable: read `calls` through a ref.
  const callsRef = useRef(calls);
  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);
  const acceptVideoForCards = useCallback((callId: string) => {
    const call = callsRef.current.find((c) => c.id === callId);
    if (!call) return;
    // Unlock audio output on this gesture (the card's Answer click is a user
    // gesture) so the guest's audio plays even after the cold join chain —
    // this used to live on the banner's Accept button.
    unlockAudioPlayback();
    setActive(call);
  }, []);
  useEffect(() => {
    if (!registerAcceptVideo) return;
    registerAcceptVideo(acceptVideoForCards);
    return () => registerAcceptVideo(null);
  }, [registerAcceptVideo, acceptVideoForCards]);

  return active ? (
    <VideoCall
      callId={active.id}
      propertyName={active.propertyName}
      onClose={() => setActive(null)}
    />
  ) : null;
}
