import { reliableFetch } from "@/lib/http/reliable-fetch";

export interface RemoteCredentials {
  peerId: string;
  password: string;
}

export type FetchCredsResult =
  | { ok: true; creds: RemoteCredentials }
  | { ok: false; notConfigured: boolean };

export function buildRustdeskUrl(peerId: string, password: string): string {
  return `rustdesk://connection/new/${encodeURIComponent(peerId)}?password=${encodeURIComponent(password)}`;
}

/**
 * kind "prewarm": background fetch at Answer — default retries; audited trigger=prewarm.
 * kind "click": user-gesture path — retries capped at 1 so a crawling fetch cannot
 * outlive the transient-activation window for the rustdesk:// navigation (spec §8.6).
 * notConfigured distinguishes a 404 (negative-cacheable) from transport failure (never cached).
 */
export async function fetchRemoteCredentials(
  propertyId: string,
  kind: "prewarm" | "click",
): Promise<FetchCredsResult> {
  const qs = kind === "prewarm" ? "?trigger=prewarm" : "";
  const res = await reliableFetch(`/api/remote-access/${propertyId}${qs}`, undefined, {
    label: "remote_access.credentials",
    ...(kind === "click" ? { retries: 1 } : {}),
  });
  if (!res) return { ok: false, notConfigured: false };
  if (res.status === 404) return { ok: false, notConfigured: true };
  if (!res.ok) return { ok: false, notConfigured: false };
  const data = (await res.json().catch(() => null)) as RemoteCredentials | null;
  return data ? { ok: true, creds: data } : { ok: false, notConfigured: false };
}

/**
 * Launch the native RustDesk client via its `rustdesk://` deep link WITHOUT
 * navigating the top window. A top-level navigation to an external scheme
 * (window.location.assign, or an anchor without target) fires the page's
 * pagehide/unload — which tears down any live LiveKit WebRTC PeerConnections,
 * killing an in-progress video call the instant Connect is pressed (root-caused
 * on staging 2026-07-07: call survives backgrounding, dies only on the launch).
 * A transient hidden iframe navigates a throwaway SUBFRAME instead, so the top
 * document and its media connections are never unloaded. Created synchronously
 * within the click so the OS handoff keeps the user activation.
 */
export function launchRustdesk(creds: RemoteCredentials): void {
  if (typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.display = "none";
  iframe.src = buildRustdeskUrl(creds.peerId, creds.password);
  document.body.appendChild(iframe);
  // Remove once the OS has picked up the scheme; harmless if already gone.
  window.setTimeout(() => iframe.remove(), 2000);
}
