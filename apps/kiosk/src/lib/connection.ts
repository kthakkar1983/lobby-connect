/**
 * Maps a connection-state-change event (translated into this vocabulary by the
 * LiveKit adapter, see lib/video/livekit.ts) to what the kiosk UI should do.
 *
 * The kiosk has no recovery path of its own once the room drops — without
 * this, a mid-call network loss leaves the Connected screen frozen on the last
 * frame forever (the SDK retries silently, the app shows nothing). We surface a
 * "Reconnecting…" overlay while the SDK retries, and fall through to the apology
 * screen if it gives up. A `DISCONNECTED` we caused ourselves (reason `LEAVE`,
 * i.e. a normal hang-up) is ignored — the call machine already handled it.
 */
export type ConnectionOutcome = "lost" | "restored" | "terminal" | null;

export function interpretConnectionState(
  current: string,
  reason?: string,
): ConnectionOutcome {
  if (current === "RECONNECTING") return "lost";
  if (current === "CONNECTED") return "restored";
  if (current === "DISCONNECTED" && reason !== "LEAVE") return "terminal";
  return null;
}
