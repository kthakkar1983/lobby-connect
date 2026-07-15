// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Home } from "@/screens/Home";
import { copy } from "@/lib/copy";
import type { KioskConfig } from "@/types";

// Covers Task 11's Home half: the `lockedOut` prop App.tsx passes during the
// post-terminal-drop 10s tap lockout (set after a LiveKit terminal drop from a
// CONNECTED call — see App.tsx's onConnectionStateChange "terminal" branch).
// Locked out -> the tap-anywhere target must not fire onCall via mouse OR
// keyboard, and the calm reconnecting message must show. Not locked out (the
// default) -> Home must behave exactly as it did before this task (regression
// guard), since this prop is optional and every other kiosk test renders/mocks
// Home without ever passing it.

const config: KioskConfig = {
  propertyId: "p1",
  logoUrl: null,
  welcomeHeading: "Welcome",
  welcomeMessage: null,
  checkinTime: null,
  checkoutTime: null,
  wifiNetwork: null,
  wifiPassword: null,
  breakfastHours: null,
  apologyMessage: null,
  phoneNumber: null,
  ctaStyle: "warm",
};

afterEach(cleanup);

describe("Home — post-drop tap lockout (lockedOut prop)", () => {
  it("lockedOut: click and keyboard (Enter/Space) do NOT call onCall, and the reconnecting message shows", () => {
    const onCall = vi.fn();
    render(<Home config={config} onCall={onCall} lockedOut />);

    const tap = screen.getByRole("button", { name: /tap to connect with the front desk/i });
    expect(tap.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(tap);
    fireEvent.keyDown(tap, { key: "Enter" });
    fireEvent.keyDown(tap, { key: " " });
    expect(onCall).not.toHaveBeenCalled();

    expect(screen.getByText(copy.home.reconnecting)).toBeTruthy();
  });

  it("not locked out (default, unspecified prop): tap still calls onCall and no reconnecting message shows (regression)", () => {
    const onCall = vi.fn();
    render(<Home config={config} onCall={onCall} />);

    const tap = screen.getByRole("button", { name: /tap to connect with the front desk/i });
    expect(tap.getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(tap);
    expect(onCall).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(tap, { key: "Enter" });
    expect(onCall).toHaveBeenCalledTimes(2);

    expect(screen.queryByText(copy.home.reconnecting)).toBeNull();
  });

  it("explicit lockedOut={false} behaves the same as the default (tap fires, no message)", () => {
    const onCall = vi.fn();
    render(<Home config={config} onCall={onCall} lockedOut={false} />);

    fireEvent.click(screen.getByRole("button", { name: /tap to connect with the front desk/i }));
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.home.reconnecting)).toBeNull();
  });
});
