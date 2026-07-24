import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusBadge } from "@/components/ui/status-badge";

afterEach(() => cleanup());

describe("StatusBadge", () => {
  it("renders the label with the live variant tokens + pill typography", () => {
    render(<StatusBadge variant="live">Completed</StatusBadge>);
    const el = screen.getByText("Completed");
    expect(el.className).toContain("bg-live/15");
    expect(el.className).toContain("text-live-foreground");
    expect(el.className).toContain("rounded-pill");
    expect(el.className).toContain("uppercase");
  });
  it("defaults to muted and can show a status dot", () => {
    render(<StatusBadge dot>Offline</StatusBadge>);
    const el = screen.getByText("Offline");
    expect(el.className).toContain("bg-muted");
    // the dot is an aria-hidden span inside
    expect(el.querySelector("span[aria-hidden='true']")).toBeTruthy();
  });
});
