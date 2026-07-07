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

/** Launch the native client. location.assign on a custom scheme never unloads the page. */
export function launchRustdesk(creds: RemoteCredentials): void {
  window.location.assign(buildRustdeskUrl(creds.peerId, creds.password));
}
