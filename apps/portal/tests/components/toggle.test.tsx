import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "@/components/ui/toggle";

afterEach(() => cleanup());

describe("Toggle", () => {
  it("bar+accent: engaged uses the accent fill + foreground text", () => {
    render(<Toggle pressed tone="accent" surface="bar" aria-label="Mute" />);
    const b = screen.getByRole("button", { name: "Mute" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.className).toContain("data-[state=on]:border-accent");
    expect(b.className).toContain("data-[state=on]:text-foreground");
  });
  it("tile+accent: engaged text is the bright accent token (navy-safe), not foreground", () => {
    render(<Toggle pressed tone="accent" surface="tile" aria-label="Captions" />);
    const b = screen.getByRole("button", { name: "Captions" });
    expect(b.className).toContain("data-[state=on]:text-accent");
    expect(b.className).not.toContain("data-[state=on]:text-foreground");
  });
  it("bar+live: engaged uses the mint fill (Accepting recipe)", () => {
    render(<Toggle pressed tone="live" surface="bar" aria-label="Accepting" />);
    expect(screen.getByRole("button", { name: "Accepting" }).className).toContain("data-[state=on]:bg-live/15");
  });
  it("fires onPressedChange", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<Toggle pressed={false} onPressedChange={onPressedChange} aria-label="Mute" />);
    await user.click(screen.getByRole("button"));
    expect(onPressedChange).toHaveBeenCalledOnce();
  });
});
