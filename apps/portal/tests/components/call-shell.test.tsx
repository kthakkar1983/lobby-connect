/**
 * Direct coverage for the shared in-call chrome extracted in Task 11.
 *
 * Two properties here were demonstrably unpinned after the extraction: a
 * reviewer inverted the SPLITS map (swapping the stage and panel basis classes
 * on BOTH surfaces) and swapped the two banner slots on the audio overlay, and
 * the entire jsdom suite stayed green both times. Task 12 edits exactly these.
 *
 * The third property is the audio/video asymmetry the shell exists to hold
 * still: audio passes `emergency` (911), video passes none. 911 on audio is a
 * live path even while the call tile is up — the overlay's `collapsed` state
 * hides the call card and caption band, never the header — so "the header
 * always renders" is a life-safety invariant, not a layout detail.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CallShell } from "@/components/call/call-shell";

afterEach(() => cleanup());

/** True when `b` comes after `a` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const baseProps = {
  title: "On call · The Sample Hotel",
  stage: (basis: string) => <div data-testid="stage" className={basis} />,
  panel: (basis: string) => <div data-testid="panel" className={basis} />,
  controls: <button type="button">End call</button>,
};

describe("CallShell", () => {
  it("renders the title in the header", () => {
    render(<CallShell {...baseProps} playbookBasis="70%" />);
    expect(screen.getByText(/On call · The Sample Hotel/)).toBeTruthy();
  });

  // The body ratio is named by the PLAYBOOK's share — the RIGHT-hand panel and
  // the larger half. If these two assertions ever read as the stage being the
  // larger side, the map has been inverted.
  it("gives the playbook 70% and the stage 30% at playbookBasis=70%", () => {
    render(<CallShell {...baseProps} playbookBasis="70%" />);
    expect(screen.getByTestId("panel").className).toBe("basis-[70%]");
    expect(screen.getByTestId("stage").className).toBe("basis-[30%]");
  });

  it("gives the playbook 3/5 and the stage 2/5 at playbookBasis=60%", () => {
    render(<CallShell {...baseProps} playbookBasis="60%" />);
    expect(screen.getByTestId("panel").className).toBe("basis-3/5");
    expect(screen.getByTestId("stage").className).toBe("basis-2/5");
  });

  it("orders the stage before the panel", () => {
    render(<CallShell {...baseProps} playbookBasis="60%" />);
    expect(precedes(screen.getByTestId("stage"), screen.getByTestId("panel"))).toBe(true);
  });

  // The two banner slots are structurally distinct positions, not one slot with
  // a hint. Audio's 911-active strip (which carries the instruction to relay the
  // property address) sits ABOVE the body; its caption band sits BELOW.
  it("puts bannersAboveBody above the body and bannersBelowBody below it", () => {
    render(
      <CallShell
        {...baseProps}
        playbookBasis="70%"
        bannersAboveBody={<div data-testid="above" />}
        bannersBelowBody={<div data-testid="below" />}
      />,
    );
    const above = screen.getByTestId("above");
    const stage = screen.getByTestId("stage");
    const below = screen.getByTestId("below");

    expect(precedes(above, stage)).toBe(true);
    expect(precedes(stage, below)).toBe(true);
  });

  // AUDIO passes an emergency control; VIDEO passes none. Both directions are
  // pinned so the absence stays a decision rather than an omission.
  it("renders the emergency control in the header when one is provided (audio)", () => {
    render(
      <CallShell
        {...baseProps}
        playbookBasis="70%"
        emergency={<button type="button">Call 911</button>}
      />,
    );
    expect(screen.getByRole("button", { name: /call 911/i })).toBeTruthy();
  });

  it("renders no emergency slot when none is provided (video has no 911)", () => {
    render(<CallShell {...baseProps} playbookBasis="60%" />);
    expect(screen.queryByRole("button", { name: /911/i })).toBeNull();
  });
});
