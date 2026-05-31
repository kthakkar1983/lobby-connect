import "server-only";

import twilio from "twilio";

export interface VoiceTokenArgs {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  identity: string;
  ttlSeconds: number;
}

/**
 * Mint a Twilio access token granting the browser the right to RECEIVE calls
 * to `identity`. Incoming-only in v1 (no outgoing application SID).
 */
export function buildVoiceAccessToken(args: VoiceTokenArgs): string {
  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(
    args.accountSid,
    args.apiKeySid,
    args.apiKeySecret,
    { identity: args.identity, ttl: args.ttlSeconds },
  );
  token.addGrant(new VoiceGrant({ incomingAllow: true }));
  return token.toJwt();
}
