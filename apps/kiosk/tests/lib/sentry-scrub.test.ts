import { describe, it, expect } from "vitest";
import { scrubPii } from "@/lib/sentry";

describe("scrubPii (kiosk)", () => {
  it("drops the known sensitive keys", () => {
    const out = scrubPii({
      extra: { caller_number: "+14155551234", recording_url: "https://x/rec.mp3", room: "204" },
    }) as { extra: Record<string, unknown> };
    expect(out.extra).not.toHaveProperty("caller_number");
    expect(out.extra).not.toHaveProperty("recording_url");
    expect(out.extra.room).toBe("204");
  });

  it("drops keys matched by the sensitive-name regex (case-insensitive)", () => {
    const out = scrubPii({
      extra: { Authorization: "Bearer abc", password: "hunter2", room: "204" },
    }) as { extra: Record<string, unknown> };
    expect(out.extra).not.toHaveProperty("Authorization");
    expect(out.extra).not.toHaveProperty("password");
    expect(out.extra.room).toBe("204");
  });

  it("redacts phone-shaped substrings in free text", () => {
    expect(scrubPii("call from +1 (415) 555-1234 now")).toBe("call from [redacted] now");
  });
});
