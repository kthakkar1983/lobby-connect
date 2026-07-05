// VAPID credentials for Web Push. Read at call time (not module load) so
// vi.stubEnv works in tests and the build doesn't need the private key
// (same pattern as lib/twilio/config.ts).

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidConfig(): VapidConfig {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey) throw new Error("Missing env: NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  if (!privateKey) throw new Error("Missing env: VAPID_PRIVATE_KEY");
  if (!subject) throw new Error("Missing env: VAPID_SUBJECT");
  return { publicKey, privateKey, subject };
}
