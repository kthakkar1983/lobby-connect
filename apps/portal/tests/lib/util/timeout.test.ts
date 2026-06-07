import { describe, it, expect, vi, afterEach } from "vitest";

import { withTimeout, TimeoutError } from "@/lib/util/timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("rejects with the original error when the promise rejects", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects with a TimeoutError when the promise hangs past ms", async () => {
    vi.useFakeTimers();
    const hung = new Promise<never>(() => {});
    const p = withTimeout(hung, 5000, "dial");
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });
});
