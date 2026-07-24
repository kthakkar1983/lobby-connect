/**
 * The one wording for a failed Connect (spec §7).
 *
 * Deliberately a separate module from `connect.ts`, which must not be touched:
 * `launchRustdesk` there launches `rustdesk://` through a transient hidden
 * IFRAME because a top-window navigation fires `pagehide`, and livekit-client
 * tears the room down on `pagehide` — pressing Connect mid-call used to END THE
 * CALL. `tests/lib/remote-access/launch-rustdesk.test.ts` pins that mechanism.
 *
 * Four sites render this message: the property-card Connect and the three
 * in-call ones (audio overlay, video overlay, call tile). Until now only the
 * card surfaced anything at all — the three in-call copies called
 * `connectToProperty` as a bare `void` with no catch, so a failed remote-access
 * launch was SILENT in the middle of a guest call. The agent pressed Connect,
 * nothing happened, and there was no way to tell "RustDesk is opening" from
 * "this property has no credentials". Closing that gap in three places is
 * exactly how wording drifts, so it is resolved here instead.
 *
 * The two cases are split because they need different actions from her: one is
 * an admin's job and retrying will never help, the other is a dropped request
 * that a second press probably fixes.
 */

/**
 * The shape `CallSurfaceProvider.connectToProperty` resolves to.
 *
 * The provider IMPORTS this rather than re-declaring its return type inline.
 * It was hand-copied in both places at first, linked only by an incidental
 * assignment that happened to typecheck — so a shape change could have
 * desynced the mapping below from the thing it maps, silently.
 */
export type ConnectOutcome = {
  readonly launched: boolean;
  readonly notConfigured?: boolean;
};

/**
 * How much room the message has.
 *
 * `compact` is the Document-PiP call tile, a fixed 380x300 window
 * (lib/duty-tile/call-tile-manager.ts) whose control bar already carries Mute,
 * End call, the Video/Chat toggle and the caption toggle. The full strings below
 * wrap to several lines in what is left, so the tile gets shorter ones that say
 * the same two things: whose problem it is, and whether pressing again helps.
 */
export type ConnectErrorLength = "full" | "compact";

export function connectErrorMessage(
  outcome: ConnectOutcome,
  length: ConnectErrorLength = "full",
): string | null {
  if (outcome.launched) return null;
  // `notConfigured` is optional, so absent means "we don't know it's a config
  // gap" — treat it as transient. Sending her to an admin for what was really a
  // dropped fetch costs a guest-facing minute chasing the wrong fix. A THROWN
  // connect lands here too (the call sites map it to `{ launched: false }`),
  // which is right: an exception is not evidence of a missing credential.
  if (outcome.notConfigured) {
    return length === "compact"
      ? "No credentials. Ask an admin."
      : "No remote access configured. Ask an admin.";
  }
  return length === "compact"
    ? "Connect failed. Try again."
    : "Could not fetch credentials. Try again.";
}
