import { describe, it, expect, vi, afterEach } from "vitest";
import { timeoutFetch } from "@/lib/supabase/timeout-fetch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("timeoutFetch", () => {
  it("passes a fast response straight through", async () => {
    const ok = new Response("ok", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok)),
    );

    const wrapped = timeoutFetch(2500);
    const res = await wrapped("https://example.test");

    expect(res).toBe(ok);
  });

  it("forwards an AbortSignal to the underlying fetch", async () => {
    const spy =
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        () => Promise.resolve(new Response("ok")),
      );
    vi.stubGlobal("fetch", spy);

    const wrapped = timeoutFetch(2500);
    await wrapped("https://example.test");

    const init = spy.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects when the underlying request hangs past the timeout", async () => {
    // A fetch that never resolves on its own, but rejects when aborted.
    // AbortSignal.timeout uses real timers, so we use a tiny real timeout here.
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    const wrapped = timeoutFetch(10);
    await expect(wrapped("https://example.test")).rejects.toThrow();
  });
});
