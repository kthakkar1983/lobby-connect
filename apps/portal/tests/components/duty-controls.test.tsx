/**
 * DutyControls (Phase 3 / Tasks 14+15, spec D5+D6): the duty control that owns
 * the two shift boundaries.
 *
 * "Go on duty" — in one deliberate click, primes the ring audio (via the onPrime
 * prop → the softphone's real ring element), arms Web Push (permission prompt +
 * subscription, inside the user gesture), and resumes duty (onResumeDuty).
 *
 * "End shift" — shown only in the fully-active state (armed && onDuty); flips
 * presence to OFFLINE + disarms the heartbeat (onEndShift). A NEUTRAL control.
 *
 * Push is mocked so these tests don't depend on jsdom having PushManager /
 * Notification. pushArmed()/armPush() are the only push surface this component
 * touches; onPrime / onDuty / canEndShift / onEndShift / onResumeDuty are plain
 * props owned by the softphone (Task-14 props-driven architecture).
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

// Convenience: render with sensible defaults, overridable per test.
function renderDuty(
  props: Partial<React.ComponentProps<typeof DutyControls>> = {},
) {
  const merged: React.ComponentProps<typeof DutyControls> = {
    role: "AGENT",
    onPrime: vi.fn(),
    onDuty: true,
    canEndShift: true,
    onEndShift: vi.fn(),
    onResumeDuty: vi.fn(),
    ...props,
  };
  return { ...render(<DutyControls {...merged} />), props: merged };
}

beforeEach(() => {
  push.pushArmed.mockReset();
  push.armPush.mockReset();
});
afterEach(() => cleanup());

describe("DutyControls", () => {
  it("renders the Go on duty button when not yet armed", () => {
    push.pushArmed.mockReturnValue(false);
    renderDuty();
    expect(screen.getByRole("button", { name: /^go on duty$/i })).toBeTruthy();
    expect(screen.queryByText(/on duty · push armed/i)).toBeNull();
  });

  it("starts in the fully-active state when already armed at mount (e.g. after a reload)", async () => {
    // The mount effect runs setArmed(pushArmed()); a granted permission means the
    // agent is already on duty — the active state shows the "On duty" line + the
    // End shift button, with no Go-on-duty button.
    push.pushArmed.mockReturnValue(true);
    renderDuty({ onDuty: true });
    await waitFor(() => {
      expect(screen.getByText(/on duty · push armed/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /end shift/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /go on duty/i })).toBeNull();
  });

  it("primes + arms + resumes on click, then shows the active state and hides the button", async () => {
    const user = userEvent.setup();
    const onPrime = vi.fn();
    const onResumeDuty = vi.fn();
    // Un-armed at mount; armPush succeeds and pushArmed flips true afterwards.
    push.pushArmed.mockReturnValueOnce(false); // mount effect
    push.armPush.mockResolvedValue(true);
    push.pushArmed.mockReturnValue(true); // post-arm re-check

    renderDuty({ onPrime, onResumeDuty });
    await user.click(screen.getByRole("button", { name: /^go on duty$/i }));

    expect(push.armPush).toHaveBeenCalledOnce();
    expect(onPrime).toHaveBeenCalledOnce();
    expect(onResumeDuty).toHaveBeenCalledOnce();
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

    renderDuty({ onPrime });
    await user.click(screen.getByRole("button", { name: /^go on duty$/i }));

    expect(onPrime).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(
        screen.getByText(/notifications blocked — rings still work in this tab/i),
      ).toBeTruthy();
    });
    // The button stays so the agent can retry; still not armed.
    expect(screen.getByRole("button", { name: /^go on duty$/i })).toBeTruthy();
  });

  it("shows End shift in the active state and calls onEndShift on click", async () => {
    const user = userEvent.setup();
    const onEndShift = vi.fn();
    push.pushArmed.mockReturnValue(true); // armed + onDuty → active state
    renderDuty({ onDuty: true, onEndShift });

    const endBtn = await screen.findByRole("button", { name: /end shift/i });
    await user.click(endBtn);
    expect(onEndShift).toHaveBeenCalledOnce();
  });

  it("disables End shift when canEndShift is false, with an explanatory title", async () => {
    const onEndShift = vi.fn();
    push.pushArmed.mockReturnValue(true);
    renderDuty({ onDuty: true, canEndShift: false, onEndShift });

    const endBtn = await screen.findByRole("button", { name: /end shift/i });
    expect((endBtn as HTMLButtonElement).disabled).toBe(true);
    expect(endBtn.getAttribute("title")).toMatch(/finish the call first/i);
  });

  it("shows the resume label + Off duty line when off duty, and resumes on click", async () => {
    const user = userEvent.setup();
    const onPrime = vi.fn();
    const onResumeDuty = vi.fn();
    // Armed persists after End shift, but onDuty is false → the card must NOT
    // show "On duty"; instead the Go-on-duty-to-resume button + "Off duty" line.
    push.pushArmed.mockReturnValue(true);
    push.armPush.mockResolvedValue(true);

    renderDuty({ onDuty: false, onPrime, onResumeDuty });

    expect(screen.getByText(/^off duty$/i)).toBeTruthy();
    expect(screen.queryByText(/on duty · push armed/i)).toBeNull();
    const resumeBtn = screen.getByRole("button", { name: /go on duty to resume/i });

    await user.click(resumeBtn);
    expect(onPrime).toHaveBeenCalledOnce();
    expect(push.armPush).toHaveBeenCalledOnce();
    expect(onResumeDuty).toHaveBeenCalledOnce();
  });
});
