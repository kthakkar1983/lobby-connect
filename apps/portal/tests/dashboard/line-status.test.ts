import { describe, it, expect } from "vitest";
import { lineStatusFromPhase } from "@/lib/dashboard/line-status";

describe("lineStatusFromPhase", () => {
  it("up when the line can take calls", () => {
    expect(lineStatusFromPhase("ready")).toBe("up");
    expect(lineStatusFromPhase("incoming")).toBe("up");
    expect(lineStatusFromPhase("in-call")).toBe("up");
  });
  it("down while connecting or errored", () => {
    expect(lineStatusFromPhase("connecting")).toBe("down");
    expect(lineStatusFromPhase("error")).toBe("down");
  });
});
