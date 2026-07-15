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

/**
 * The kiosk's discovery poll (~3s while idle on Home) for an agent-initiated
 * OUTBOUND call — the reverse of the agent's incoming-video poll/push. An
 * unauthenticated kiosk has no push channel to target, so it must discover its
 * own ring. Swallows every failure to `null` (network hiccup or no ringing
 * call) rather than throwing, so a bad tick just waits for the next poll
 * instead of surfacing an error from a background loop.
 */
export async function fetchIncomingCall(): Promise<CallStartResult | null> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/incoming-call`, { headers: headers() }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as CallStartResult | null;
}

/**
 * Claim an agent-initiated OUTBOUND call (RINGING -> IN_PROGRESS) in response
 * to the guest tapping Answer. `null` covers the "gone" case — the agent
 * cancelled, the call timed out, or a double-tap lost the race (server 409) —
 * as well as a network failure; the caller treats both the same (return home).
 */
export async function answerCall(callId: string): Promise<{ channelName: string } | null> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/answer-call`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ callId }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as { channelName: string };
}
