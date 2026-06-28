import { describe, it, expect, vi } from "vitest";

import {
  attachTokenAutoRefresh,
  shouldReconnectDevice,
} from "@/lib/voice/device-resilience";

/** Minimal stand-in for the Twilio Voice Device's event + token surface. */
function makeFakeDevice() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    updateToken: vi.fn(),
    on(event: string, handler: (...args: unknown[]) => void): void {
      handlers.set(event, handler);
    },
    emit(event: string, ...args: unknown[]): void {
      handlers.get(event)?.(...args);
    },
  };
}

describe("attachTokenAutoRefresh", () => {
  it("refetches and applies a fresh token when the device token is about to expire", async () => {
    const device = makeFakeDevice();
    const fetchToken = vi.fn().mockResolvedValue("fresh-token");

    attachTokenAutoRefresh(device, { fetchToken });
    device.emit("tokenWillExpire");

    await vi.waitFor(() =>
      expect(device.updateToken).toHaveBeenCalledWith("fresh-token"),
    );
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("reports the failure and does not update the token when the refetch fails", async () => {
    const device = makeFakeDevice();
    const fetchToken = vi.fn().mockRejectedValue(new Error("network"));
    const onRefreshError = vi.fn();

    attachTokenAutoRefresh(device, { fetchToken, onRefreshError });
    device.emit("tokenWillExpire");

    await vi.waitFor(() => expect(onRefreshError).toHaveBeenCalledTimes(1));
    expect(device.updateToken).not.toHaveBeenCalled();
  });

  it("ignores unrelated device events", () => {
    const device = makeFakeDevice();
    const fetchToken = vi.fn().mockResolvedValue("fresh-token");

    attachTokenAutoRefresh(device, { fetchToken });
    device.emit("registered");

    expect(fetchToken).not.toHaveBeenCalled();
  });
});

describe("shouldReconnectDevice", () => {
  it("reconnects when a visible tab is sitting in the error state", () => {
    expect(shouldReconnectDevice("error", "visible")).toBe(true);
  });

  it("does not reconnect while the tab is still hidden", () => {
    // The overnight freeze case: only retry once the agent actually returns,
    // so we don't thrash the token endpoint on a backgrounded tab.
    expect(shouldReconnectDevice("error", "hidden")).toBe(false);
  });

  it("does not reconnect a line that is already up", () => {
    expect(shouldReconnectDevice("ready", "visible")).toBe(false);
    expect(shouldReconnectDevice("in-call", "visible")).toBe(false);
    expect(shouldReconnectDevice("connecting", "visible")).toBe(false);
  });
});
