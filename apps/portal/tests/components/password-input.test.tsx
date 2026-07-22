import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PasswordInput } from "@/components/ui/password-input";

afterEach(() => cleanup());

describe("PasswordInput show/hide toggle", () => {
  it("carries a visible focus ring", () => {
    render(<PasswordInput name="password" />);
    const toggle = screen.getByRole("button", { name: /show password/i });
    expect(toggle.className).toContain("focus-visible:ring-2");
    expect(toggle.className).toContain("focus-visible:ring-ring");
  });
});
