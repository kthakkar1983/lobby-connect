import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, hexToRgb } from "@/lib/theme/contrast";

/**
 * Regression guard for WCAG 1.4.3 (normal text 4.5:1) on the brand's colored
 * chip/pill recipes. Each recipe puts a deep text token ON a light tint of the
 * same hue (bg-live/15, bg-accent/10-15, bg-attention/15). Those deep tokens
 * were originally tuned to exactly ~4.5:1 on pure white, so they dipped below
 * the bar the moment they sat on their own tint (mint ~4.03, teal ~3.81, blaze
 * ~3.58 on the page background).
 *
 * We read the real shipped token values out of globals.css so a future edit that
 * lightens any of them (reintroducing the fail) breaks this test. The recipe set
 * below mirrors every place the pattern is used in components:
 *   - live:       Badge live variant, status-pill.ts, properties/users tables, softphone
 *   - accent /15: Badge accent variant
 *   - accent /10: call-filters, owner-nav, caption-toggle (active pill/tab)
 *   - attention:  Badge attention variant, status-pill.ts
 */

const CSS = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

function token(name: string): string {
  const m = CSS.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{3,6})`));
  if (!m?.[1]) throw new Error(`Token ${name} not found in globals.css`);
  return m[1];
}

const AA_NORMAL = 4.5;

// A chip can sit on a white card or directly on the page background; the page
// background is the darker composite, so it is the binding worst case.
const SURFACES = ["--color-card", "--color-background"] as const;

type Recipe = { name: string; fill: string; alpha: number; text: string };
const RECIPES: readonly Recipe[] = [
  { name: "mint 'live' chip (bg-live/15)", fill: "--color-live", alpha: 0.15, text: "--color-live-foreground" },
  { name: "teal 'accent' badge (bg-accent/15)", fill: "--color-accent", alpha: 0.15, text: "--color-accent-text" },
  { name: "teal 'accent' active pill (bg-accent/10)", fill: "--color-accent", alpha: 0.1, text: "--color-accent-text" },
  { name: "blaze 'attention' chip (bg-attention/15)", fill: "--color-attention", alpha: 0.15, text: "--color-attention-text" },
];

describe("brand chip/pill token contrast (WCAG 1.4.3, 4.5:1 normal text)", () => {
  for (const recipe of RECIPES) {
    for (const surface of SURFACES) {
      it(`${recipe.name} clears 4.5:1 on ${surface}`, () => {
        const bg = compositeOver(hexToRgb(token(recipe.fill)), recipe.alpha, hexToRgb(token(surface)));
        const ratio = contrastRatio(hexToRgb(token(recipe.text)), bg);
        expect(ratio, `${recipe.name} on ${surface} = ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  // The deep text tokens are also used as plain links/text on white — that use
  // must keep clearing 4.5:1 too (darkening for the chips only helps here).
  for (const t of ["--color-live-foreground", "--color-accent-text", "--color-attention-text"]) {
    it(`${t} clears 4.5:1 as text on a white card`, () => {
      const ratio = contrastRatio(hexToRgb(token(t)), hexToRgb(token("--color-card")));
      expect(ratio, `${t} on white = ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }
});
