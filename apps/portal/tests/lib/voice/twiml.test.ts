import { describe, it, expect } from "vitest";

import {
  buildIncomingTwiml,
  buildApologyTwiml,
  buildNotInServiceTwiml,
  buildHangupTwiml,
} from "@/lib/voice/twiml";

const opts = {
  greeting: "Connecting you to the front desk, one moment.",
  timeoutSeconds: 120,
  actionUrl: "https://x.test/api/twilio/voice/dial-result",
  apologyMessage: "Sorry, no one is available.",
};

describe("twiml builders", () => {
  it("builds incoming TwiML with one Client and the dial attributes", () => {
    const xml = buildIncomingTwiml([{ identity: "lc_a1" }], opts);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        "<Response>" +
        "<Say>Connecting you to the front desk, one moment.</Say>" +
        '<Dial timeout="120" action="https://x.test/api/twilio/voice/dial-result" method="POST">' +
        "<Client>lc_a1</Client>" +
        "</Dial>" +
        "</Response>",
    );
  });

  it("includes every target as a Client", () => {
    const xml = buildIncomingTwiml(
      [{ identity: "lc_a1" }, { identity: "lc_x1" }],
      opts,
    );
    expect(xml).toContain("<Client>lc_a1</Client><Client>lc_x1</Client>");
  });

  it("falls back to apology when there are no targets", () => {
    const xml = buildIncomingTwiml([], opts);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        "<Response><Say>Sorry, no one is available.</Say><Hangup/></Response>",
    );
  });

  it("apology and not-in-service return identical text in 5a", () => {
    expect(buildNotInServiceTwiml("m")).toBe(buildApologyTwiml("m"));
  });

  it("escapes XML-special characters in spoken text", () => {
    expect(buildApologyTwiml("Tom & Jerry")).toContain("Tom &amp; Jerry");
  });

  it("builds a bare hangup", () => {
    expect(buildHangupTwiml()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    );
  });
});
