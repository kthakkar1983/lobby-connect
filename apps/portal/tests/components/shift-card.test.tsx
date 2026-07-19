/**
 * ShiftCard (Task 8): the shift half of the dashboard's right column (spec §3.3).
 *
 * Presentational-only, so useDuty() is mocked here exactly as
 * duty-control.test.tsx mocks it -- the provider's own hydration and handler
 * behaviour is covered by duty-provider.test.tsx. (The "never mock duty-provider"
 * rule in the corrections file is specific to softphone.test.tsx, where the real
 * provider is what makes the accept-gate tests non-vacuous. Nothing of the sort
 * is at stake here.)
 *
 * Three of the behaviours below are inherited safety rules rather than new
 * features, and this file is now their only coverage -- duty-control.test.tsx is
 * deleted in Task 10:
 *   - End shift blocked mid-call, on BOTH branches (duty-control.tsx:83-84,146-147,175)
 *   - Break REMOVED from the tree mid-call, not disabled (duty-control.tsx:167-174)
 *   - the denied-Web-Push hint (duty-control.tsx:94-108, test :197-211)
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
// The card reads the live call from here to apply the mid-call rules. Mocked so
// this stays isolated from the real CallSurfaceProvider -- and note the default
// below returns null, which is also the "rendered outside any CallSurfaceProvider"
// case the optional hook exists for.
vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
}));

import { ShiftCard } from "@/components/dashboard/shift-card";

/** 4h 12m 05s before NOW. */
const SHIFT_START = "2026-07-19T21:48:00.000Z";
const NOW = new Date("2026-07-20T02:00:05.000Z");

type DutyStub = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  pushBlocked: boolean;
  endShift: ReturnType<typeof vi.fn>;
  takeBreak: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
};

