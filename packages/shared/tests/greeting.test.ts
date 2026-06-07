import { describe, it, expect } from "vitest";
import { greetingForHour } from "../src/greeting";

describe("greetingForHour", () => {
  it("morning for 0..10", () => {
    for (const h of [0, 5, 10]) expect(greetingForHour(h)).toBe("Good morning");
  });
  it("afternoon for 11..16", () => {
    for (const h of [11, 13, 16]) expect(greetingForHour(h)).toBe("Good afternoon");
  });
  it("evening for 17..23", () => {
    for (const h of [17, 20, 23]) expect(greetingForHour(h)).toBe("Good evening");
  });
});
