import { describe, it, expect } from "vitest";
import { scrubEvent, scrubPii } from "@/lib/sentry/scrub";

describe("scrubPii", () => {
  it("drops sensitive keys anywhere in the tree", () => {
    const out = scrubPii({
      extra: { caller_number: "+14155551234", recording_url: "https://x/rec.mp3", room: "204" },
    }) as { extra: Record<string, unknown> };
    expect(out.extra).not.toHaveProperty("caller_number");
    expect(out.extra).not.toHaveProperty("recording_url");
    expect(out.extra.room).toBe("204");
  });

  it("redacts phone-shaped substrings in free text", () => {
    expect(scrubPii("call from +1 (415) 555-1234 now")).toBe("call from [redacted] now");
  });

  it("preserves real UUIDs and short numbers", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(scrubPii(`ref ${uuid} room 204`)).toBe(`ref ${uuid} room 204`);
  });

  it("recurses into arrays", () => {
    expect(scrubPii(["+14155551234", "ok"])).toEqual(["[redacted]", "ok"]);
  });
});

describe("scrubEvent", () => {
  it("returns the event with breadcrumb text redacted", () => {
    const ev = scrubEvent({
      message: "boom",
      breadcrumbs: [{ message: "dialing +14155551234" }],
    });
    expect((ev.breadcrumbs?.[0] as { message: string }).message).toBe("dialing [redacted]");
  });
});
