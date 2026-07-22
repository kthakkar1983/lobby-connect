import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(auth)/sign-in/actions", () => ({
  signInAction: async () => ({ error: null }),
}));

import SignInPage from "@/app/(auth)/sign-in/page";

afterEach(() => cleanup());

describe("auth submit button", () => {
  it("carries a visible focus ring", () => {
    render(<SignInPage />);
    const submit = screen.getByRole("button", { name: /sign in/i });
    expect(submit.className).toContain("focus-visible:ring-2");
    expect(submit.className).toContain("focus-visible:ring-ring");
  });
});
