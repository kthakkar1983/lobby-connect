// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCaptionsEnabled } from "@/lib/captions/use-captions-enabled";

beforeEach(() => window.localStorage.clear());

describe("useCaptionsEnabled", () => {
  it("defaults to enabled when nothing is stored", () => {
    const { result } = renderHook(() => useCaptionsEnabled());
    expect(result.current.enabled).toBe(true);
  });

  it("toggle flips the value and persists it", () => {
    const { result } = renderHook(() => useCaptionsEnabled());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(window.localStorage.getItem("lc.captions.enabled")).toBe("false");
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(window.localStorage.getItem("lc.captions.enabled")).toBe("true");
  });

  it("reads a persisted 'off' preference on mount", () => {
    window.localStorage.setItem("lc.captions.enabled", "false");
    const { result } = renderHook(() => useCaptionsEnabled());
    expect(result.current.enabled).toBe(false);
  });
});
