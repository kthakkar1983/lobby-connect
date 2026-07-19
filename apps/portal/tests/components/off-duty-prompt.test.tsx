/**
 * Task 1 (duty-column polish plan): the one off-duty interception point
 * (spec §3.4, D8).
 *
 * The load-bearing property under test is that gated controls stay ENABLED.
 * A `disabled` button fires no click event, so it cannot be intercepted — the
 * whole design rests on the control staying live and the guard refusing to run
 * the action. These tests are what prove a click cannot get through, because
 * `disabled` is no longer doing that job.
 *
 * The guard must also be a total no-op when either provider is absent:
 * tests/components/call-tile-manager.test.tsx drives eight Answer flows through
 * PropertyCard with NO DutyProvider and NO OffDutyPromptProvider mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";

const { useDutyOptional } = vi.hoisted(() => ({ useDutyOptional: vi.fn() }));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => useDutyOptional(),
}));

import { OffDutyPromptProvider, useDutyGuard } from "@/components/dashboard/off-duty-prompt";

afterEach(cleanup);

/** Only the two fields the guard reads; the real DutyState has 16. */
function dutyStub(canWork: boolean, goOnDuty = vi.fn().mockResolvedValue(undefined)) {
  return { canWork, goOnDuty };
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
  onGuard?.(guard);
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
function setup(canWork: boolean) {
  const goOnDuty = vi.fn().mockResolvedValue(undefined);
  useDutyOptional.mockReturnValue(dutyStub(canWork, goOnDuty));
  const onRun = vi.fn();
  const guards: ((run: () => void) => void)[] = [];
  render(
    <OffDutyPromptProvider>
      <Probe onRun={onRun} onGuard={(g) => guards.push(g)} />
    </OffDutyPromptProvider>,
  );
  return { onRun, goOnDuty, guards };
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

  it("leaves the gated control ENABLED so the click can be intercepted", () => {
    setup(false);
    // If this control were `disabled` it would fire no click at all and the
    // guard could never run. This is the whole point of spec §3.4 / D8.
    expect(screen.getByText("act").hasAttribute("disabled")).toBe(false);
  });

  it("reports gated so callers can style the control", () => {
    setup(false);
    expect(screen.getByText("act").getAttribute("data-gated")).toBe("true");
  });

  it("starts the shift from the prompt without running the original action", () => {
    const { onRun, goOnDuty } = setup(false);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Start my shift" }));
    expect(goOnDuty).toHaveBeenCalledTimes(1);
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
