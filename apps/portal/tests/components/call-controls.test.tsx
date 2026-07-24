/**
 * The shared control-bar vocabulary (spec §5). Both in-call surfaces build
 * their bar from these, so a regression here lands on every live call.
 *
 * Two properties are worth pinning directly rather than through the overlays:
 *
 *   - NO CONTROL CHANGES SIZE WHEN ITS STATE CHANGES. The bar used to shift
 *     under the agent's cursor mid-call every time she muted. A label swap is
 *     the only way that can come back, and it is a one-character regression.
 *   - `End call` IS ONE DEFINITION, BLAZE ON BOTH SURFACES (D2, 2026-07-20).
 *     The two used to differ — audio's fill was blaze because red=911 was
 *     reading as the "end call" cue (punch-list B1), video stayed navy — but
 *     video has no 911 control to separate from, so the split bought nothing
 *     there and was dropped. `tone` stays a prop so a surface could
 *     re-diverge deliberately later.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CallControlDivider,
  CallToggleButton,
  EndCallButton,
} from "@/components/call/call-controls";

afterEach(() => cleanup());

describe("CallToggleButton", () => {
  it("keeps the same label in both states so the bar cannot reflow", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").textContent).toBe("Mute");

    rerender(
      <CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").textContent).toBe("Mute");
  });

  it("carries the state in aria-pressed now that the label no longer does", () => {
    const { rerender } = render(
      <CallToggleButton label="Camera" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");

    rerender(
      <CallToggleButton label="Camera" icon={null} pressed title="on" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  // "Pressed" on a control labelled `Camera` is genuinely ambiguous to a
  // screen-reader user, so the title says what the click will do — the same
  // resolution <CaptionToggle> already uses.
  it("states the action the next click performs in its title", () => {
    render(
      <CallToggleButton
        label="Camera"
        icon={null}
        pressed
        title="Turn your camera on"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").getAttribute("title")).toBe("Turn your camera on");
  });

  // ⚠ `title` is a TOOLTIP, not a name. Per the accessible-name computation,
  // name-from-content beats the title attribute, so `title` never enters the
  // accessible name and AT exposes it inconsistently. The test above pins the
  // tooltip; this one pins the thing a screen reader actually announces.
  //
  // Failure this pins: an agent using a screen reader toggles her camera on a
  // live video check-in, hears "Camera, pressed" — which is emitted when the
  // camera is OFF — concludes she is on air, and finishes the guest interaction
  // with a dead camera, on the surface that exists for kiosk eye contact.
  it("names the camera's true state, so 'pressed' cannot read inverted", () => {
    const { rerender } = render(
      <CallToggleButton
        label="Camera"
        icon={null}
        pressed={false}
        title="Turn your camera off"
        stateLabel="camera is on"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Camera, camera is on" })).toBeTruthy();

    rerender(
      <CallToggleButton
        label="Camera"
        icon={null}
        pressed
        title="Turn your camera on"
        stateLabel="camera is off"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Camera, camera is off" })).toBeTruthy();
    // The two states must not share an accessible name.
    expect(screen.queryByRole("button", { name: "Camera, camera is on" })).toBeNull();
  });

  // WCAG 2.5.3 Label in Name — the visible label must survive at the FRONT of
  // the accessible name, or voice control stops matching "click Camera".
  // Composing the name from `label` is what makes that structural rather than a
  // convention someone can forget.
  it("keeps the visible label inside the accessible name, and out of the layout", () => {
    render(
      <CallToggleButton
        label="Camera"
        icon={null}
        pressed
        title="on"
        stateLabel="camera is off"
        onToggle={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Camera, camera is off");
    expect(btn.getAttribute("aria-label")!.startsWith("Camera")).toBe(true);
    // The state is NOT rendered — a visible state string would reintroduce the
    // reflow this whole component exists to prevent.
    expect(btn.textContent).toBe("Camera");
  });

  // Mute's name is already unambiguous, so it opts out and keeps its name from
  // content. Pinned so nobody "harmonises" the tray by giving Mute a state it
  // does not need — that would change its accessible name and break every
  // /^mute$/ query in the suite.
  it("adds no aria-label when no stateLabel is given", () => {
    render(
      <CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
    expect(btn.hasAttribute("aria-label")).toBe(false);
  });

  // The gated/enabled lesson from Phases B and C, one more time: this control is
  // ENABLED in both states, so WCAG's inactive-component exemption never covers
  // it. State is carried by the FILL and the border — never by dimming the
  // element, which would composite the label down with it.
  it("recesses the fill, not the element, when pressed", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    // `disabled:opacity-50` from the Button base is fine — it only applies to a
    // control that IS disabled. An UNPREFIXED opacity would dim this one.
    expect(screen.getByRole("button").className).not.toMatch(/(^|\s)opacity-/);

    rerender(<CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-accent/10");
    expect(btn.className).not.toMatch(/(^|\s)opacity-/);
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  // ⚠ THE LABEL TOKEN IS PART OF THE FILL DECISION — pinned so a future swap
  // can't silently re-diverge the two toggles. Since the 2026-07-20 bar reorder
  // dropped the tray, the pressed label composites against `bg-accent/10` over
  // `bg-card` (#FFFFFF -> ~#EAF6F6), not the old tray's #E0EFEF:
  //
  //   text-foreground  -> 12.71:1 PASS  (the shared <CaptionToggle> recipe)
  //   text-accent-text -> ~5.40:1 PASS  (the darkened token clears AA on white
  //                                      now too; text-foreground kept for the
  //                                      shared recipe + more margin, not because
  //                                      accent fails)
  //
  // This control is ENABLED in both states, so the inactive-component exemption
  // never applies and the label owes a full 4.5:1. What this pins: the pressed
  // in-call control — the state that means her mic is muted — stays on the shared
  // full-strength recipe rather than drifting to a different label token.
  it("holds the pressed label at full contrast on the control bar", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").className).toContain("text-foreground");
    expect(screen.getByRole("button").className).not.toContain("text-accent-text");

    rerender(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    // Unpressed sits on the bare control bar (bg-card #FFFFFF): text-text-muted is 5.48:1.
    expect(screen.getByRole("button").className).toContain("text-text-muted");
  });

  // The icon swaps between glyphs of different advance widths, so a constant
  // label alone does not hold the box still — the width does.
  //
  // `w-36` (Task 3, 2026-07-21), not `w-28`: the labelled <CaptionToggle> that
  // sits beside this control on both overlays is passed `w-36` directly at
  // its call sites (fits its longest label, "Captions off"), so the three
  // in-call toggles must share that value or the row reads uneven.
  it("is fixed-width in both states, matching the neighbouring Captions toggle (w-36)", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").className).toContain("w-36");
    expect(screen.getByRole("button").className).not.toContain("w-28");

    rerender(<CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("w-36");
    expect(screen.getByRole("button").className).not.toContain("w-28");
  });
});

// Spec §5.4: End call / Connect read isolated from the mic toggle via a real
// divider — Connect hands off to RustDesk and End call terminates a guest's
// call, neither of which belongs beside a mute button. A reviewer showed that
// replacing the divider body with `return null` left the whole suite green, so
// the one part of §5 with a stated safety purpose needs its own coverage. (The
// old CallControlTray wrapper this block also exercised was removed in Batch 5a
// — both overlays sequence the controls as flat siblings now.)
describe("CallControlDivider (spec §5.4 isolation)", () => {
  it("renders a real divider between the toggle and Connect", () => {
    render(
      <div>
        <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />
        <CallControlDivider />
        <button type="button">Connect</button>
      </div>,
    );

    const divider = screen.getByTestId("call-control-divider");
    // A `return null` divider would leave DOM order intact and every other
    // assertion green — pin that it renders something with a visible fill.
    expect(divider.className).toContain("bg-border");
    expect(divider.getAttribute("aria-hidden")).toBe("true");

    // Node.DOCUMENT_POSITION_FOLLOWING === 4: divider sits after the toggle and
    // before Connect (the control the isolation exists to hold apart).
    const mute = screen.getByRole("button", { name: /^mute$/i });
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(mute.compareDocumentPosition(divider) & 4).toBeTruthy();
    expect(divider.compareDocumentPosition(connect) & 4).toBeTruthy();
  });

  it("fires onToggle when the toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("EndCallButton", () => {
  it("reads 'End call' on both surfaces (D11)", () => {
    const { rerender } = render(<EndCallButton tone="navy" onEnd={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toBe("End call");

    rerender(<EndCallButton tone="blaze" onEnd={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toBe("End call");
  });

  // `tone` is a generic prop on the component (see the EndCallButton docblock
  // in call-controls.tsx) — these two tests pin its class mapping, independent
  // of which surface calls it with which value. Today every real caller passes
  // tone="blaze" (D2, 2026-07-20); `tone` stays a prop so a surface could
  // re-diverge deliberately later.
  it("renders navy when tone=navy", () => {
    render(<EndCallButton tone="navy" onEnd={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).not.toContain("bg-attention");
  });

  it("renders blaze when tone=blaze", () => {
    render(<EndCallButton tone="blaze" onEnd={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-attention");
    expect(btn.className).not.toContain("bg-primary");
  });

  it("fires onEnd when clicked", async () => {
    const user = userEvent.setup();
    const onEnd = vi.fn();
    render(<EndCallButton tone="navy" onEnd={onEnd} />);
    await user.click(screen.getByRole("button"));
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
