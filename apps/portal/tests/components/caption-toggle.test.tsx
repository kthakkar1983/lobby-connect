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
  // WCAG one rather than a stylistic one: text owes 4.5:1 (1.4.3), a lone icon
  // owes 3:1 (1.4.11). Unifying them breaks one surface or the other.
  //
  //   labelled -> light control-bar tray. accent-text on bg-accent/10 there is
  //               3.81:1 (FAIL); foreground is 11.86:1.
  //   compact  -> icon-only on the NAVY call tile. accent-text is 3.12:1 and
  //               clears the icon bar; foreground would be navy-on-navy, 1.0:1,
  //               i.e. the captions control would vanish from the tile.
  it("uses the tray-safe label colour when it renders text", () => {
    render(<CaptionToggle enabled onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-foreground");
    expect(btn.className).not.toContain("text-accent-text");
  });

  it("keeps the teal icon colour when compact, because that copy sits on the navy tile", () => {
    render(<CaptionToggle enabled compact onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-accent-text");
    expect(btn.className).not.toContain("text-foreground");
    // Compact is icon-only — no text means 1.4.3 does not apply to it.
    expect(btn.textContent).toBe("");
  });
});
