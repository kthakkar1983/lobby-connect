import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PropertiesTable, type PropertyListRow } from "@/app/(admin)/admin/properties/properties-table";

afterEach(() => cleanup());

const row: PropertyListRow = {
  id: "p1",
  name: "The Grand Hotel",
  timezone: "America/Chicago",
  routing_did: "+15551234567",
  active: true,
  owner_name: "Pat Owner",
};

/** The New-property button's leading icon. Both render sites (the toolbar button
 *  when properties exist, and the empty-state button when none do) must size it
 *  identically — and via `size-*`, not `h-4 w-4`.
 *
 *  WHY size-* AND NOT h-4 w-4: button.tsx's default/sm sizes carry
 *  `[&_svg:not([class*='size-'])]:size-3.5`, whose `:not([class*='size-'])`
 *  EXCLUDES an icon written `size-4` but MATCHES one written `h-4 w-4` (no
 *  "size-" substring) — and the compiled `:has`/`:not` selector outranks a plain
 *  `h-4 w-4` on specificity. So the toolbar icon, written `h-4 w-4`, was silently
 *  shrunk from 16px to 14px by Batch 1 while its empty-state twin (`size-4`)
 *  stayed 16px. This pins both back to the same explicit `size-4`. */
function newPropertyIcons(): string[] {
  // The toolbar button renders on every list; the empty-state button renders
  // additionally when the list is empty — so both New-property links can be
  // present at once. Assert every one of them.
  return screen.getAllByRole("link", { name: /new property/i }).map((link) => {
    const svg = link.querySelector("svg");
    expect(svg).not.toBeNull();
    return (svg as SVGElement).getAttribute("class") ?? "";
  });
}

describe("PropertiesTable — New property button icon", () => {
  it("sizes the toolbar New-property icon with size-4 (not the shrunk h-4 w-4)", () => {
    render(<PropertiesTable properties={[row]} />);
    for (const cls of newPropertyIcons()) {
      expect(cls).toContain("size-4");
      // The old pattern paired h-4 w-4 with a manual mr-2 margin that doubled
      // the button's own gap-2; the fix drops both.
      expect(cls).not.toContain("h-4");
      expect(cls).not.toContain("mr-2");
    }
  });

  it("sizes both New-property icons (toolbar + empty state) identically to size-4", () => {
    render(<PropertiesTable properties={[]} />);
    const icons = newPropertyIcons();
    expect(icons.length).toBeGreaterThanOrEqual(2);
    for (const cls of icons) {
      expect(cls).toContain("size-4");
      expect(cls).not.toContain("h-4");
    }
  });
});
