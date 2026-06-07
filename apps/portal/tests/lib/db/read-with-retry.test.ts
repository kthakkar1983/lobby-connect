import { describe, it, expect, vi } from "vitest";

import { readWithRetry } from "@/lib/db/read-with-retry";

describe("readWithRetry", () => {
  it("returns the first successful read without retrying", async () => {
    const read = vi.fn().mockResolvedValue({ data: { x: 1 }, error: null });
    const res = await readWithRetry(read, { attempts: 3, delayMs: 0 });
    expect(res).toEqual({ data: { x: 1 }, error: null });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries past a transient error and returns the eventual success", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "blip" } })
      .mockResolvedValueOnce({ data: { x: 2 }, error: null });
    const res = await readWithRetry(read, { attempts: 3, delayMs: 0 });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ x: 2 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns the last error after exhausting attempts", async () => {
    const read = vi.fn().mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await readWithRetry(read, { attempts: 3, delayMs: 0 });
    expect(read).toHaveBeenCalledTimes(3);
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "down" });
  });
});
