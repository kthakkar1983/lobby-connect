"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { IncomingVideoBanner, type IncomingVideoCall } from "./incoming-video-banner";

// Agora is a client-only SDK (touches window/WebRTC on import), so load the
// call surface lazily and skip SSR entirely.
const VideoCall = dynamic(() => import("./video-call").then((m) => m.VideoCall), {
  ssr: false,
});

export function VideoCallHost({ operatorId }: { operatorId: string }) {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);

  return (
    <>
      {!active && <IncomingVideoBanner operatorId={operatorId} onAccept={setActive} />}
      {active && <VideoCall callId={active.id} onClose={() => setActive(null)} propertyName={active.propertyName} />}
    </>
  );
}
