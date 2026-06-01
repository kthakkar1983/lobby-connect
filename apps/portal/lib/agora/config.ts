import "server-only";

export interface AgoraCredentials {
  appId: string;
  appCertificate: string;
}

/** Reads AGORA_* at call-time (so vi.stubEnv works in tests). */
export function getAgoraCredentials(): AgoraCredentials {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId) throw new Error("Missing AGORA_APP_ID env var (see .env.example).");
  if (!appCertificate)
    throw new Error("Missing AGORA_APP_CERTIFICATE env var (see .env.example).");
  return { appId, appCertificate };
}