/** On duty, no break, push armed, no live call -- overridden per test. */
function dutyStub(overrides: Partial<DutyStub> = {}): DutyStub {
  return {
    onDuty: true,
    onBreak: false,
    shiftStartedAt: SHIFT_START,
    pushBlocked: false,
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

/**
 * The shift start as local wall-clock HH:MM, computed WITHOUT Intl so it is
 * independent of the component's formatter. getHours/getMinutes are local-time
 * accessors, so this is deterministic on any machine's timezone -- which matters
 * because neither vitest config pins TZ.
 */
function localHhMm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

beforeEach(() => {
  useDuty.mockReset();
  useCallSurfaceOptional.mockReset();
  onCall(null);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  // cleanup() first, so unmount's clearInterval still runs against the fake
  // clock; only then hand the timers back.
  cleanup();
  vi.useRealTimers();
});

describe("ShiftCard — on duty", () => {
  it("shows the elapsed shift, when it started, and both actions", () => {
    useDuty.mockReturnValue(dutyStub());
    render(<ShiftCard />);

    expect(screen.getByText("4:12:05")).toBeTruthy();
    // 24-hour and zero-padded: the spec writes it HH:MM, and the clocks card
    // below uses 24-hour for the same AM/PM-ambiguity reason.
    expect(screen.getByText(`On duty since ${localHhMm(SHIFT_START)}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^break$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^end shift$/i })).toBeTruthy();
  });

  it("reads the start time off shiftStartedAt, not off now()", () => {
    // A card that formatted `now` would still print a plausible HH:MM and pass
    // the test above on a machine whose timezone happened to line up.
    const earlier = "2026-07-19T18:03:00.000Z";
    useDuty.mockReturnValue(dutyStub({ shiftStartedAt: earlier }));
    render(<ShiftCard />);

    expect(screen.getByText(`On duty since ${localHhMm(earlier)}`)).toBeTruthy();
    expect(screen.getByText("7:57:05")).toBeTruthy();
  });

  it("ticks the clock every second", () => {
    useDuty.mockReturnValue(dutyStub());
    render(<ShiftCard />);
    expect(screen.getByText("4:12:05")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("4:12:06")).toBeTruthy();

    // Past a minute boundary, so the padding is exercised rather than assumed.
    act(() => {
      vi.advanceTimersByTime(55_000);
    });
    expect(screen.getByText("4:13:01")).toBeTruthy();
  });

  it("floors a start time in the future at zero rather than counting backwards", () => {
    // Her PC's clock and ours are different machines, so a start time stamped
    // server-side can land slightly ahead of her Date.now(). Unclamped that
    // renders as "-1:59:-59", which reads as a broken app rather than skew.
    useDuty.mockReturnValue(dutyStub({ shiftStartedAt: "2026-07-20T02:00:35.000Z" }));
    render(<ShiftCard />);

    expect(screen.getByText("0:00:00")).toBeTruthy();
  });

  it("calls takeBreak from Break and endShift from End shift", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub();
    useDuty.mockReturnValue(stub);
    render(<ShiftCard />);

    await user.click(screen.getByRole("button", { name: /^break$/i }));
    expect(stub.takeBreak).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /^end shift$/i }));
    expect(stub.endShift).toHaveBeenCalledOnce();
  });
});

describe("ShiftCard — on break", () => {
  it("swaps Break for Resume and keeps End shift", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const stub = dutyStub({ onBreak: true });
    useDuty.mockReturnValue(stub);
    render(<ShiftCard />);

    expect(screen.queryByRole("button", { name: /^break$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^end shift$/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(stub.resume).toHaveBeenCalledOnce();
  });

  it("shows a break indicator instead of the since-line", () => {
    useDuty.mockReturnValue(dutyStub({ onBreak: true }));
    render(<ShiftCard />);

    expect(screen.getByText("On break")).toBeTruthy();
    expect(screen.queryByText(/on duty since/i)).toBeNull();
    // The shift is still open during a break, so the elapsed clock stays.
    expect(screen.getByText("4:12:05")).toBeTruthy();
  });
});

describe("ShiftCard — off duty", () => {
  it("says only that she is not on duty, with no actions at all", () => {
    useDuty.mockReturnValue(dutyStub({ onDuty: false, shiftStartedAt: null }));
    render(<ShiftCard />);

    expect(screen.getByText("Not on duty")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/on duty since/i)).toBeNull();
  });

  it("runs no interval while off duty", () => {
    // Deliberately keeps a stale shiftStartedAt: off duty must be sufficient on
    // its own to stop the clock. Pairing it with a null start time would let an
    // implementation gated ONLY on the start time pass this vacuously, and an
    // agent parked off duty all evening would re-render every second to update
    // nothing that renders.
    useDuty.mockReturnValue(dutyStub({ onDuty: false, shiftStartedAt: SHIFT_START }));
    const before = vi.getTimerCount();
    render(<ShiftCard />);

    expect(screen.getByText("Not on duty")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(before);
  });

  it("releases the interval on unmount", () => {
    useDuty.mockReturnValue(dutyStub());
    const before = vi.getTimerCount();
    const { unmount } = render(<ShiftCard />);
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe("ShiftCard — mid-call rules", () => {
  it("removes Break from the tree during a call rather than disabling it", () => {
    useDuty.mockReturnValue(dutyStub());
    onCall({ callId: "c1" });
    render(<ShiftCard />);

    // Removed, not disabled: taking a break mid-call would corrupt the timesheet,
    // and a heartbeat would clobber BREAK anyway.
    expect(screen.queryByRole("button", { name: /^break$/i })).toBeNull();
    expect(screen.getByText("4:12:05")).toBeTruthy();
  });

  it("disables End shift during a call and says why", () => {
    useDuty.mockReturnValue(dutyStub());
    onCall({ callId: "c1" });
    render(<ShiftCard />);

    // A real <Button>, so the NATIVE disabled attribute is the assertion --
    // the retired control was a Radix menu item carrying aria-disabled.
    const endShift = screen.getByRole("button", { name: /^end shift$/i });
    expect((endShift as HTMLButtonElement).disabled).toBe(true);
    expect(endShift.getAttribute("title")).toBe("Finish the call first");
  });

  it("surfaces the reason on hover even though the button swallows pointer events", () => {
    useDuty.mockReturnValue(dutyStub());
    onCall({ callId: "c1" });
    const { container } = render(<ShiftCard />);

    // The Button base carries `disabled:pointer-events-none`, so a title on a
    // disabled button never fires a tooltip. Without a hoverable ancestor the
    // reason is unreachable to everyone but a screen-reader user.
    const endShift = screen.getByRole("button", { name: /^end shift$/i });
    const hoverTarget = endShift.parentElement;
    expect(hoverTarget?.getAttribute("title")).toBe("Finish the call first");
    expect(container.contains(hoverTarget)).toBe(true);
  });

  it("disables End shift mid-call on a break too", () => {
    useDuty.mockReturnValue(dutyStub({ onBreak: true }));
    onCall({ callId: "c1" });
    render(<ShiftCard />);

    // Deliberate symmetry with the on-duty branch (duty-control.tsx:175):
    // ending from a break mid-call un-clocks the call tail just the same.
    const endShift = screen.getByRole("button", { name: /^end shift$/i });
    expect((endShift as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves both actions live off a call", () => {
    const stub = dutyStub();
    useDuty.mockReturnValue(stub);
    onCall(null);
    render(<ShiftCard />);

    expect(screen.getByRole("button", { name: /^break$/i })).toBeTruthy();
    const endShift = screen.getByRole("button", { name: /^end shift$/i });
    expect((endShift as HTMLButtonElement).disabled).toBe(false);
    expect(endShift.getAttribute("title")).toBeNull();
  });
});

describe("ShiftCard — blocked notifications", () => {
  // This card is the last place in the app that reads pushBlocked once Task 10
  // deletes duty-control.tsx. A silently denied Web Push means she believes she
  // is covered while OS-level alerting is off.
  it("warns while on duty", () => {
    useDuty.mockReturnValue(dutyStub({ pushBlocked: true }));
    render(<ShiftCard />);
    expect(screen.getByText(/notifications blocked/i)).toBeTruthy();
  });

  it("warns on a break", () => {
    useDuty.mockReturnValue(dutyStub({ pushBlocked: true, onBreak: true }));
    render(<ShiftCard />);
    expect(screen.getByText(/notifications blocked/i)).toBeTruthy();
  });

  it("warns off duty, where it matters most", () => {
    // Right before a shift starts is exactly when she can still fix it, and the
    // retired header control only ever showed this on a live shift.
    useDuty.mockReturnValue(
      dutyStub({ pushBlocked: true, onDuty: false, shiftStartedAt: null }),
    );
    render(<ShiftCard />);
    expect(screen.getByText(/notifications blocked/i)).toBeTruthy();
  });

  it("stays quiet when push is armed", () => {
    useDuty.mockReturnValue(dutyStub({ pushBlocked: false }));
    render(<ShiftCard />);
    expect(screen.queryByText(/notifications blocked/i)).toBeNull();
  });
});

describe("ShiftCard — on duty before the start time has hydrated", () => {
  it("keeps the actions rather than claiming she is off duty", () => {
    // DutyProvider mounts onDuty=true (fail-open) with shiftStartedAt=null until
    // GET /api/presence lands, so this state occurs on EVERY mount. Treating it
    // as off duty would flash a false "Not on duty" -- and if the start time
    // never arrives it would strand her with no way to end the shift, now that
    // the header has no duty control at all.
    useDuty.mockReturnValue(dutyStub({ shiftStartedAt: null }));
    render(<ShiftCard />);

    expect(screen.queryByText("Not on duty")).toBeNull();
    expect(screen.getByRole("button", { name: /^break$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^end shift$/i })).toBeTruthy();
    // Nothing is claimed about elapsed time we do not have.
    expect(screen.queryByText(/^\d+:\d{2}:\d{2}$/)).toBeNull();
  });
});
