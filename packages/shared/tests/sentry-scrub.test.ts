import { describe, it, expect } from "vitest";
import { scrubPii, scrubEvent } from "../src/sentry-scrub";

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
  it("redacts multiple phones in one string", () => {
    expect(scrubPii("from +1 415 555 2671 to +1 800 555 0199")).toBe("from [redacted] to [redacted]");
  });
});

describe("scrubPii — recording PII", () => {
  it("drops recording key-name variants (Twilio param casing + sid)", () => {
    expect(
      scrubPii({ RecordingUrl: "https://api.twilio.com/x", recording_sid: "RE1", room: "204" }),
    ).toEqual({ room: "204" });
  });
  it("redacts a Twilio recording URL embedded in free text", () => {
    expect(
      scrubPii(
        "playback failed: https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx.mp3 done",
      ),
    ).toBe("playback failed: [redacted] done");
  });
  it("keeps ordinary (non-recording) URLs — no over-redaction", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/logos/hotel.png";
    expect(scrubPii({ note: `logo at ${url}` })).toEqual({ note: `logo at ${url}` });
  });
});

describe("scrubPii — password runs (RustDesk deep link)", () => {
  it("redacts a password= run in a rustdesk:// deep link, keeping the rest intact", () => {
    expect(scrubPii("launching rustdesk://connection/new/123456?password=hunter2 now")).toBe(
      "launching rustdesk://connection/new/123456?password=[REDACTED] now",
    );
  });
  it("redacts a password= run in any URL/query string", () => {
    expect(scrubPii("https://x.example.com/login?user=a&password=s3cr3t&next=/home")).toBe(
      "https://x.example.com/login?user=a&password=[REDACTED]&next=/home",
    );
  });
});
