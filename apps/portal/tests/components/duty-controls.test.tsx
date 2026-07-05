/**
 * DutyControls (Phase 3 / Task 14, spec D5): the "Go on duty" control that, in
 * one deliberate click, primes the ring audio (via the onPrime prop → the
 * softphone's real ring element) and arms Web Push (permission prompt +
 * subscription, inside the user gesture).
 *
 * Push is mocked so these tests don't depend on jsdom having PushManager /
 * Notification. pushArmed()/armPush() are the only surface this component
 * touches; onPrime is a plain prop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.hoisted(() => ({
  pushArmed: vi.fn<() => boolean>(),
  armPush: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/lib/push/client", () => ({
  pushArmed: () => push.pushArmed(),
  armPush: () => push.armPush(),
}));

import { DutyControls } from "@/components/dashboard/duty-controls";

beforeEach(() => {
  push.pushArmed.mockReset();
  push.armPush.mockReset();
});
afterEach(() => cleanup());

describe("DutyControls", () => {
  it("renders the Go on duty button when not yet armed", () => {
    push.pushArmed.mockReturnValue(false);
    render(<DutyControls role="AGENT" onPrime={vi.fn()} />);
    expect(screen.getByRole("button", { name: /go on duty/i })).toBeTruthy();
    expect(screen.queryByText(/on duty · push armed/i)).toBeNull();
  });

  it("primes + arms on click, then shows the quiet armed state and hides the button", async () => {
    const user = userEvent.setup();
    const onPrime = vi.fn();
    // Un-armed at mount; armPush succeeds and pushArmed flips true afterwards.
    push.pushArmed.mockReturnValueOnce(false); // mount effect
    push.armPush.mockResolvedValue(true);
    push.pushArmed.mockReturnValue(true); // post-arm re-check

    render(<DutyControls role="AGENT" onPrime={onPrime} />);
    await user.click(screen.getByRole("button", { name: /go on duty/i }));

    expect(push.armPush).toHaveBeenCalledOnce();
    expect(onPrime).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText(/on duty · push armed/i)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /go on duty/i })).toBeNull();
  });

  it("shows the blocked line when arming fails, keeping the button (rings still work)", async () => {
    const user = userEvent.setup();
    const onPrime = vi.fn();
    push.pushArmed.mockReturnValue(false); // stays false throughout
    push.armPush.mockResolvedValue(false);

    render(<DutyControls role="AGENT" onPrime={onPrime} />);
    await user.click(screen.getByRole("button", { name: /go on duty/i }));

    expect(onPrime).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(
        screen.getByText(/notifications blocked — rings still work in this tab/i),
      ).toBeTruthy();
    });
    // The button stays so the agent can retry; still not armed.
    expect(screen.getByRole("button", { name: /go on duty/i })).toBeTruthy();
  });
});
