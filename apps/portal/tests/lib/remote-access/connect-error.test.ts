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
    // the wrong fix in the middle of a guest call.
    expect(connectErrorMessage({ launched: false })).toBe(
      "Could not fetch credentials — try again.",
    );
  });
});
