/**
 * Task 1 (duty-column polish plan): the one off-duty interception point
 * (spec §3.4, D8).
 *
 * WHAT THIS FILE PROVES: that the guard withholds the action while the control
 * stays live — a gated click reaches the guard, is refused, and opens the
 * prompt instead.
 *
 * WHAT IT DOES NOT PROVE: that any real control is left un-`disabled`.
 * `useDutyGuard` returns only `{ gated, guard }` and has no mechanism to add or
 * remove `disabled` on anything, so enabled-ness is not observable at this
 * layer — it lives entirely at the call sites. Those assertions belong in
 * property-card.test.tsx, pod-card-grid.test.tsx, connect-button.test.tsx and
 * kiosk-call-button.test.tsx (Tasks 4, 5 and 14), each asserting its own
 * rendered control has no `disabled` attribute while gated. Do not read any
 * test here as coverage of that property.
 *
 * The guard must also be a total no-op when either provider is absent:
 * tests/components/call-tile-manager.test.tsx drives eight Answer flows through
 * PropertyCard with NO DutyProvider and NO OffDutyPromptProvider mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useEffect, useState } from "react";

const { useDutyOptional } = vi.hoisted(() => ({ useDutyOptional: vi.fn() }));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => useDutyOptional(),
}));

import { OffDutyPromptProvider, useDutyGuard } from "@/components/dashboard/off-duty-prompt";

afterEach(cleanup);

/**
 * Only the fields this component reads; the real DutyState has 16 and is NOT
 * exported (it is a local alias at duty-provider.tsx:28), so this stub cannot be
 * typed against it and TypeScript will not catch drift. If off-duty-prompt.tsx
 * ever reads another field, add it here — an absent field arrives as `undefined`
 * and the tests stay green while the gating misbehaves.
 */
function dutyStub(
  canWork: boolean,
  goOnDuty = vi.fn().mockResolvedValue(undefined),
  onBreak = false,
  resume = vi.fn().mockResolvedValue(undefined),
) {
  return { canWork, goOnDuty, onBreak, resume };
}

function Probe({
  onRun,
  onGuard,
}: {
  readonly onRun: () => void;
  readonly onGuard?: (guard: (run: () => void) => void) => void;
}) {
  const { gated, guard } = useDutyGuard();
  const [tick, setTick] = useState(0);
  // Capture AFTER commit, not during render: a render-phase side effect would
  // double-push under React 19 StrictMode.
  useEffect(() => {
    onGuard?.(guard);
  });
  return (
    <>
      <button type="button" data-gated={gated} onClick={() => guard(onRun)}>
        act
      </button>
      <button type="button" onClick={() => setTick(tick + 1)}>
        bump
      </button>
    </>
  );
}

/** Mounted inside the prompt provider — the production arrangement. */
function setup(canWork: boolean, onBreak = false) {
  const goOnDuty = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockResolvedValue(undefined);
  useDutyOptional.mockReturnValue(dutyStub(canWork, goOnDuty, onBreak, resume));
  const onRun = vi.fn();
  const guards: ((run: () => void) => void)[] = [];
  render(
    <OffDutyPromptProvider>
      <Probe onRun={onRun} onGuard={(g) => guards.push(g)} />
    </OffDutyPromptProvider>,
  );
  return { onRun, goOnDuty, resume, guards };
}

beforeEach(() => {
  useDutyOptional.mockReset();
});

describe("useDutyGuard — on duty", () => {
  it("runs the action straight through and opens no prompt", () => {
    const { onRun } = setup(true);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reports gated=false so callers can style the control as available", () => {
    setup(true);
    expect(screen.getByText("act").getAttribute("data-gated")).toBe("false");
  });
});

