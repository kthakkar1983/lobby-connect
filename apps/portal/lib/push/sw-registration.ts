// Browser-side service-worker + push-subscription helpers. All feature-detected:
// on non-supporting browsers every function is a safe no-op returning null.

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/push-sw.js");
  } catch {
    return null;
  }
}

/** Base64url → Uint8Array (applicationServerKey wants bytes). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function serializeSubscription(sub: PushSubscription): SubscriptionKeys | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Ask permission (must be inside a user gesture) and subscribe. */
export async function ensurePushSubscription(vapidPublicKey: string): Promise<SubscriptionKeys | null> {
  const reg = await registerPushServiceWorker();
  if (!reg) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return serializeSubscription(existing);
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
    return serializeSubscription(sub);
  } catch {
    return null;
  }
}
