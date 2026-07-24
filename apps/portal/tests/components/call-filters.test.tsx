import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CallFilters } from "@/components/call/call-filters";

afterEach(() => cleanup());

const properties = [
  { id: "p1", name: "The Grand Hotel" },
  { id: "p2", name: "The Sample Inn" },
];

describe("CallFilters", () => {
  // Copy fix (2026-07-23, uiux-polish-batch4-copy): the copy guide
  // (docs/brand/ui-copy-guide.md) settles on ONE noun for a property,
  // "Property" — "Hotel" was the odd one out. The filter column label must
  // say "Property"; property NAMES (e.g. "The Grand Hotel") are untouched
  // data, not this label, and stay whatever the operator named the property.
  it('labels the property filter column "Property", not "Hotel"', () => {
    render(
      <CallFilters
        basePath="/admin/calls"
        properties={properties}
        activeProperty={null}
        activeChannel={null}
        activeOutcome={null}
      />,
    );
    expect(screen.getByText("Property")).toBeTruthy();
    expect(screen.queryByText("Hotel")).toBeNull();
  });
});
