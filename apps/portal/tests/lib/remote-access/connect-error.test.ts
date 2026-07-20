import { describe, it, expect } from "vitest";
import { connectErrorMessage } from "@/lib/remote-access/connect-error";

/**
 * Spec §7's behavioural gap: a failed Connect used to be silent on all three
 * in-call surfaces. Four sites now render this message (card, audio overlay,
 * video overlay, tile), so the wording lives in ONE place — the whole point of
 * the task being "collapse five hand-rolled copies", not "make it five copies
 * of a message instead of five copies of a button".
 */
describe("connectErrorMessage", () => {
  it("returns nothing when the launch succeeded", () => {
    expect(connectErrorMessage({ launched: true })).toBeNull();
  });

  it("names the fixable cause when the property has no remote access configured", () => {
    // The agent cannot fix this herself mid-call; the message must say who can.
    expect(connectErrorMessage({ launched: false, notConfigured: true })).toBe(
      "No remote access configured — ask an admin.",
    );
  });

  it("invites a retry when the credential fetch failed", () => {
    expect(connectErrorMessage({ launched: false, notConfigured: false })).toBe(
      "Could not fetch credentials — try again.",
    );
  });

  it("treats an absent notConfigured flag as a transient failure, not a config gap", () => {
    // connectToProperty's type makes the flag OPTIONAL. Telling an agent to
    // "ask an admin" for what is really a dropped request sends her chasing
    // the wrong fix in the middle of a guest call. A THROWN connect maps here
    // too, for the same reason: an exception is not evidence of a missing
    // credential.
    expect(connectErrorMessage({ launched: false })).toBe(
      "Could not fetch credentials — try again.",
    );
  });

  // The call tile is a fixed 380x300 Document-PiP window whose control bar
  // already carries Mute, End call and the caption toggle. The full strings wrap
  // to several lines in what is left of it, over the guest's video face, so it
  // gets shorter ones — saying the same two things: whose problem it is, and
  // whether pressing again helps.
  describe("compact (the Document-PiP call tile)", () => {
    it("still says nothing on success", () => {
      expect(connectErrorMessage({ launched: true }, "compact")).toBeNull();
    });

    it("keeps 'ask an admin' — the actionable half survives the shortening", () => {
      const msg = connectErrorMessage({ launched: false, notConfigured: true }, "compact");
      expect(msg).toBe("No credentials — ask an admin.");
      expect(msg!.length).toBeLessThan(
        connectErrorMessage({ launched: false, notConfigured: true })!.length,
      );
    });

    it("keeps 'try again' — likewise", () => {
      const msg = connectErrorMessage({ launched: false }, "compact");
      expect(msg).toBe("Connect failed — try again.");
      expect(msg!.length).toBeLessThan(connectErrorMessage({ launched: false })!.length);
    });

    it("defaults to the full wording, so a caller has to ask to be terse", () => {
      expect(connectErrorMessage({ launched: false, notConfigured: true })).toBe(
        "No remote access configured — ask an admin.",
      );
    });
  });
});
