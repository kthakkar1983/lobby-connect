import { describe, it, expect } from "vitest";
import { isTwilioTransportNoise } from "@/lib/sentry/noise";

const consoleCrumb = (message: string) => ({
  category: "console",
  level: "error" as const,
  message,
});

const EMPTY_REJECTION = {
  type: "UnhandledRejection",
  value: "Non-Error promise rejection captured with value: undefined",
};

describe("isTwilioTransportNoise", () => {
  it("drops the empty unhandled rejection when the breadcrumbs show Twilio transport churn", () => {
    const event = {
      exception: { values: [EMPTY_REJECTION] },
      breadcrumbs: [
        consoleCrumb(
          "[TwilioVoice][WSTransport] Received websocket close event code: 1005. Reason: "
        ),
        consoleCrumb(
          "[TwilioVoice][Device] Received error:  TransportError: TransportError (31009): No transport available to send or receive"
        ),
      ],
    };
    expect(isTwilioTransportNoise(event)).toBe(true);
  });

  it("keeps an identical empty rejection when no Twilio breadcrumb is present (could be a real bug)", () => {
    const event = {
      exception: { values: [EMPTY_REJECTION] },
      breadcrumbs: [
        { category: "fetch", level: "info" as const, message: "GET /api/calls/incoming-video" },
      ],
    };
    expect(isTwilioTransportNoise(event)).toBe(false);
  });

  it("keeps a normal Error event even when Twilio breadcrumbs are around", () => {
    const event = {
      exception: { values: [{ type: "TypeError", value: "x is not a function" }] },
      breadcrumbs: [consoleCrumb("[TwilioVoice][Device] Received error:  TransportError (31009)")],
    };
    expect(isTwilioTransportNoise(event)).toBe(false);
  });

  it("returns false for events with no exception or no breadcrumbs", () => {
    expect(isTwilioTransportNoise({})).toBe(false);
    expect(isTwilioTransportNoise({ exception: { values: [] } })).toBe(false);
    expect(isTwilioTransportNoise({ exception: { values: [EMPTY_REJECTION] } })).toBe(false);
  });
});
