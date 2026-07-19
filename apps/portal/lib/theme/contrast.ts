/**
 * WCAG 2.1 contrast math — the single source of truth for verifying that brand
 * tokens meet the 4.5:1 (normal text) / 3:1 (large text, non-text) bars.
 *
 * Pure, dependency-free, and framework-agnostic so it can back both unit tests
 * and the token regression guard (tests/theme/token-contrast.test.ts). Channels
 * are kept as 0–255 floats end to end so a composited (semi-transparent) fill
 * flows through unrounded.
 *
 * Formulae: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *           https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** Parse `#RGB` or `#RRGGBB` (with or without the leading `#`) into 0–255 channels. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Linearize one 0–255 sRGB channel. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 = black, 1 = white) per WCAG 2.1. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Alpha-composite `fg` at `alpha` (0–1) over an opaque `base` — the "source over"
 * operator. Models a Tailwind tint like `bg-live/15` (mint at 15% over the card).
 */
export function compositeOver(fg: Rgb, alpha: number, base: Rgb): Rgb {
  return {
    r: alpha * fg.r + (1 - alpha) * base.r,
    g: alpha * fg.g + (1 - alpha) * base.g,
    b: alpha * fg.b + (1 - alpha) * base.b,
  };
}

/** WCAG contrast ratio between two opaque colors — symmetric, in [1, 21]. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
