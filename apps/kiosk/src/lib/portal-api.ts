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
 * The result of one incoming-call discovery poll. Deliberately DISCRIMINATED so
 * a caller can tell the call is genuinely gone (`idle` — a 200 with an empty
 * body) apart from a request that merely failed (`error` — network / 5xx). That
 * distinction is load-bearing on the incoming screen: `idle` returns the kiosk
 * home, but `error` must be ignored so a single transient blip can't silence a
 * live ring (or hang the kiosk on a dead one).
 */
export type IncomingPoll =
  | { status: "ringing"; call: CallStartResult }
  | { status: "idle" }
  | { status: "error" };

/**
 * The kiosk's discovery poll (~3s) for an agent-initiated OUTBOUND call — the
 * reverse of the agent's incoming-video poll/push. An unauthenticated kiosk has
 * no push channel to target, so it must discover its own ring. Never throws:
 * any failure (missing token, network hiccup, 5xx, malformed body) collapses to
 * `{ status: "error" }` so a bad tick just waits for the next poll instead of
 * surfacing an error from a background loop.
 */
export async function fetchIncomingCall(): Promise<IncomingPoll> {
  try {
    const res = await fetch(`${getPortalApiBase()}/api/kiosk/incoming-call`, { headers: headers() }).catch(() => null);
    if (!res || !res.ok) return { status: "error" };
    const call = (await res.json()) as CallStartResult | null;
    return call ? { status: "ringing", call } : { status: "idle" };
  } catch {
    return { status: "error" };
  }
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
