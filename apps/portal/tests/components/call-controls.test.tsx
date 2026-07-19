/**
 * The shared control-bar vocabulary (spec §5). Both in-call surfaces build
 * their bar from these, so a regression here lands on every live call.
 *
 * Two properties are worth pinning directly rather than through the overlays:
 *
 *   - NO CONTROL CHANGES SIZE WHEN ITS STATE CHANGES. The bar used to shift
 *     under the agent's cursor mid-call every time she muted. A label swap is
 *     the only way that can come back, and it is a one-character regression.
 *   - `End call` IS ONE DEFINITION WITH ONE DELIBERATE DIFFERENCE. Audio's fill
 *     is blaze because red=911 was reading as the "end call" cue (punch-list
 *     B1); video's is navy. Unifying them would erase the visual separation
 *     that decision bought, on the surface where a mistap reaches 911.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CallControlDivider,
  CallControlTray,
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

  // ⚠ THE LABEL TOKEN IS PART OF THE FILL DECISION — pinned so that changing one
  // without re-measuring the other fails loudly. The pressed label composites
  // against `bg-accent/10` over the TRAY (#E0EFEF), never against white:
  //
  //   text-accent-text -> 3.81:1  FAIL (it is the AA-on-WHITE teal; this
  //                                     control has never rendered on white)
  //   text-foreground  -> 11.86:1 PASS
  //
  // This control is ENABLED in both states, so the inactive-component exemption
  // never applies and the label owes a full 4.5:1. Failure this pins: the most-
  // pressed in-call control reads at 3.81:1 for an agent working a night shift,
  // in the state that means her mic is muted.
  it("holds the pressed label at full contrast against the tray fill", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").className).toContain("text-foreground");
    expect(screen.getByRole("button").className).not.toContain("text-accent-text");

    rerender(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    // Unpressed sits on the bare tray (#F4F7F7): text-text-muted is 5.08:1.
    expect(screen.getByRole("button").className).toContain("text-text-muted");
  });

  // The icon swaps between glyphs of different advance widths, so a constant
  // label alone does not hold the box still — the width does.
  it("is fixed-width in both states", () => {
    const { rerender } = render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button").className).toContain("w-28");

    rerender(<CallToggleButton label="Mute" icon={null} pressed title="on" onToggle={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("w-28");
  });
});

// Spec §5.4's whole purpose is that Connect and End call are visually separate
// from the mic toggle — Connect hands off to RustDesk and End call terminates a
// guest's call, neither of which belongs next to a mute button. A reviewer
// demonstrated that replacing the divider's body with `return null` AND
// stripping the tray to a bare flex row left the entire suite green, so the one
// part of §5 with a stated safety purpose had no coverage at all.
describe("CallControlTray / CallControlDivider (spec §5.4 grouping)", () => {
  it("wraps the adjust-controls in one tray, together and apart from the rest", () => {
    render(
      <div>
        <CallControlTray>
          <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />
          <CallToggleButton label="Camera" icon={null} pressed={false} title="off" onToggle={vi.fn()} />
        </CallControlTray>
        <CallControlDivider />
        <button type="button">Connect</button>
      </div>,
    );

    const tray = screen.getByTestId("call-control-tray");
    expect(tray.contains(screen.getByRole("button", { name: /^mute$/i }))).toBe(true);
    expect(tray.contains(screen.getByRole("button", { name: /^camera\b/i }))).toBe(true);
    // Connect is the control the grouping exists to hold OUT of the tray.
    expect(tray.contains(screen.getByRole("button", { name: "Connect" }))).toBe(false);

    // The tray must be a fill, not a bare flex row — stripping its background
    // leaves the DOM grouping intact and everything above green while erasing
    // the grouping on screen. Deliberately loose about WHICH fill: the current
    // token reads at only 1.08:1 against the control bar and may have to change
    // once someone looks at it on hardware. Pinning the token here would fight
    // that; pinning that a fill EXISTS will not.
    expect(tray.className).toMatch(/(^|\s)bg-/);
  });

  it("renders a real divider between the tray and Connect", () => {
    render(
      <div>
        <CallControlTray>
          <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />
        </CallControlTray>
        <CallControlDivider />
        <button type="button">Connect</button>
      </div>,
    );

    const divider = screen.getByTestId("call-control-divider");
    // A `return null` divider would leave the DOM order intact and every other
    // assertion green — so pin that it renders something with a visible fill.
    expect(divider.className).toContain("bg-border");
    expect(divider.getAttribute("aria-hidden")).toBe("true");

    const tray = screen.getByTestId("call-control-tray");
    const connect = screen.getByRole("button", { name: "Connect" });
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: the divider comes after the tray
    // and before Connect.
    expect(tray.compareDocumentPosition(divider) & 4).toBeTruthy();
    expect(divider.compareDocumentPosition(connect) & 4).toBeTruthy();
  });

  it("fires onToggle when clicked", async () => {
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

  it("is navy on video", () => {
    render(<EndCallButton tone="navy" onEnd={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).not.toContain("bg-attention");
  });

  // ⚠ DO NOT "unify" this to navy. Audio is the one surface where a red 911 and
  // the end-call button coexist, and blaze is the separation punch-list B1
  // bought after red was misread as the end-call cue.
  it("is blaze on audio, deliberately overriding the navy default", () => {
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
