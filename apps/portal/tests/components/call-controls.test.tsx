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
