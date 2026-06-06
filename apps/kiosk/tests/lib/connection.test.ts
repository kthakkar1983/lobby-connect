import { describe, it, expect } from "vitest";
import { interpretConnectionState } from "@/lib/connection";

describe("interpretConnectionState", () => {
  it("RECONNECTING → lost (show the reconnecting overlay)", () => {
    expect(interpretConnectionState("RECONNECTING")).toBe("lost");
  });

  it("CONNECTED → restored (hide the overlay)", () => {
    expect(interpretConnectionState("CONNECTED")).toBe("restored");
  });

  it("DISCONNECTED after we left the channel → null (intentional teardown)", () => {
    expect(interpretConnectionState("DISCONNECTED", "LEAVE")).toBeNull();
  });

  it("DISCONNECTED from a network error → terminal (route to apology)", () => {
    expect(interpretConnectionState("DISCONNECTED", "NETWORK_ERROR")).toBe("terminal");
  });

  it("DISCONNECTED with no reason → terminal", () => {
    expect(interpretConnectionState("DISCONNECTED")).toBe("terminal");
  });

  it("transient states (CONNECTING, DISCONNECTING) → null", () => {
    expect(interpretConnectionState("CONNECTING")).toBeNull();
    expect(interpretConnectionState("DISCONNECTING")).toBeNull();
  });
});
