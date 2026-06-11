import "server-only";

import twilio from "twilio";
import { NextResponse } from "next/server";

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

/** A Twilio REST client built from the 5a voice-path credentials. */
export function getTwilioRestClient(): ReturnType<typeof twilio> {
  const { accountSid, authToken } = getTwilioConfig();
  return twilio(accountSid, authToken);
}

/**
 * Read + HMAC-verify an inbound Twilio webhook. Returns the parsed form params,
 * or a 403 NextResponse the route returns directly. Consumes the request body.
 */
export async function parseVerifiedTwilioWebhook(
  request: Request,
): Promise<{ params: Record<string, string> } | NextResponse> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  const signature = request.headers.get("x-twilio-signature");
  const url = publicUrlFromRequest(request);
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }
  return { params };
}
