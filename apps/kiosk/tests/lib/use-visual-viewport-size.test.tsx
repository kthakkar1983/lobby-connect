// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisualViewportSize } from "../../src/lib/use-visual-viewport-size";

/** A fake VisualViewport whose height/offsetTop can change + emit events. */
function fakeVisualViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    }),
    emit(type: string) {
      (listeners[type] ?? []).forEach((f) => f());
    },
    set(h: number, o = 0) {
      this.height = h;
      this.offsetTop = o;
    },
  };
}

function vvHeightVar() {
  return document.documentElement.style.getPropertyValue("--kiosk-vv-height");
}
function vvTopVar() {
  return document.documentElement.style.getPropertyValue("--kiosk-vv-top");
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
  delete (window as { visualViewport?: unknown }).visualViewport;
});

describe("useVisualViewportSize", () => {
  it("writes the visual-viewport height/top to CSS vars on mount", () => {
    (window as { visualViewport?: unknown }).visualViewport = fakeVisualViewport(600, 0);
    renderHook(() => useVisualViewportSize());
    expect(vvHeightVar()).toBe("600px");
    expect(vvTopVar()).toBe("0px");
  });

  it("shrinks the height (and tracks the top offset) when the keyboard opens", () => {
    const vv = fakeVisualViewport(600, 0);
    (window as { visualViewport?: unknown }).visualViewport = vv;
    renderHook(() => useVisualViewportSize());

    // Keyboard opens: the visual viewport shrinks and may be pushed down.
    vv.set(360, 12);
    vv.emit("resize");

    expect(vvHeightVar()).toBe("360px");
    expect(vvTopVar()).toBe("12px");
  });

  it("detaches listeners and clears the vars on unmount", () => {
    const vv = fakeVisualViewport(600);
    (window as { visualViewport?: unknown }).visualViewport = vv;
    const { unmount } = renderHook(() => useVisualViewportSize());
    unmount();
    expect(vv.removeEventListener).toHaveBeenCalledTimes(2); // resize + scroll
    expect(vvHeightVar()).toBe("");
    expect(vvTopVar()).toBe("");
  });

  it("no-ops (no throw, no vars) when the VisualViewport API is unavailable", () => {
    delete (window as { visualViewport?: unknown }).visualViewport;
    expect(() => renderHook(() => useVisualViewportSize())).not.toThrow();
    expect(vvHeightVar()).toBe("");
  });
});