describe("useDutyGuard — off duty", () => {
  it("blocks the action and opens the prompt", () => {
    const { onRun } = setup(false);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("does not require the control to be disabled (enabled-ness is asserted at each call site)", () => {
    setup(false);
    // NOT COVERAGE of "gated controls stay enabled". The Probe above never sets
    // `disabled`, and the hook cannot set it either, so this passes against any
    // implementation. It documents the contract only: the guard's job is to
    // refuse the action, never to disable the control. The binding assertions
    // live with the real controls — property-card.test.tsx, pod-card-grid.test.tsx,
    // connect-button.test.tsx, kiosk-call-button.test.tsx.
    expect(screen.getByText("act").hasAttribute("disabled")).toBe(false);
  });

  it("reports gated so callers can style the control", () => {
    setup(false);
    expect(screen.getByText("act").getAttribute("data-gated")).toBe("true");
  });

  it("starts the shift from the prompt without running the original action", () => {
    const { onRun, goOnDuty, resume } = setup(false);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Start my shift" }));
    expect(goOnDuty).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("dismisses without starting the shift or running the action", () => {
    const { onRun, goOnDuty } = setup(false);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(goOnDuty).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe("useDutyGuard — on a break", () => {
  // canWork = onDuty && !onBreak, so a break is gated too. It must NOT be
  // treated as off duty: goOnDuty() POSTs /api/presence/go-on-duty, whose
  // openShift() closes her live shift with a lapse-style ended_reason and
  // inserts a new one — one night recorded as two shifts, clocked hours
  // corrupted, and the resume route's atomic BREAK-only guard bypassed.

  it("still withholds the action", () => {
    const { onRun } = setup(false, true);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("says she is on a break, not off duty", () => {
    setup(false, true);
    fireEvent.click(screen.getByText("act"));
    expect(screen.getByText("You're on a break")).toBeTruthy();
    expect(screen.queryByText("You're off duty")).toBeNull();
  });

  it("offers Resume and never Start my shift", () => {
    setup(false, true);
    fireEvent.click(screen.getByText("act"));
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start my shift" })).toBeNull();
  });

  it("resumes the shift instead of opening a second one", () => {
    const { onRun, goOnDuty, resume } = setup(false, true);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(goOnDuty).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("dismisses without resuming or running the action", () => {
    const { onRun, goOnDuty, resume } = setup(false, true);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(resume).not.toHaveBeenCalled();
    expect(goOnDuty).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe("useDutyGuard — missing providers", () => {
  it("treats a missing DutyProvider as not gated", () => {
    useDutyOptional.mockReturnValue(null);
    const onRun = vi.fn();
    render(
      <OffDutyPromptProvider>
        <Probe onRun={onRun} />
      </OffDutyPromptProvider>,
    );
    fireEvent.click(screen.getByText("act"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("passes straight through with NO OffDutyPromptProvider at all", () => {
    // call-tile-manager.test.tsx mounts PropertyCard with neither provider and
    // drives eight Answer flows through it. If useDutyGuard ever REQUIRES its
    // provider, those eight tests break.
    useDutyOptional.mockReturnValue(null);
    const onRun = vi.fn();
    render(<Probe onRun={onRun} />);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("blocks without throwing when gated but no prompt provider is mounted", () => {
    // The optional chaining on prompt() is load-bearing, not defensive noise.
    useDutyOptional.mockReturnValue(dutyStub(false));
    const onRun = vi.fn();
    render(<Probe onRun={onRun} />);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("OffDutyPromptProvider — context identity", () => {
  it("keeps the context value stable across provider re-renders", () => {
    // A provider value recreated every render invalidates guard's useCallback
    // deps, handing every consumer a new function on each render.
    const { guards } = setup(false);
    const first = guards[0];

    // Re-render the PROVIDER (opening the prompt flips its own state)...
    fireEvent.click(screen.getByText("act"));
    // ...then re-render the CONSUMER so it re-reads the context.
    fireEvent.click(screen.getByText("bump"));

    expect(guards.length).toBeGreaterThan(1);
    expect(guards[guards.length - 1]).toBe(first);
  });
});
