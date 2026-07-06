// Browser-side push subscription manager. Wraps the SW-registration primitives
// (sw-registration.ts) with the /api/push/subscription round-trip. Two entry
// points: armPush() (permission-prompting, call from a user gesture) and
// syncPushSubscription() (silent re-sync on load). All feature-detected: on a
// non-supporting browser or with permission not granted, every path no-ops.

import {
  ensurePushSubscription,
  pushSupported,
  registerPushServiceWorker,
  serializeSubscription,
} from "@/lib/push/sw-registration";

/** Full arm: permission prompt allowed (call from a user gesture). */
export async function armPush(): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;
  const sub = await ensurePushSubscription(publicKey);
  if (!sub) return false;
  const res = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  }).catch(() => null);
  return !!res && res.ok;
}

/** Silent re-sync on load: no permission prompt; refreshes last_seen_at. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registerPushServiceWorker();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const keys = sub ? serializeSubscription(sub) : null;
  if (!keys) return;
  void fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(keys),
  }).catch(() => {});
}

export function pushArmed(): boolean {
  return pushSupported() && Notification.permission === "granted";
}
