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
  //   labelled -> flat on the light control bar's bg-card #FFFFFF (no tray since
  //               the 2026-07-20 reorder). foreground on bg-accent/10 over
  //               bg-card is 12.71:1; the darkened accent-text now clears AA here
  //               too (~5.40:1), so foreground is the shared-recipe choice.
  //   compact  -> icon-only on the NAVY call tile (bg-primary #0F2D4B). The teal
  //               `text-accent` icon clears the 3:1 icon bar (~4.1:1 over the
  //               bg-accent/10 composite); foreground would be navy-on-navy,
  //               ~1.0:1, i.e. the captions control would vanish from the tile.
  //               The deep `text-accent-text` measured only ~2.68:1 here (FAIL).
  it("uses the shared control-bar label colour when it renders text", () => {
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

  // Spec §3.2 / D4: on the call tile the compact toggle was px-2 py-2 with a
  // 16px icon while its neighbours (Mute/End call in call-tile.tsx) are
  // px-2 py-1 text-xs with 13px icons, so it stood visibly taller. Bring
  // compact onto that same scale; the labelled tray button is untouched.
  it("compact renders at the tile's compact scale (py-1 text-xs, not py-2 text-sm)", () => {
    render(<CaptionToggle enabled={false} compact onToggle={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Captions" });
    expect(btn.className).toContain("px-2 py-1 text-xs");
    expect(btn.className).not.toContain("py-2");
    // tailwind-merge must resolve the font-size conflict in compact's favour
    // — the base string always carries text-sm, so a leftover text-sm here
    // would mean the merge order is wrong, not just a missing class.
    expect(btn.className).not.toContain("text-sm");
  });

  it("keeps the labelled tray button at its original px-3 py-2 text-sm scale", () => {
    render(<CaptionToggle enabled={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("px-3 py-2");
    expect(btn.className).toContain("text-sm");
    expect(btn.className).not.toContain("text-xs");
  });

  it("shrinks the compact icon to 13px, matching the tile's other bar buttons", () => {
    render(<CaptionToggle enabled compact onToggle={vi.fn()} />);
    const icon = screen.getByRole("button").querySelector("svg");
    expect(icon?.getAttribute("width")).toBe("13");
    expect(icon?.getAttribute("height")).toBe("13");
  });

  // 16px -> 14px (Task 3, 2026-07-21): after the button-icon sizing pass
  // (Task 1) the labelled tray icons next to this one (Mute/Camera in
  // <CallToggleButton>) render at 14px, so this control's labelled icon was
  // now the odd one out, LARGER than its neighbours. Compact stays 13px —
  // untouched, and pinned separately below.
  it("shrinks the labelled icon to 14px, matching the neighbouring CallToggleButton icons", () => {
    render(<CaptionToggle enabled onToggle={vi.fn()} />);
    const icon = screen.getByRole("button").querySelector("svg");
    expect(icon?.getAttribute("width")).toBe("14");
    expect(icon?.getAttribute("height")).toBe("14");
  });

  // Batch 2 / Task 2 (a11y): the ring is per-branch, mirroring the colour split
  // above — labelled renders on the light control bar (`bg-card`), compact
  // renders on the navy call tile.
  it("carries the light-surface focus ring when labelled", () => {
    render(<CaptionToggle enabled={false} onToggle={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("focus-visible:ring-ring");
    expect(btn.className).toContain("focus-visible:ring-offset-background");
  });

  it("carries the navy-tile-safe focus ring when compact", () => {
    render(<CaptionToggle enabled={false} onToggle={() => {}} compact />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("focus-visible:ring-primary-foreground");
    expect(btn.className).toContain("focus-visible:ring-offset-primary");
  });
});
