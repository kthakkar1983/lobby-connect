import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OwnerBottomNav } from "@/components/owner/owner-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/owner" }));

afterEach(() => cleanup());

describe("OwnerBottomNav", () => {
  it("gives the active tab a non-color region fill, and each tab a 44px target", () => {
    render(<OwnerBottomNav />);
    const home = screen.getByRole("link", { name: /home/i });
    const calls = screen.getByRole("link", { name: /calls/i });
    expect(home.className).toContain("bg-accent/10"); // Home is active at /owner
    expect(calls.className).not.toContain("bg-accent/10"); // inactive: no fill
    expect(home.className).toContain("min-h-[44px]");
  });

  it("the bar reserves the bottom safe-area inset", () => {
    render(<OwnerBottomNav />);
    expect(screen.getByRole("navigation").className).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
