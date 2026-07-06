import "server-only";

/**
 * LiveKit server config. This module is the video-provider seam: today LiveKit
 * is the only provider, so there is nothing to select. A future second provider
 * would re-add its selection (a getVideoProvider()-style reader) and config
 * here — a one-module swap, the same pattern as lib/captions/provider.ts.
 */

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Reads LIVEKIT_* at call time (see .env.example). */
export function getLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url) throw new Error("Missing LIVEKIT_URL env var (see .env.example).");
  if (!apiKey) throw new Error("Missing LIVEKIT_API_KEY env var (see .env.example).");
  if (!apiSecret) throw new Error("Missing LIVEKIT_API_SECRET env var (see .env.example).");
  return { url, apiKey, apiSecret };
}
