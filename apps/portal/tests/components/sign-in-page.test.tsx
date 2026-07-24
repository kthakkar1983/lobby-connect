import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(auth)/sign-in/actions", () => ({
  signInAction: async () => ({ error: null }),
}));

import SignInPage from "@/app/(auth)/sign-in/page";

afterEach(() => cleanup());

describe("sign-in page", () => {
  it("points the user at their administrator for a password reset", () => {
    render(<SignInPage />);
    expect(
      screen.getByText("Forgot your password? Contact your administrator.")
    ).toBeTruthy();
  });
});
