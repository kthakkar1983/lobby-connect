import "server-only";

import twilio from "twilio";

import { getTwilioConfig } from "@/lib/twilio/config";

/**
 * Verify an inbound Twilio webhook HMAC signature.
 * `url` MUST be the exact public URL Twilio requested (incl. query string);
 * `params` are the POST form fields. Returns false on a missing signature.
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const { authToken } = getTwilioConfig();
  return twilio.validateRequest(authToken, signature, url, params);
}

/**
 * Reconstruct the public URL Twilio used to reach us, from forwarded headers.
 * Behind a tunnel (cloudflared) the Host header is the public hostname and
 * x-forwarded-proto is https — which is what Twilio signed.
 */
export function publicUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}
