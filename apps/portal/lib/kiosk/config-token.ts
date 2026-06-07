import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Re-exported for back-compat: callers historically import getKioskConfigSecret
// from here. It now lives in a crypto-free sibling so instrumentation.ts can
// import it without pulling node:crypto. See config-secret.ts.
export { getKioskConfigSecret } from "@/lib/kiosk/config-secret";

interface Payload {
  p: string; // property_id
  t: number; // issued-at (epoch seconds)
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Mint a signed kiosk config token: base64url(payload).hmac. No expiry (long-lived device token). */
export function signKioskToken(propertyId: string, secret: string): string {
  const payload: Payload = { p: propertyId, t: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Verify + decode. Returns { propertyId } or null if signature/format is invalid. */
export function verifyKioskToken(
  token: string,
  secret: string,
): { propertyId: string } | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!payload.p || typeof payload.p !== "string") return null;
    return { propertyId: payload.p };
  } catch {
    return null;
  }
}
