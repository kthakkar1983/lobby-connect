/**
 * DutyControl (Task 15, shift-tracking plan): the constant-size header duty
 * control (spec §8.1) — off/on/break states, same footprint in every state so
 * the header never reflows as an agent's shift changes. Reads DutyProvider's
 * useDuty() (Task 14, mocked here — this test is presentational-only, the
 * provider's own hydration/handler behavior is covered by duty-provider.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { useDuty, useCallSurfaceOptional } = vi.hoisted(() => ({
  useDuty: vi.fn(),
  useCallSurfaceOptional: vi.fn(),
}));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDuty: () => useDuty(),
}));
// Call-awareness (finding #2): DutyControl reads the live call from here. Mocked
// so this presentational test stays isolated from the real CallSurfaceProvider.
vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
}));

import { DutyControl } from "@/components/dashboard/duty-control";

type DutyStub = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  pushBlocked: boolean;
  goOnDuty: ReturnType<typeof vi.fn>;
  endShift: ReturnType<typeof vi.fn>;
  takeBreak: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
};

function dutyStub(overrides: Partial<DutyStub> = {}): DutyStub {
  return {
    onDuty: false,
    onBreak: false,
    shiftStartedAt: null,
    pushBlocked: false,
    goOnDuty: vi.fn().mockResolvedValue(undefined),
    endShift: vi.fn().mockResolvedValue(undefined),
    takeBreak: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** No live call by default. Pass `{ callId }` to simulate an in-progress call. */
function onCall(active: { callId: string } | null) {
  useCallSurfaceOptional.mockReturnValue(active ? { active } : null);
}

/** Every render's outermost element — used to assert the fixed-footprint wrapper. */
function wrapperClassName(container: HTMLElement): string {
  return (container.firstElementChild as HTMLElement).className;
}

