/**
 * DashboardWorkspace (Task 10): the header empties of duty chrome and the right
 * column gains the shift + clocks cards (spec §3.1, §3.5).
 *
 * This file exists because Task 10's entire deliverable is WIRING -- the cards
 * and the guard are each tested in isolation elsewhere, but nothing proved they
 * were actually mounted, or mounted in the right container. A regression that
 * dropped <ShiftCard/> from the aside, or that moved the aside's contents into
 * the main column, would have been invisible to the whole suite.
 *
 * Everything heavy is stubbed (Softphone owns a Twilio Device; VideoCallHost a
 * realtime channel) but the two NEW cards render for real -- they are the
 * subject. useDuty is mocked exactly as shift-card.test.tsx mocks it; the
 * "never mock duty-provider" rule in the corrections file is specific to
 * softphone.test.tsx, where the real provider is what makes the accept-gate
 * tests non-vacuous.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const { pathname, useDuty, useCallSurfaceOptional } = vi.hoisted(() => ({
  pathname: { value: "/agent" },
  useDuty: vi.fn(),
  useCallSurfaceOptional: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/push/client", () => ({ syncPushSubscription: vi.fn() }));
vi.mock("@/components/dashboard/duty-provider", () => ({ useDuty: () => useDuty() }));
vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
}));

// Stubs carry a recognisable marker each, so the ORDER assertion below reads off
// real DOM position rather than trusting the JSX it is meant to be checking.
vi.mock("@/components/softphone/softphone", () => ({
  Softphone: ({ role }: { role: string }) => <div data-testid="softphone">{role}</div>,
}));
vi.mock("@/components/video-call/video-call-host", () => ({
  VideoCallHost: () => <div data-testid="video-call-host" />,
}));
vi.mock("@/components/dashboard/call-back-shortcut", () => ({
  CallBackShortcut: () => <div data-testid="call-back-shortcut" />,
}));
vi.mock("@/components/account-menu", () => ({
  AccountMenu: () => <button type="button">Account</button>,
}));

import { DashboardWorkspace } from "@/components/dashboard-workspace";

type DutyStub = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  pushBlocked: boolean;
  endShift: ReturnType<typeof vi.fn>;
  takeBreak: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
};

function dutyStub(overrides: Partial<DutyStub> = {}): DutyStub {
  return {
    onDuty: true,
    onBreak: false,
    shiftStartedAt: "2026-07-19T21:48:00.000Z",
    pushBlocked: false,
    endShift: vi.fn().mockResolvedValue(undefined),
    takeBreak: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWorkspace(role: "AGENT" | "ADMIN" = "AGENT") {
  return render(
    <DashboardWorkspace
      role={role}
      fullName="Dilnoza R"
      email="d@example.com"
      operatorId="op-1"
      firstName="Dilnoza"
    >
      <p>page content</p>
    </DashboardWorkspace>,
  );
}

function asideOf(container: HTMLElement): HTMLElement {
  const aside = container.querySelector("aside");
  if (!aside) throw new Error("no aside rendered");
  return aside as HTMLElement;
}

function headerOf(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  if (!header) throw new Error("no header rendered");
  return header as HTMLElement;
}

function mainOf(container: HTMLElement): HTMLElement {
  const main = container.querySelector("main");
  if (!main) throw new Error("no main rendered");
  return main as HTMLElement;
}

beforeEach(() => {
  pathname.value = "/agent";
  useDuty.mockReset();
  useCallSurfaceOptional.mockReset();
  useDuty.mockReturnValue(dutyStub());
  useCallSurfaceOptional.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe("DashboardWorkspace — the right column", () => {
  it("mounts the shift card and the clocks card in the aside", () => {
    const { container } = renderWorkspace();
    const aside = within(asideOf(container));

    expect(aside.getByText("Your shift")).toBeTruthy();
    expect(aside.getByText("Clocks")).toBeTruthy();
  });

  it("puts both new cards BELOW the softphone, which keeps its position (spec D1)", () => {
    // D1 is explicit that the softphone card is not merged into the shift card
    // and does not move: the shift card "slots right below it". Asserted by DOM
    // order rather than by reading the JSX, so a reorder is caught.
    const { container } = renderWorkspace();
    const aside = asideOf(container);

    const softphone = within(aside).getByTestId("softphone");
    const shift = within(aside).getByText("Your shift");
    const clocks = within(aside).getByText("Clocks");

    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(softphone, shift)).toBe(true);
    expect(follows(shift, clocks)).toBe(true);
  });

  it("keeps VideoCallHost mounted alongside them", () => {
    // Headless -- it renders no chrome -- so its position is visually irrelevant,
    // but an active video call has to be able to overlay from any route.
    const { container } = renderWorkspace();
    expect(within(asideOf(container)).getByTestId("video-call-host")).toBeTruthy();
  });

  it("puts the cards in the aside, not the main column", () => {
    // The two cards must inherit the aside's off-home hiding (spec §3.1's stated
    // consequence). Rendering them in <main> would show them on every route and
    // silently reverse the accepted ADMIN consequence in §3.5.
    const { container } = renderWorkspace();
    // Via the guard helper, not a bare cast: if <main> were ever renamed, a cast
    // would hide the null and surface as an opaque RTL "Expected container to be
    // an Element" rather than as the regression it is.
    const main = within(mainOf(container));

    expect(main.queryByText("Your shift")).toBeNull();
    expect(main.queryByText("Clocks")).toBeNull();
  });

  it("stacks the aside naturally -- no items-stretch/h-full/mt-auto overshoot (§5 follow-up)", () => {
    // The original Task 7 mt-auto pin shoved the clocks to the PAGE BOTTOM in
    // production (the aside stretched to the full main-column height), instead
    // of leaving them right under the shift card ~= the properties row. Guard
    // the revert so nobody re-introduces the overshoot: the grid must not
    // stretch the aside, and the clocks must not be mt-auto-pinned.
    const { container } = renderWorkspace();
    const grid = asideOf(container).parentElement as HTMLElement;
    expect(grid.className).not.toContain("items-stretch");
    const aside = asideOf(container);
    expect(aside.className).not.toContain("h-full");
    const clocksHeading = within(aside).getByText("Clocks");
    const clocksChild = Array.from(aside.children).find((c) =>
      c.contains(clocksHeading),
    ) as HTMLElement;
    expect(clocksChild.className).not.toContain("mt-auto");
  });

  it("makes the aside a sticky operator rail on lg (follows the scroll, cannot overshoot)", () => {
    const { container } = renderWorkspace();
    const aside = asideOf(container);
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className).toContain("lg:top-6");
    expect(aside.className).toContain("lg:self-start");
  });
});

describe("DashboardWorkspace — the agent-only call-back shortcut", () => {
  // The stub at the top of this file has always carried a testid; until now
  // nothing queried it, so deleting the `role === "AGENT" ? ... : null` line
  // from the source left the whole file green while the testid still read as
  // coverage to anyone grepping. The gate is untested anywhere else --
  // call-back-shortcut.test.tsx exercises the component, never the gate.
  it("mounts for an AGENT", () => {
    renderWorkspace("AGENT");
    expect(screen.getByTestId("call-back-shortcut")).toBeTruthy();
  });

  it("does NOT mount for an ADMIN", () => {
    // Deliberately role-gated, not duty-gated: it is the agent's drop-moment
    // complement to her own property-card "Kiosk" button. Pathname-independent,
    // so home-vs-off-home does not enter into it.
    renderWorkspace("ADMIN");
    expect(screen.queryByTestId("call-back-shortcut")).toBeNull();
  });
});

describe("DashboardWorkspace — the header empties", () => {
  it("carries no duty affordance at all while on duty", () => {
    // The retired DutyControl rendered an "On duty · 2h 00m" pill, a "Take a
    // break" button and a "Duty menu" chevron here. Nothing shift-related may
    // remain (spec §3.5 / D3) -- that is what absorbs both time-tracker polish
    // items: the lone h-9 "Go on duty" leaves the header, so the pill-size
    // mismatch cannot recur.
    const { container } = renderWorkspace();
    const header = within(headerOf(container));

    expect(header.queryByRole("button", { name: /duty menu/i })).toBeNull();
    expect(header.queryByRole("button", { name: /go on duty/i })).toBeNull();
    expect(header.queryByRole("button", { name: /take a break/i })).toBeNull();
    expect(header.queryByRole("button", { name: /end shift/i })).toBeNull();
    expect(header.queryByText(/on duty/i)).toBeNull();
  });

  it("carries no duty affordance off duty either", () => {
    useDuty.mockReturnValue(dutyStub({ onDuty: false, shiftStartedAt: null }));
    const { container } = renderWorkspace();
    const header = within(headerOf(container));

    expect(header.queryByRole("button", { name: /go on duty/i })).toBeNull();
    // Going on duty now lives on the softphone's RING (Task 9), in the column --
    // and the Softphone is stubbed here, so this file proves only that the header
    // is empty and that the off-duty shift card renders. It CANNOT prove a
    // go-on-duty control exists anywhere; that lives in softphone.test.tsx (the
    // D13 "turns the ring into a go-on-duty control while off duty" block, plus
    // the error-phase test that pins it surviving a dead Twilio line). Read this
    // assertion as "the header is empty AND the column took over", not as
    // "duty is reachable" -- the gap between those two is what let a
    // no-duty-control-in-the-error-phase regression through review.
    expect(within(asideOf(container)).getByText("Not on duty")).toBeTruthy();
  });

  it("keeps the account menu as the header's only control", () => {
    const { container } = renderWorkspace();
    const buttons = within(headerOf(container)).getAllByRole("button");

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Account");
  });

  it("relocates End shift into the column rather than deleting it", () => {
    // The deletion tests above pass just as well if End shift vanished entirely,
    // which would strand a live shift with no way to close it short of the 10h
    // cap. This is the half that proves it MOVED.
    const { container } = renderWorkspace();
    const endShift = screen.getByRole("button", { name: /^end shift$/i });

    expect(asideOf(container).contains(endShift)).toBe(true);
    expect(headerOf(container).contains(endShift)).toBe(false);
  });
});

describe("DashboardWorkspace — off-home", () => {
  it("hides the aside with a class instead of unmounting it", () => {
    // Load-bearing: the softphone's Twilio Device must never deregister, so the
    // whole column is display:none off-home, never removed. The two new cards
    // ride along, which is the accepted §3.5 consequence -- an ADMIN off-home
    // has no duty affordance and navigates home to end a shift.
    pathname.value = "/admin/users";
    const { container } = renderWorkspace("ADMIN");
    const aside = asideOf(container);

    expect(aside.className).toContain("hidden");
    expect(within(aside).getByTestId("softphone")).toBeTruthy();
    expect(within(aside).getByText("Your shift")).toBeTruthy();
  });

  it("drops the hiding class on home", () => {
    // The counterpart to the test above: without it, a permanently-hidden aside
    // would satisfy the whole file. Note ADMIN's home is /admin, not /agent --
    // the workspace resolves home per role, so the pathname has to match.
    pathname.value = "/admin";
    const { container } = renderWorkspace("ADMIN");
    expect(asideOf(container).className).not.toContain("hidden");
  });
});
