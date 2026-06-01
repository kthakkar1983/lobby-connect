"use client";

import { useState } from "react";
import { IncomingVideoBanner, type IncomingVideoCall } from "./incoming-video-banner";
import { VideoCall } from "./video-call";

export function VideoCallHost() {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);

  return (
    <>
      {!active && <IncomingVideoBanner onAccept={setActive} />}
      {active && <VideoCall callId={active.id} onClose={() => setActive(null)} />}
    </>
  );
}