beforeEach(() => {
  useDuty.mockReset();
  useCallSurfaceOptional.mockReset();
  onCall(null); // default: no live call
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-12T03:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DutyControl", () => {
  it("off duty: renders 'Go on duty' and calls goOnDuty on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({ onDuty: false });
    useDuty.mockReturnValue(stub);
    render(<DutyControl />);

    const btn = screen.getByRole("button", { name: /^go on duty$/i });
    expect(btn).toBeTruthy();
    // Off duty: no elapsed pill (the live "On duty · …" pill), no break affordances.
    expect(screen.queryByText(/on duty ·/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /take a break/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();

    await user.click(btn);
    expect(stub.goOnDuty).toHaveBeenCalledOnce();
  });

  it("on duty: renders the elapsed timer + 'Take a break' and calls takeBreak on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({
      onDuty: true,
      onBreak: false,
      shiftStartedAt: "2026-07-12T01:00:00.000Z", // 2h before system time
    });
    useDuty.mockReturnValue(stub);
    render(<DutyControl />);

    expect(screen.getByText(/2h\s*00m/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^go on duty$/i })).toBeNull();

    const breakBtn = screen.getByRole("button", { name: /take a break/i });
    await user.click(breakBtn);
    expect(stub.takeBreak).toHaveBeenCalledOnce();
  });

  it("on duty: the elapsed timer ticks forward over time", () => {
    const stub = dutyStub({
      onDuty: true,
      shiftStartedAt: "2026-07-12T01:00:00.000Z", // 2h before system time
    });
    useDuty.mockReturnValue(stub);
    render(<DutyControl />);

    expect(screen.getByText(/2h\s*00m/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5 * 60_000); // +5 minutes
    });
    expect(screen.getByText(/2h\s*05m/i)).toBeTruthy();
  });

  it("on break: renders 'On break' + 'Resume' and calls resume on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({
      onDuty: true,
      onBreak: true,
      shiftStartedAt: "2026-07-12T01:00:00.000Z",
    });
    useDuty.mockReturnValue(stub);
    render(<DutyControl />);

    expect(screen.getByText(/on break/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /take a break/i })).toBeNull();

    const resumeBtn = screen.getByRole("button", { name: /^resume$/i });
    await user.click(resumeBtn);
    expect(stub.resume).toHaveBeenCalledOnce();
  });

  it("on duty and on break both expose an 'End shift' menu action that calls endShift", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({ onDuty: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" });
    useDuty.mockReturnValue(stub);
    render(<DutyControl />);

    await user.click(screen.getByRole("button", { name: /duty menu/i }));
    const endShiftItem = await screen.findByText(/^end shift$/i);
    await user.click(endShiftItem);
    expect(stub.endShift).toHaveBeenCalledOnce();
  });

  it("on a call: hides 'Take a break' but keeps the on-duty pill (finding #2a, spec §8.1)", () => {
    useDuty.mockReturnValue(
      dutyStub({ onDuty: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" }),
    );
    onCall({ callId: "c1" });
    render(<DutyControl />);

    // The live on-duty pill still shows; the break affordance is gone mid-call.
    expect(screen.getByText(/on duty ·/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /take a break/i })).toBeNull();
  });

  it("on a call: the End shift menu item is disabled (finding #2b)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({ onDuty: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" });
    useDuty.mockReturnValue(stub);
    onCall({ callId: "c1" });
    render(<DutyControl />);

    await user.click(screen.getByRole("button", { name: /duty menu/i }));
    // Radix marks a disabled item aria-disabled=true (and pointer-events:none),
    // so it can't be selected — ending a shift mid-call is blocked.
    const endShiftItem = await screen.findByRole("menuitem", { name: /end shift/i });
    expect(endShiftItem.getAttribute("aria-disabled")).toBe("true");
  });

  it("off a call: 'Take a break' shows and End shift is selectable (regression)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({ onDuty: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" });
    useDuty.mockReturnValue(stub);
    onCall(null);
    render(<DutyControl />);

    expect(screen.getByRole("button", { name: /take a break/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /duty menu/i }));
    const endShiftItem = await screen.findByRole("menuitem", { name: /end shift/i });
    expect(endShiftItem.getAttribute("aria-disabled")).not.toBe("true");
    await user.click(endShiftItem);
    expect(stub.endShift).toHaveBeenCalledOnce();
  });

  it("shows the 'notifications blocked' hint on a live shift when push is blocked (finding #4)", () => {
    useDuty.mockReturnValue(
      dutyStub({ onDuty: true, pushBlocked: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" }),
    );
    render(<DutyControl />);
    expect(screen.getByRole("img", { name: /notifications blocked/i })).toBeTruthy();
  });

  it("hides the blocked hint when push is armed", () => {
    useDuty.mockReturnValue(
      dutyStub({ onDuty: true, pushBlocked: false, shiftStartedAt: "2026-07-12T01:00:00.000Z" }),
    );
    render(<DutyControl />);
    expect(screen.queryByRole("img", { name: /notifications blocked/i })).toBeNull();
  });

  it("keeps a constant-width wrapper class across off/on/break states (fixed footprint)", () => {
    useDuty.mockReturnValue(dutyStub({ onDuty: false }));
    const { container: offContainer, unmount: unmountOff } = render(<DutyControl />);
    const offClass = wrapperClassName(offContainer);
    unmountOff();

    useDuty.mockReturnValue(
      dutyStub({ onDuty: true, onBreak: false, shiftStartedAt: "2026-07-12T01:00:00.000Z" }),
    );
    const { container: onContainer, unmount: unmountOn } = render(<DutyControl />);
    const onClass = wrapperClassName(onContainer);
    unmountOn();

    useDuty.mockReturnValue(
      dutyStub({ onDuty: true, onBreak: true, shiftStartedAt: "2026-07-12T01:00:00.000Z" }),
    );
    const { container: breakContainer } = render(<DutyControl />);
    const breakClass = wrapperClassName(breakContainer);

    expect(offClass).toContain("w-[20rem]");
    expect(onClass).toContain("w-[20rem]");
    expect(breakClass).toContain("w-[20rem]");
    expect(offClass).toBe(onClass);
    expect(onClass).toBe(breakClass);
  });
});
