/**
 * DutyCard (Task 3, plan `docs/plans/2026-07-23-merged-duty-rail.md`): a
 * focused COMPOSITION test only.
 *
 * <Softphone>'s own chromeless behaviour is covered by softphone.test.tsx
 * (Task 2); <ShiftCard>'s own chromeless behaviour and full duty-state
 * branching are covered by shift-card.test.tsx (Task 1). Rendering the REAL
 * Softphone here would mount a Twilio Device (dynamic
 * `import("@twilio/voice-sdk")` + a token fetch) for no benefit to this
 * file's subject, so Softphone is STUBBED -- mirroring
 * dashboard-workspace.test.tsx's existing `data-testid="softphone"`
 * convention (same locator, so a future reader shares one mental model
 * across both files), with a spy added so the received props (chromeless,
 * role) stay inspectable even though the rendered marker only shows role as
 * text.
 *
 * ShiftCard renders for REAL -- the composition is the point -- so its
 * non-optional useDuty() dependency has to be satisfied. Satisfied exactly
 * the way shift-card.test.tsx satisfies it: the duty-provider /
 * call-surface-provider MODULES are mocked (not a real <DutyProvider>
 * ancestor), pinned to the off-duty branch -- the simplest one, with no
 * elapsed-time interval running -- so the real ShiftCard renders
 * "Not on duty". Full duty-state coverage (on duty, on break, mid-call,
 * blocked push, …) stays shift-card.test.tsx's job; repeating it here would
 * just be a slower copy of that file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";

const softphoneSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/softphone/softphone", () => ({
  Softphone: (props: { role: string; chromeless?: boolean }) => {
    softphoneSpy(props);
    return <div data-testid="softphone">{props.role}</div>;
  },
}));

const { useDuty, useCallSurfaceOptional } = vi.hoisted(() => ({
  useDuty: vi.fn(),
  useCallSurfaceOptional: vi.fn(),
}));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDuty: () => useDuty(),
}));
// ShiftCard reads the live call via the OPTIONAL hook to apply its mid-call
// rules; null here (no call) keeps this file off that surface entirely.
vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
}));

import { DutyCard } from "@/components/dashboard/duty-card";

beforeEach(() => {
  useDuty.mockReset();
  useCallSurfaceOptional.mockReset();
  // Off duty: the simplest ShiftCard branch (no interval, no Break/End-shift
  // buttons) -- this file's subject is composition, not duty state.
  useDuty.mockReturnValue({
    onDuty: false,
    onBreak: false,
    shiftStartedAt: null,
    pushBlocked: false,
    endShift: vi.fn(),
    takeBreak: vi.fn(),
    resume: vi.fn(),
  });
  useCallSurfaceOptional.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  softphoneSpy.mockClear();
});

function follows(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("DutyCard — composition", () => {
  it("stacks Softphone -> divider -> shift content inside exactly one Card, with no card nested inside", () => {
    const { container } = render(<DutyCard role="AGENT" />);

    const cards = container.querySelectorAll('[data-slot="card"]');
    // Exactly one shared card -- if either child still carried its OWN
    // chrome (a chromeless prop not actually wired through), this would be
    // 2 or 3.
    expect(cards.length).toBe(1);
    const card = cards[0] as HTMLElement;

    // querySelectorAll on an element searches descendants only (excludes the
    // element itself), so this specifically proves neither child re-added
    // its own <Card> underneath this shared one.
    expect(card.querySelectorAll('[data-slot="card"]').length).toBe(0);

    const scoped = within(card);
    const softphone = scoped.getByTestId("softphone");
    const shiftLabel = scoped.getByText("Your shift");
    // Confirms the duty mock above actually reached ShiftCard's off-duty
    // branch (not just that the "Your shift" label rendered).
    expect(scoped.getByText("Not on duty")).toBeTruthy();

    const divider = card.querySelector('[aria-hidden="true"]');
    if (!divider) throw new Error("no divider rendered inside DutyCard");
    expect(divider.className).toMatch(/border-t/);

    // Structural pin: exactly the three direct children DutyCard's own
    // source lists (softphone stub, divider, shift content) -- catches a
    // stray extra node the order checks below wouldn't.
    expect(card.children.length).toBe(3);

    expect(follows(softphone, divider)).toBe(true);
    expect(follows(divider, shiftLabel)).toBe(true);
  });

  it("forwards chromeless and the AGENT role to Softphone", () => {
    render(<DutyCard role="AGENT" />);
    expect(softphoneSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: "AGENT", chromeless: true }),
    );
  });

  it("forwards the ADMIN role too, so the prop isn't hardcoded", () => {
    render(<DutyCard role="ADMIN" />);
    expect(softphoneSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: "ADMIN", chromeless: true }),
    );
  });
});
