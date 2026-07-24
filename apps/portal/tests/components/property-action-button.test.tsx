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
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
// Type-only, so it is erased and cannot execute before the hoisted vi.mock.
import type * as OffDutyPrompt from "@/components/dashboard/off-duty-prompt";

// Mock the guard rather than the duty provider: most of this file is about the
// button's own branches, not about when the guard fires. useDutyGuard's own
// semantics are covered by tests/components/off-duty-prompt.test.tsx.
//
// `gate.real` flips the mock back to the genuine hook for the one test that
// proves the two actually compose — see "composes with the real guard".
const { gate } = vi.hoisted(() => ({ gate: { gated: false, real: false } }));
const { guard } = vi.hoisted(() => ({
  guard: vi.fn((run: () => void) => {
    if (!gate.gated) run();
  }),
}));
vi.mock("@/components/dashboard/off-duty-prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof OffDutyPrompt>();
  return {
    ...actual,
    useDutyGuard: () => (gate.real ? actual.useDutyGuard() : { gated: gate.gated, guard }),
  };
});

import { PropertyActionButton } from "@/components/dashboard/property-action-button";

afterEach(cleanup);
beforeEach(() => {
  gate.gated = false;
  gate.real = false;
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

  it("recesses a gated control by muting the fill, never by dimming the element", () => {
    // WCAG 1.4.3 exempts an "inactive user interface component" from contrast,
    // which is why a `disabled` button may be dimmed freely. A gated control is
    // the opposite by design — enabled and operable — so the exemption does not
    // apply and its 14px label owes 4.5:1.
    //
    // Element opacity composites the LABEL along with the fill: `opacity-60` on
    // a white card gives fill rgb(111,129,147) under an opaque white label =
    // 4.01:1, below AA. Muting only the fill leaves the label untouched:
    // bg-primary/70 = 5.43:1, still clearly recessed against 14.03:1 at full
    // strength. Hover is pinned to the same alpha so it cannot undo the signal.
    gate.gated = true;
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).toContain("bg-primary/70");
    expect(cls).toContain("hover:bg-primary/70");
    expect(cls).not.toContain("opacity-60");
  });

  it("mutes the teal fill for a gated in-call tone", () => {
    // bg-accent/70 over white = 7.89:1 against the ink label.
    gate.gated = true;
    render(<PropertyActionButton label="Connect" tone="teal" onAction={vi.fn()} />);
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).toContain("bg-accent/70");
    expect(cls).toContain("hover:bg-accent/70");
  });

  it("applies no gated cue on a dark surface, deliberately", () => {
    // There is no honest one-size treatment on the tile's navy: bg-primary/70
    // composites straight back to navy (no cue at all) and bg-accent/70 leaves
    // the ink label at 3.65:1. Nothing is invented here, and the reason is now
    // structural: the only dark-surface caller is the call tile, which passes
    // `gate="none"`, so it has no gated state to cue. An earlier version of this
    // comment justified it by claiming the state was unreachable because a shift
    // cannot end mid-call — that was WRONG (end-shift from a second tab has no
    // ON_CALL guard), which is exactly why the tile stopped relying on it.
    gate.gated = true;
    render(
      <PropertyActionButton label="Connect" tone="teal" surface="dark" onAction={vi.fn()} />,
    );
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).not.toContain("bg-accent/70");
    expect(cls).not.toContain("opacity-60");
  });

  // gate="none" — the three IN-CALL Connects. Remoting into the hotel PC during
  // a call that is already live is not an off-duty action: the guest is on the
  // line whatever the shift row says, and it is the one action the product
  // exists to enable.
  //
  // This is not hypothetical. POST /api/presence/end-shift flips the profile to
  // OFFLINE with NO ON_CALL guard, and the mid-call suppression on the shift
  // card is sourced per-tab from that tab's own useCallSurfaceOptional()?.active
  // — so End shift pressed in a SECOND dashboard tab (which sees no live call)
  // gates the first tab within one heartbeat, via the gated beat's markOffDuty().
  // Gated, the tile's Connect would be a DEAD CLICK: the prompt is an
  // AlertDialog in the MAIN document, and the tile is used precisely when that
  // document is backgrounded behind RustDesk.
  it("runs a gate='none' action while gated, instead of withholding it", () => {
    gate.gated = true;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" gate="none" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    // And it must not even consult the guard — reaching it and being let
    // through would be luck, not a decision.
    expect(guard).not.toHaveBeenCalled();
  });

  it("shows no gated cue on a gate='none' control", () => {
    // A control that is never withheld must never LOOK withheld. Both halves of
    // the gate opt out together, or the button reads unavailable while working.
    gate.gated = true;
    render(<PropertyActionButton label="Connect" tone="teal" gate="none" onAction={vi.fn()} />);
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).not.toContain("bg-accent/70");
    expect(cls).toContain("bg-accent");
  });

  it("still gates by default, so the opt-out has to be asked for", () => {
    gate.gated = true;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
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
        error="No remote access configured. Ask an admin."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("No remote access configured");
  });

  it("renders no alert region when there is no error", () => {
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ERROR GEOMETRY. The block placement is right for the property cards, whose
  // action row is their own. It is WRONG for the three in-call control bars: a
  // dedicated commit fixed every width and height in those bars so the row
  // cannot move under the agent's hand during a live guest call, and a flow
  // error reintroduces exactly that. On the overlays it grows the bar ~20px and
  // lifts End call and Mute; in the tile's fixed 380x300 Document-PiP window the
  // wrapper shrinks toward min-content, so the message wraps to several lines
  // and permanently eats a third of the guest's video face — with no dismissal
  // short of a successful retry.
  //
  // jsdom does no layout (offsetHeight is 0 for everything), so what these pin
  // is the MECHANISM: out of flow, bounded, and titled for the full text.
  it("floats the error out of flow so it cannot resize a control bar", () => {
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        errorPlacement="float"
        error="Could not fetch credentials. Try again."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("absolute");
    // Bounded both ways, so no string can grow it without limit over the video.
    expect(alert.className).toContain("max-w-64");
    expect(alert.className).toContain("line-clamp-2");
    // Clamped text still has to be readable in full somewhere.
    expect(alert.getAttribute("title")).toBe("Could not fetch credentials. Try again.");
  });

  it("keeps the error in flow by default, where the row is the card's own", () => {
    render(
      <PropertyActionButton label="Connect" onAction={vi.fn()} error="No remote access configured." />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).not.toContain("absolute");
    expect(alert.hasAttribute("title")).toBe(false);
  });

  it("gives a floated error an opaque backing, because it lands over video", () => {
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        surface="dark"
        errorPlacement="float"
        error="No credentials. Ask an admin."
      />,
    );
    // The tile floats over the guest's face; transparent text on it is a
    // legibility problem the contrast tokens alone cannot solve.
    expect(screen.getByRole("alert").className).toContain("bg-primary");
  });

  // Two rapid presses used to fire two overlapping actions with no sequencing,
  // so whichever settled LAST won: a slow failure could paint an error over a
  // launch that already succeeded, or a slow success could wipe a real one.
  it("ignores a second press while the first action is still in flight", async () => {
    let release: (() => void) | undefined;
    const onAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: "Connect" });

    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);

    // Once it settles the control is live again — this must not latch.
    await act(async () => {
      release?.();
    });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("keeps the error legible on a dark surface", () => {
    // The tile's control bar is navy. text-destructive (#C81E1E) on #14202F is
    // ~2.5:1 and fails AA, so the dark surface uses the blaze token instead.
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        surface="dark"
        error="Could not fetch credentials. Try again."
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

  it("keeps a disabled control legible on a dark surface", () => {
    // Spec §7's third obligation. The tile's control bar is navy and its
    // Connect is teal, so the Button base's `disabled:opacity-50` renders teal
    // at 50% over ink at 50% — roughly 2:1, unreadable. The dark surface mutes
    // the fill and keeps the label light instead.
    render(
      <PropertyActionButton
        label="Connect"
        tone="teal"
        surface="dark"
        unavailableReason="No property on this call"
        onAction={vi.fn()}
      />,
    );
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).not.toContain("disabled:opacity-50");
    expect(cls).toContain("disabled:opacity-100");
    expect(cls).toContain("disabled:bg-accent/25");
    expect(cls).toContain("disabled:text-primary-foreground/70");
  });

  it("leaves the light-surface disabled treatment on the base", () => {
    // Only the dark surface needs the override; cards are teal/navy on white,
    // where opacity dimming reads fine.
    render(
      <PropertyActionButton label="Kiosk" unavailableReason="Kiosk offline" onAction={vi.fn()} />,
    );
    const cls = screen.getByRole("button", { name: "Kiosk" }).className;
    expect(cls).toContain("disabled:opacity-50");
    expect(cls).not.toContain("disabled:opacity-100");
  });

  it("does not apply the dark disabled recipe to an enabled control", () => {
    render(
      <PropertyActionButton label="Connect" tone="teal" surface="dark" onAction={vi.fn()} />,
    );
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).not.toContain("disabled:bg-accent/25");
    expect(cls).toContain("bg-accent");
  });

  it("defaults to the card scale", () => {
    // Spec §3.6a/D15: all four card actions are h-8. The size union excludes
    // the base's h-9 `default` so a caller cannot reintroduce the mismatch.
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" }).className).toContain("h-8");
  });

  it("offers the tile's smaller scale as a size, not a className fight", () => {
    // CORRECTIONS §9: the tile Connect must stay small in the Document-PiP
    // window. `className` provably cannot deliver that — the sm variant's
    // `has-[>svg]:px-2.5` and `[&_svg:not([class*='size-'])]:size-4` survive
    // twMerge alongside a caller's plain `px-2`, and their compiled selectors
    // outrank it, so padding and icon size would silently stay at card scale.
    render(<PropertyActionButton label="Connect" tone="teal" size="xs" onAction={vi.fn()} />);
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).toContain("h-6");
    expect(cls).toContain("text-xs");
    expect(cls).toContain("has-[>svg]:px-1.5");
    expect(cls).toContain("[&_svg:not([class*='size-'])]:size-3");
    expect(cls).not.toContain("h-8");
    expect(cls).not.toContain("has-[>svg]:px-2.5");
    expect(cls).not.toContain("[&_svg:not([class*='size-'])]:size-4");
  });

  it("lets a caller's className win over the default sizing", () => {
    // cn() merges caller-last, so twMerge drops the height and type scale
    // rather than fighting them. (Horizontal padding and icon size are NOT
    // overridable this way — that is what `size` exists for.)
    render(
      <PropertyActionButton
        label="Connect"
        tone="teal"
        onAction={vi.fn()}
        className="h-auto py-1 text-xs"
      />,
    );
    const cls = screen.getByRole("button", { name: "Connect" }).className;
    expect(cls).toContain("h-auto");
    expect(cls).toContain("text-xs");
    expect(cls).not.toContain("h-8");
    expect(cls).not.toContain("text-sm");
  });

  it("lets a caller's className win over classes this component itself sets", () => {
    // The sizing test above is satisfied by button.tsx alone, since its cva
    // appends className after the size variant. This one overrides two classes
    // contributed HERE — `whitespace-nowrap` and the gated fill alpha — so it
    // pins this component's own merge order.
    //
    // Asserted on TOKENS, not substrings: `cls.toContain("bg-primary/70")`
    // matches inside `hover:bg-primary/70` and would have made the negative
    // assertion unfalsifiable.
    gate.gated = true;
    render(
      <PropertyActionButton
        label="Connect"
        onAction={vi.fn()}
        className="whitespace-normal bg-live"
      />,
    );
    const classes = screen.getByRole("button", { name: "Connect" }).className.split(/\s+/);
    expect(classes).toContain("whitespace-normal");
    expect(classes).toContain("bg-live");
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).not.toContain("bg-primary/70");
    // And the trap worth knowing about: twMerge treats `hover:bg-*` as a
    // separate group from bare `bg-*`, so a caller overriding the fill does NOT
    // displace the hover pin — the control would revert to the gated alpha on
    // hover. Pinned, not fixed: the gated hover is meant to hold its recessed
    // fill, and no caller overrides it today.
    expect(classes).toContain("hover:bg-primary/70");
  });

  it("treats an empty unavailable reason as available", () => {
    // `!= null` would disable the control with an empty tooltip and no
    // explanation on either the button or the wrapper.
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" unavailableReason="" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: "Connect" });
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("composes with the real guard when neither provider is mounted", () => {
    // Every other test here mocks useDutyGuard, so nothing else proves the two
    // compose. call-tile-manager.test.tsx mounts PropertyCard with no
    // DutyProvider and no OffDutyPromptProvider and drives eight Answer flows
    // through it; that pass-through is what keeps those green once Task 14
    // rewires the card onto this button.
    //
    // `gated` is left true deliberately: the real hook must ignore it (no
    // DutyProvider means nothing to gate), so the action running is proof the
    // mock is genuinely out of the way rather than quietly still in play.
    gate.real = true;
    gate.gated = true;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: "Connect" });
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.className).not.toContain("bg-primary/70");
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
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
