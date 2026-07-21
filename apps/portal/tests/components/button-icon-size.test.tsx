import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "@/components/ui/button";

afterEach(() => cleanup());

describe("Button icon size matches its text label", () => {
  it.each(["sm", "default"] as const)("size=%s renders a 14px (size-3.5) icon, not the 18px base", (size) => {
    render(<Button size={size}><svg data-testid="i" />Label</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("[&_svg:not([class*='size-'])]:size-3.5");
    // twMerge (applied by cn() in Button) must keep only the variant size, dropping the base.
    expect(cls).not.toContain("[&_svg:not([class*='size-'])]:size-4");
  });
});
