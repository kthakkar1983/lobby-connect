import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptionToggle } from "@/components/call/caption-toggle";

afterEach(() => cleanup());

describe("CaptionToggle", () => {
  it("shows the on state and calls onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CaptionToggle enabled onToggle={onToggle} />);
    const btn = screen.getByRole("button", { name: /captions/i });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows the off state", () => {
    render(<CaptionToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/captions off/i)).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });

  // ⚠ THE TWO ENABLED BRANCHES ARE NOT INTERCHANGEABLE, and the reason is a
  // WCAG one rather than a stylistic one: a label owes 4.5:1 (1.4.3), a lone
  // icon owes 3:1 (1.4.11). Unifying them breaks one surface or the other.
  //
  //   labelled -> light control-bar tray. accent-text on bg-accent/10 there is
  //               3.81:1 (FAIL); foreground is 11.86:1.
  //   compact  -> icon-only on the NAVY call tile (bg-primary #0F2D4B). The teal
  //               `text-accent` icon clears the 3:1 icon bar (~4.1:1 over the
  //               bg-accent/10 composite); foreground would be navy-on-navy,
  //               ~1.0:1, i.e. the captions control would vanish from the tile.
  //               The deep `text-accent-text` measured only ~2.68:1 here (FAIL).
  it("uses the tray-safe label colour when it renders text", () => {
    render(<CaptionToggle enabled onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-foreground");
    expect(btn.className).not.toContain("text-accent-text");
  });

  it("uses a navy-tile-safe teal icon colour when compact (clears 3:1, not the failing accent-text)", () => {
    render(<CaptionToggle enabled compact onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-accent");
    // NOT the deep text-accent-text, which measured ~2.68:1 on the navy tile.
    expect(btn.className).not.toContain("text-accent-text");
    expect(btn.className).not.toContain("text-foreground");
    // Compact is icon-only — no text means 1.4.3 does not apply to it.
    expect(btn.textContent).toBe("");
  });

  it("gives the compact icon-only toggle an explicit accessible name", () => {
    // Icon-only: the visible label is dropped, so `title` alone is an
    // unreliable accessible name (see CallToggleButton). aria-label carries it.
    render(<CaptionToggle enabled compact onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Captions" })).toBeTruthy();
  });

  it("keeps its name from the visible text when labelled (no aria-label)", () => {
    render(<CaptionToggle enabled={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect(btn.textContent).toBe("Captions off");
  });

  it("uses a navy-tile-safe muted icon colour for the compact off state", () => {
    render(<CaptionToggle enabled={false} compact onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    // On the navy tile the old text-text-muted #5C6B79 was ~2.56:1 (FAIL 3:1);
    // primary-foreground/70 clears it (~7.6:1) and matches the sibling toggle.
    expect(btn.className).toContain("text-primary-foreground/70");
    expect(btn.className).not.toContain("text-text-muted");
  });
});
