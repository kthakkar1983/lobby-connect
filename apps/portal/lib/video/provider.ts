import "server-only";

export type VideoProvider = "agora" | "livekit";

/**
 * The active video provider (Phase 4 swap seam, spec D8). Read at call time so
 * vi.stubEnv works in tests. Unset/unknown -> "agora": merging the swap is
 * prod-inert until the env is deliberately flipped.
 */
export function getVideoProvider(): VideoProvider {
  return process.env.VIDEO_PROVIDER === "livekit" ? "livekit" : "agora";
}

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
