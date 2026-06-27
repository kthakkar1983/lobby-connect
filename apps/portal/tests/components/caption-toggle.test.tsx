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
});
