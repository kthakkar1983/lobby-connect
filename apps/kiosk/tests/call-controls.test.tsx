// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CallControls } from "@/screens/CallControls";

// The control bar used to bottom-align its controls (`items-end`) and give
// each label a free-width <span>. Labels change with state ("Mute"->"Unmute",
// "Camera off"->"Camera on"), so the free width made the label span (and thus
// its whole button, and thus the row's total width) change size mid-call —
// shoving the bar sideways under the guest's thumb. Fixed here: `items-center`
// (was `items-end`) + a fixed, centered, non-wrapping width on the label span
// so a label swap can change its TEXT without changing its BOX.
//
// w-16 (64px) was chosen over w-20 (80px) using a live measurement of the
// actual "Outfit" 500-weight font at 11px (this file's font/size) rather than
// a guess: the widest real label, "Camera off", measures ~55.6px — comfortably
// under 64px. See the CallControls.tsx comment for the same note.

const noop = () => {};

function renderBar(props: Partial<Parameters<typeof CallControls>[0]> = {}) {
  return render(
    <CallControls
      muted={false}
      cameraOff={false}
      onMute={noop}
      onCamera={noop}
      primary={{ label: "Cancel", onClick: noop }}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("CallControls — terminating control colour", () => {
  // Smoke follow-up (2026-07-21): Kumar asked for the kiosk End/Cancel button to
  // be blaze/orange, matching the agent side (agent End call is blaze on both the
  // overlay and the tile). Blaze is NOT red — 911 has no kiosk path — so this
  // does not reintroduce an alarm colour; it unifies the terminating control's
  // fill across the guest and agent surfaces. The `variant="end"` icon tile
  // carries the fill.
  it("fills the terminating (primary) control with blaze, not the neutral card fill", () => {
    render(
      <CallControls
        muted={false}
        cameraOff={false}
        onMute={noop}
        onCamera={noop}
        primary={{ label: "End", onClick: noop }}
      />,
    );
    const endBtn = screen.getByText("End").closest("button") as HTMLElement;
    // The first span in the button is the round icon tile that carries the skin.
    const iconTile = endBtn.querySelector("span") as HTMLElement;
    expect(iconTile.className).toContain("bg-attention");
    expect(iconTile.className).toContain("text-attention-foreground");
    // The old neutral treatment must be gone.
    expect(iconTile.className).not.toContain("bg-card");
    expect(iconTile.className).not.toContain("text-call");
  });
});

describe("CallControls — bar alignment", () => {
  it("centers the controls (items-center) instead of bottom-aligning them (items-end)", () => {
    const { container } = renderBar();
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toMatch(/(^|\s)items-center(\s|$)/);
    expect(bar.className).not.toMatch(/(^|\s)items-end(\s|$)/);
  });
});

describe("CallControls — label width is fixed so a label swap cannot reflow the bar", () => {
  it("gives the label span a fixed, centered, non-wrapping width", () => {
    renderBar();
    const label = screen.getByText("Mute");
    expect(label.className).toMatch(/(^|\s)w-16(\s|$)/);
    expect(label.className).toContain("whitespace-nowrap");
    expect(label.className).toContain("text-center");
  });

  it("keeps the fixed-width class through the Mute <-> Unmute toggle, while the visible text changes", () => {
    const { rerender } = renderBar({ muted: false });
    const off = screen.getByText("Mute");
    expect(off.className).toMatch(/(^|\s)w-16(\s|$)/);
    expect(off.className).toContain("whitespace-nowrap");

    rerender(
      <CallControls
        muted
        cameraOff={false}
        onMute={noop}
        onCamera={noop}
        primary={{ label: "Cancel", onClick: noop }}
      />,
    );
    // The text genuinely changed (this is not a no-op toggle)...
    expect(screen.queryByText("Mute")).toBeNull();
    const on = screen.getByText("Unmute");
    // ...but the fixed-width/no-wrap contract held on the new label too.
    expect(on.className).toMatch(/(^|\s)w-16(\s|$)/);
    expect(on.className).toContain("whitespace-nowrap");
  });

  it("keeps the fixed-width class through the Camera off <-> Camera on toggle, while the visible text changes", () => {
    const { rerender } = renderBar({ cameraOff: false });
    const off = screen.getByText("Camera off");
    expect(off.className).toMatch(/(^|\s)w-16(\s|$)/);
    expect(off.className).toContain("whitespace-nowrap");

    rerender(
      <CallControls
        muted={false}
        cameraOff
        onMute={noop}
        onCamera={noop}
        primary={{ label: "Cancel", onClick: noop }}
      />,
    );
    expect(screen.queryByText("Camera off")).toBeNull();
    const on = screen.getByText("Camera on");
    expect(on.className).toMatch(/(^|\s)w-16(\s|$)/);
    expect(on.className).toContain("whitespace-nowrap");
  });
});
