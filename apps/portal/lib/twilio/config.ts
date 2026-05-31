import "server-only";

/**
 * Env vars needed by Plan 5a webhook handlers only.
 * TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET are NOT included here —
 * they are only required by Plan 5b's /api/twilio/token route (Twilio
 * Client access tokens) and should be validated there.
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

/**
 * Reads + validates the Twilio env vars required by the 5a voice path.
 *
 * Why we read process.env here instead of using lib/env.ts:
 * lib/env.ts reads at module-load time, which makes vi.stubEnv() ineffective
 * in Vitest (the module has already captured the original value). Reading at
 * call time lets each test stub individual vars independently.
 */
export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  for (const [name, value] of [
    ["TWILIO_ACCOUNT_SID", accountSid],
    ["TWILIO_AUTH_TOKEN", authToken],
    ["TWILIO_PHONE_NUMBER", phoneNumber],
  ] as const) {
    if (!value) {
      throw new Error(
        `Missing ${name} environment variable. Set it in apps/portal/.env.local (see .env.example).`,
      );
    }
  }

  return { accountSid: accountSid!, authToken: authToken!, phoneNumber: phoneNumber! };
}

export interface TwilioApiCredentials {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
}

export function getTwilioApiCredentials(): TwilioApiCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid) {
    throw new Error("Missing TWILIO_ACCOUNT_SID env var");
  }
  if (!apiKeySid || !apiKeySecret) {
    throw new Error("Missing TWILIO_API_KEY_SID or TWILIO_API_KEY_SECRET env var");
  }

  return { accountSid, apiKeySid, apiKeySecret };
}
