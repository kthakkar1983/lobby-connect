import { describe, it, expect } from "vitest";
import {
  SIGNAL_SPECS,
  classifyHeartbeat,
  classifyProbe,
  classifyErrorCount,
  type SignalSpec,
} from "@/lib/status/signals";

const NOW = Date.parse("2026-06-03T12:00:00Z");
const cron = SIGNAL_SPECS.find((s) => s.signal === "cron_mark_stale_offline") as SignalSpec;
const twilio = SIGNAL_SPECS.find((s) => s.signal === "twilio_webhook") as SignalSpec;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("classifyHeartbeat", () => {
  it("unknown when never seen", () => {
    expect(classifyHeartbeat(null, NOW, cron)).toBe("unknown");
  });
  it("liveness: ok / warn / down by age", () => {
    expect(classifyHeartbeat(ago(10_000), NOW, cron)).toBe("ok");
    expect(classifyHeartbeat(ago(120_000), NOW, cron)).toBe("warn");
    expect(classifyHeartbeat(ago(600_000), NOW, cron)).toBe("down");
  });
  it("info: always ok once seen, regardless of age", () => {
    expect(classifyHeartbeat(ago(86_400_000), NOW, twilio)).toBe("ok");
  });
});

describe("classifyProbe", () => {
  it("maps boolean to ok/down", () => {
    expect(classifyProbe(true)).toBe("ok");
    expect(classifyProbe(false)).toBe("down");
  });
});

describe("classifyErrorCount", () => {
  it("null -> unknown, 0 -> ok, few -> warn, many -> down", () => {
    expect(classifyErrorCount(null)).toBe("unknown");
    expect(classifyErrorCount(0)).toBe("ok");
    expect(classifyErrorCount(3)).toBe("warn");
    expect(classifyErrorCount(50)).toBe("down");
  });
});
