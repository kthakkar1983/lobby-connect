import { useEffect } from "react";

/**
 * Pin the kiosk app to the VISUAL viewport (not the layout viewport) by writing
 * its height + top offset to CSS custom properties on <html>. `index.css`
 * consumes them on `#root`.
 *
 * Why: iOS Safari does NOT shrink the layout viewport when the on-screen
 * keyboard opens — it shrinks only the visual viewport and scrolls the whole
 * page up to keep the focused input visible. With the app sized to the layout
 * viewport (`height: 100%`), that scrolls the live video + chat off the top of
 * the screen (the smoke bug). Driving `#root` from `visualViewport.height`
 * instead makes the call area SHRINK to the space above the keyboard, so the
 * top stays fixed and nothing scrolls. `offsetTop` keeps it aligned if the
 * browser still offsets the visual viewport.
 *
 * No-ops where the VisualViewport API is unavailable (SSR / very old engines) —
 * `#root` then falls back to the `100%` default in the CSS `var()`.
 */
export function useVisualViewportSize(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--kiosk-vv-height", `${vv.height}px`);
      root.style.setProperty("--kiosk-vv-top", `${vv.offsetTop}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--kiosk-vv-height");
      root.style.removeProperty("--kiosk-vv-top");
    };
  }, []);
}
