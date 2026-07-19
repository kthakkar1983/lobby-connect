/**
 * Task 2 (duty-column polish plan): the shared control behind all five
 * property actions (spec §7) — Connect and Kiosk on the property cards, and the
 * three in-call Connects (audio overlay, video overlay, call tile).
 *
 * THE LOAD-BEARING DISTINCTION, and what most of this file exists to pin:
 * there are TWO kinds of unavailability and they must never be conflated
 * (spec §3.4).
 *
 *   - DUTY gating stays ENABLED. A `disabled` button fires no click event, so
 *     the guard could never intercept it and could never offer to start the
 *     shift.
 *   - REAL unavailability (offline kiosk, in-flight request, no property on the
 *     call) stays GENUINELY `disabled`. Offering "start your shift" for an
 *     offline kiosk would be a lie — starting the shift would not fix it.
 *
 * The `disabled` half is not merely a preference: tests/components/
 * call-tile.test.tsx:388-397,400-416 resolve the tile's Connect with
 * `getByText("Connect").closest("button")` and assert `.disabled`. Those
 * survive Task 14's rewiring only if `unavailableReason` keeps setting the
 * native attribute.
 *
 * The tone tests pin the other cross-file contract: call-tile.test.tsx:440-449
 * asserts the tile Connect's className contains `bg-accent`. This component
 * defaults to navy, so all three in-call sites must pass tone="teal" — and if
 * the variant mapping here ever drifts, that 2026-07-10 batch-1 polish reverts
 * silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Mock the guard rather than the duty provider: this file is about the button's
// own branches, not about when the guard fires. useDutyGuard's own semantics
// (including the no-provider pass-through) are covered by
// tests/components/off-duty-prompt.test.tsx.
const { gate } = vi.hoisted(() => ({ gate: { gated: false } }));
const { guard } = vi.hoisted(() => ({
  guard: vi.fn((run: () => void) => {
    if (!gate.gated) run();
  }),
}));
vi.mock("@/components/dashboard/off-duty-prompt", () => ({
  useDutyGuard: () => ({ gated: gate.gated, guard }),
}));

import { PropertyActionButton } from "@/components/dashboard/property-action-button";

afterEach(cleanup);
beforeEach(() => {
  gate.gated = false;
  guard.mockClear();
});

describe("PropertyActionButton", () => {
  it("runs the action when nothing is in the way", () => {
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("routes an off-duty click through the guard instead of disabling the control", () => {
    gate.gated = true;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: "Connect" });

    // The whole point of §3.4/D8: the control must stay live, or there is no
    // click to intercept and no way to offer the shift.
    expect(btn.hasAttribute("disabled")).toBe(false);

    fireEvent.click(btn);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps the same label off duty — no per-card 'Go on duty' swap", () => {
    // Spec §3.6: with five properties per pod, a "Go on duty" repeated on every
    // card reads as noise. The prompt says it once instead.
    gate.gated = true;
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.queryByText(/go on duty/i)).toBeNull();
  });

  it("stays genuinely disabled for a non-duty reason, with the reason in the title", () => {
    const onAction = vi.fn();
    render(
      <PropertyActionButton
        label="Kiosk"
        unavailableLabel="Kiosk offline"
        unavailableReason="Kiosk offline"
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "Kiosk offline" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("title")).toBe("Kiosk offline");
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it("mirrors the reason onto the wrapper so the tooltip survives disabled:pointer-events-none", () => {
    // The Button base sets `disabled:pointer-events-none`, so a title on the
    // button itself never surfaces on hover. The wrapper is the hover target.
    render(
      <PropertyActionButton label="Kiosk" unavailableReason="Kiosk offline" onAction={vi.fn()} />,
    );
    const wrapper = screen.getByRole("button", { name: "Kiosk" }).parentElement;
    expect(wrapper?.getAttribute("title")).toBe("Kiosk offline");
  });

  it("falls back to the plain label when a reason is given without an unavailable label", () => {
    render(
      <PropertyActionButton label="Connect" unavailableReason="Starting…" onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(true);
  });

  it("lets real unavailability win over duty gating", () => {
    // Both at once: an off-duty agent looking at an offline kiosk. Starting the
    // shift would not fix the kiosk, so the button must NOT become an
    // intercept — it stays disabled and the prompt is never offered.
    gate.gated = true;
    const onAction = vi.fn();
    render(
      <PropertyActionButton label="Kiosk" unavailableReason="Kiosk offline" onAction={onAction} />,
    );
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(guard).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders an inline error", () => {
    // Spec §7's behavioural gap: the three in-call copies surface nothing
    // today, so a failed remote-access launch is silent mid-call.
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        error="No remote access configured — ask an admin."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("No remote access configured");
  });

  it("renders no alert region when there is no error", () => {
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the error legible on a dark surface", () => {
    // The tile's control bar is navy. text-destructive (#C81E1E) on #14202F is
    // ~2.5:1 and fails AA, so the dark surface uses the blaze token instead.
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        surface="dark"
        error="Could not fetch credentials — try again."
      />,
    );
    expect(screen.getByRole("alert").className).toContain("text-attention");
  });

  it("defaults to navy", () => {
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" }).className).toContain("bg-primary");
  });

  it("renders teal for the in-call surfaces", () => {
    render(<PropertyActionButton label="Connect" tone="teal" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" }).className).toContain("bg-accent");
  });

  it("keeps an accessible name when the label is visually hidden", () => {
    render(<PropertyActionButton label="Reopen tile" hideLabel onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reopen tile" })).toBeTruthy();
  });

  it("reflects the unavailable label in the accessible name while icon-only", () => {
    render(
      <PropertyActionButton
        label="Kiosk"
        hideLabel
        unavailableLabel="Kiosk offline"
        unavailableReason="Kiosk offline"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Kiosk offline" })).toBeTruthy();
  });

  it("renders a supplied icon", () => {
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        icon={<svg data-testid="monitor" aria-hidden="true" />}
      />,
    );
    expect(screen.getByTestId("monitor")).toBeTruthy();
  });

  it("lets a caller's className win over the default sizing", () => {
    // The tile Connect is deliberately smaller than the card ones because it
    // lives in a Document-PiP window. cn() merges caller-last, so twMerge drops
    // the component's own h-8/text-sm rather than fighting it.
    render(
      <PropertyActionButton
        label="Connect"
        tone="teal"
        onAction={vi.fn()}
        className="h-auto px-2 py-1 text-xs"
      />,
    );
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).toContain("h-auto");
    expect(cls).toContain("text-xs");
    expect(cls).not.toContain("h-8");
    expect(cls).not.toContain("text-sm");
  });

  it("lets a caller position the wrapper", () => {
    // The tile pushes Connect to the end of its control bar with ml-auto; once
    // the button is wrapped for the error slot, the wrapper is the flex item.
    render(
      <PropertyActionButton label="Connect" onAction={vi.fn()} wrapperClassName="ml-auto" />,
    );
    const wrapper = screen.getByRole("button", { name: "Connect" }).parentElement;
    expect(wrapper?.className).toContain("ml-auto");
  });

  it("does not wrap its label", () => {
    // Spec §3.6a/§5.3: a state or label change must not resize a control.
    // Weak by construction — the Button base sets whitespace-nowrap too, so
    // this passes even if the component stops asking for it. It pins the
    // rendered guarantee, not this file's contribution to it.
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" }).className).toContain("whitespace-nowrap");
  });
});
