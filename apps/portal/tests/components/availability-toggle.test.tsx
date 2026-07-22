import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(admin)/admin/properties/actions", () => ({
  setCallAvailabilityAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AvailabilityToggle } from "@/app/(admin)/admin/availability-cards";

afterEach(() => cleanup());

describe("AvailabilityToggle", () => {
  it("shows a visible Covering label and an accessible switch", () => {
    render(<AvailabilityToggle propertyId="p1" propertyName="The Sample Hotel" initial={false} />);
    expect(screen.getByText("Covering")).toBeTruthy();
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-label") ?? "").toMatch(/covering/i);
  });
});
