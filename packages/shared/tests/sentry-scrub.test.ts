import { describe, it, expect } from "vitest";
import { scrubPii, scrubEvent, PHONE_RE } from "../src/sentry-scrub";

describe("scrubPii", () => {
  it("drops sensitive keys (known + regex)", () => {
    expect(scrubPii({ caller_number: "x", authToken: "y", room: "204" })).toEqual({ room: "204" });
  });
  it("redacts phone-shaped runs but keeps short numbers", () => {
    expect(scrubPii("call +1 415 555 2671 now")).toBe("call [redacted] now");
    expect(scrubPii("room 204")).toBe("room 204");
  });
  it("recurses arrays + nested objects", () => {
    expect(scrubPii({ a: [{ secret: "s", ok: 1 }] })).toEqual({ a: [{ ok: 1 }] });
  });
  it("scrubEvent returns same shape, scrubbed", () => {
    expect(scrubEvent({ message: "+1 415 555 2671" })).toEqual({ message: "[redacted]" });
  });
  it("exports PHONE_RE", () => expect(PHONE_RE).toBeInstanceOf(RegExp));
});
