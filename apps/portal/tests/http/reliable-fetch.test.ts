import { describe, it, expect, vi, beforeEach } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reliableFetch } from "@/lib/http/reliable-fetch";

const noBackoff = () => 0;

describe("reliableFetch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the response on a first-try success and does not report", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does NOT retry a 4xx and returns it without reporting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", retries: 2, backoffMs: noBackoff });

    expect(res?.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("exhausts retries on a thrown error, returns null, reports once", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "calls.notes", retries: 2, backoffMs: noBackoff });

    expect(res).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(captureException).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reports once when a 5xx persists through all retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", retries: 1, backoffMs: noBackoff });

    expect(res?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns a response with no numeric status as-is (only 5xx is retryable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true }); // no .status field
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
