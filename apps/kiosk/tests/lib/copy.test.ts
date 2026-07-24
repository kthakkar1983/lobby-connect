import { describe, it, expect } from "vitest";
import { copy } from "@/lib/copy";

// Batch 4 copy polish: (1) recording was removed from v1 — the Ringing
// screen's "may be recorded" note is now false and must be gone entirely,
// not just hidden; (2) the brand bans em dashes in guest-facing copy.
describe("kiosk copy (Batch 4)", () => {
  it("dropped the stale recording note", () => {
    expect("recordingNote" in copy.ringing).toBe(false);
  });

  it("no em dashes in reconnect copy", () => {
    expect(copy.home.reconnecting).not.toContain("—");
    expect(copy.reconnecting.subtitle).not.toContain("—");
  });
});
