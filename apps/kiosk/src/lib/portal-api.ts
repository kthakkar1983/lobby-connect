import { getKioskToken, getPortalApiBase } from "./config";
import type { KioskConfig, CallStartResult, VideoTokenResult } from "../types";

function headers(): HeadersInit {
  const token = getKioskToken();
  if (!token) throw new Error("Kiosk is not configured (missing config token).");
  return { "content-type": "application/json", "x-kiosk-token": token };
}

export async function fetchKioskConfig(): Promise<KioskConfig> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/config`, { headers: headers() });
  if (!res.ok) throw new Error(`config ${res.status}`);
  return (await res.json()) as KioskConfig;
}

export async function startCall(): Promise<CallStartResult> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/call-started`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`call-started ${res.status}`);
  return (await res.json()) as CallStartResult;
}

export async function endCall(callId: string, reason: "completed" | "no-answer" | "cancelled" | "failed"): Promise<void> {
  await fetch(`${getPortalApiBase()}/api/kiosk/call-ended`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ callId, reason }),
  }).catch(() => {});
}

export async function fetchVideoToken(channel: string, uid: number): Promise<VideoTokenResult> {
  const url = new URL(`${getPortalApiBase()}/api/video/token`);
  url.searchParams.set("channel", channel);
  url.searchParams.set("uid", String(uid));
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`video-token ${res.status}`);
  return (await res.json()) as VideoTokenResult;
}

export async function sendHeartbeat(): Promise<void> {
  await fetch(`${getPortalApiBase()}/api/kiosk/heartbeat`, {
    method: "POST",
    headers: headers(),
  }).catch(() => {});
}
