"use client";

/**
 * One button for every gated action performed against a property (spec §7):
 * `Connect` (remote into the hotel PC) and `Kiosk` (outbound video to the
 * lobby) on the property cards, plus the three in-call `Connect`s on the audio
 * overlay, the video overlay and the call tile. Five hand-rolled copies
 * previously disagreed on colour, icon, duty gating and error surfacing.
 *
 * TWO KINDS OF UNAVAILABILITY, AND THEY MUST NEVER BE CONFLATED (spec §3.4):
 *
 *   - DUTY gating stays ENABLED and intercepts. A `disabled` button fires no
 *     click event, so it cannot be intercepted and cannot offer to start the
 *     shift; it is also low-contrast and gives touch users no feedback at all.
 *   - REAL unavailability — an offline kiosk, an in-flight request, a call with
 *     no property — stays GENUINELY `disabled` with the reason in `title`.
 *     Offering "start your shift" for an offline kiosk would be a lie: starting
 *     the shift would not make that button work.
 *
 * When both apply, real unavailability wins and no prompt is offered, for the
 * same reason.
 *
 * AND A THIRD CASE: `gate="none"`, for an action that is legitimate REGARDLESS
 * of duty. The three in-call Connects pass it. Remoting into the hotel PC during
 * a call that is already live and connected is not an off-duty action — the
 * guest is on the line whatever the shift row says, and it is the single action
 * the product exists to enable. Duty state CAN be revoked mid-call from outside
 * this tab: POST /api/presence/end-shift sets `status: "OFFLINE"` with no
 * ON_CALL guard, so pressing End shift in a SECOND dashboard tab (whose own
 * mid-call suppression sees no live call, because that state is per-tab) gates
 * the first tab within one heartbeat via markOffDuty(). Gating Connect there
 * would withhold it mid-guest-call; on the tile it would withhold it INVISIBLY,
 * since the prompt is an AlertDialog in the main document and the tile is used
 * precisely when that document is backgrounded behind RustDesk.
 *
 * PRESENTATION ONLY. The authoritative gates stay where they are —
 * softphone.tsx:587 (`if (!canWorkRef.current) return;`) and the server-side
 * D13 duty check. This must never become the only thing preventing an off-duty
 * action.
 *
 * TONE vs SURFACE are independent axes across the five sites, so they are two
 * props. `tone` is the button's fill: navy on the light property cards, teal on
 * all three in-call Connects (D13 keeps that split deliberately, and
 * call-tile.test.tsx:440-449 pins the tile's `bg-accent`). `surface` is what the
 * control sits ON: the cards and both overlays are light, but the tile's
 * control bar is navy. Three things key off it, all contrast:
 *
 *   - THE ERROR COLOUR. `text-destructive` (#C81E1E) reads at ~2.5:1 on the
 *     tile's navy and fails AA, so a dark surface carries its error in blaze.
 *   - THE DISABLED TREATMENT (spec §7's third fix). The Button base dims a
 *     disabled control with `disabled:opacity-50`, which on navy leaves teal at
 *     50% over ink at 50% and drops the label to roughly 2:1. A dark surface
 *     mutes the FILL instead and keeps the label light: still unmistakably
 *     unavailable, still readable. Light surfaces keep the base treatment.
 *   - THE DUTY-GATED TREATMENT. The same trap from the opposite direction: a
 *     gated control is deliberately ENABLED, so WCAG 1.4.3's inactive-component
 *     exemption does not cover it and dimming the element would strand its
 *     label below AA. Light surfaces mute the fill alpha; dark surfaces get no
 *     gated cue at all, deliberately — see `gatedFill` below for why that is
 *     the honest answer today.
 *
 * SIZING IS A PROP, NOT A `className` FIGHT. `size="sm"` (h-8) is the card
 * scale, normalized per spec §3.6a/D15; `size="xs"` (h-6, text-xs, 12px icon)
 * is the tile's, deliberately smaller because it lives in a Document-PiP
 * window. The union excludes the base's `default` (h-9) on purpose — that
 * height is the exact mismatch §3.6a/D15 normalized away.
 *
 * `className` is merged last and does win for height, type scale and colour,
 * but it CANNOT override horizontal padding or icon size: the size variants
 * carry `has-[>svg]:px-*` and `[&_svg:not([class*='size-'])]:size-*`, whose
 * compiled selectors (`:has(>svg)`, `:not([class*='size-'])`) outrank a plain
 * `px-2` or `[&_svg]:size-3` on specificity — and every Connect has an icon.
 * Pick the size; do not fight it.
 */

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { useDutyGuard } from "@/components/dashboard/off-duty-prompt";
import { cn } from "@/lib/utils";

export type PropertyActionButtonProps = {
  readonly label: string;
  /** May be async; the guard withholds the call entirely when off duty. */
  readonly onAction: () => void | Promise<void>;
  /** Already-rendered icon element (RSC client-boundary safety). */
  readonly icon?: React.ReactNode;
  /** Non-duty unavailability. Present => genuinely disabled, reason in `title`. */
  readonly unavailableReason?: string | null;
  /** Label while unavailable. Defaults to `label`. */
  readonly unavailableLabel?: string;
  /** Inline failure message rendered with the button. */
  readonly error?: string | null;
  /**
   * How `error` is laid out. `block` (default) is a flow sibling under the
   * button — right for the property cards, where the row is the card's own and
   * growing it costs nothing. `float` takes it OUT of flow entirely, for the
   * three in-call control bars, whose geometry must not change mid-call.
   */
  readonly errorPlacement?: "block" | "float";
  /**
   * Whether the duty guard applies. `none` is for actions that stay legitimate
   * off duty — see the THIRD CASE note in the header. Default gates.
   */
  readonly gate?: "duty" | "none";
  /** Button fill. Teal for the in-call surfaces; navy (default) for cards. */
  readonly tone?: "navy" | "teal";
  /** What the control sits on — drives the error colour, the disabled treatment and the gated one. */
  readonly surface?: "light" | "dark";
  /** Control scale. `sm` is the card scale; `xs` is the Document-PiP tile's. */
  readonly size?: "sm" | "xs";
  /** Icon-only: the label becomes the accessible name and nothing else. */
  readonly hideLabel?: boolean;
  /** Classes for the button. Merged last, so the caller wins. */
  readonly className?: string;
  /** Classes for the wrapper, which is the flex item once the error slot exists. */
  readonly wrapperClassName?: string;
};

export function PropertyActionButton({
  label,
  onAction,
  icon,
  unavailableReason,
  unavailableLabel,
  error,
  errorPlacement = "block",
  gate = "duty",
  tone = "navy",
  surface = "light",
  size = "sm",
  hideLabel = false,
  className,
  wrapperClassName,
}: PropertyActionButtonProps) {
  const { gated: dutyGated, guard: dutyGuard } = useDutyGuard();
  // `gate="none"` opts out of BOTH halves — the interception and the recessed
  // fill. A control that is never withheld must never look withheld.
  const gated = gate === "duty" && dutyGated;
  const guard = gate === "duty" ? dutyGuard : (run: () => void) => run();

  // Two rapid presses used to fire two overlapping `onAction`s with no
  // sequencing, so whichever settled LAST won: a slow failure could paint an
  // error over a launch that already succeeded, or a slow success could wipe a
  // real one. Ignoring a press while one is in flight is enough — no disabled
  // state, because the pre-warm cache makes the common path resolve instantly
  // and a button that flickers disabled mid-call is its own problem.
  const inFlightRef = useRef(false);
  async function runOnce() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await onAction();
    } finally {
      inFlightRef.current = false;
    }
  }
  // Truthiness, not `!= null`: an empty reason would otherwise disable the
  // control with an empty tooltip and no explanation anywhere. Matches how
  // `error` is consumed below.
  const unavailable = Boolean(unavailableReason);
  const shown = unavailable ? (unavailableLabel ?? label) : label;

  // Spec §7's third fix — see the SURFACE note in the header. Only applied when
  // the control is actually disabled, so an enabled dark button is untouched.
  const darkDisabled =
    unavailable && surface === "dark"
      ? cn(
          "disabled:opacity-100 disabled:text-primary-foreground/70",
          tone === "teal" ? "disabled:bg-accent/25" : "disabled:bg-primary-foreground/15",
        )
      : undefined;

  // Duty gating must READ as unavailable without BEING unavailable, and it must
  // do that by muting the FILL — never by dimming the element.
  //
  // Element opacity composites the label too. `opacity-60` on a white card puts
  // the navy fill at rgb(111,129,147) under a still-opaque white label: 4.01:1.
  // A DISABLED control is exempt from WCAG 1.4.3 ("inactive user interface
  // component"), but the entire point of the gate is that this control stays
  // ENABLED and operable, so the exemption does not apply and its 14px label
  // owes 4.5:1. Computed: bg-primary/70 -> 5.43:1, bg-accent/70 -> 7.89:1, both
  // still visibly recessed against the 14.03:1 / 5.60:1 full-strength states.
  // Same move the dark disabled treatment above makes, for the same reason.
  //
  // Hover is pinned to the gated alpha so hovering cannot restore the
  // full-strength fill and undo the signal; the cursor, focus ring and
  // active-press all still respond, because the control genuinely is live.
  //
  // LIGHT SURFACES ONLY, deliberately. On the tile's navy there is no honest
  // one-size treatment: bg-primary/70 composites straight back to navy (no cue
  // at all) and bg-accent/70 leaves the ink label at 3.65:1.
  //
  // No dark recipe is needed, and the reason is now structural rather than a
  // bet on reachability. The only dark-surface caller is the call tile, and it
  // passes `gate="none"` — its Connect is never gated, so there is no gated
  // state to render a cue for. An earlier version of this comment claimed the
  // state was unreachable because a shift cannot end mid-call; that was WRONG
  // (end-shift from a second tab has no ON_CALL guard — see the header), which
  // is exactly why the tile stopped relying on it.
  const gatedFill =
    gated && !unavailable && surface === "light"
      ? tone === "teal"
        ? "bg-accent/70 hover:bg-accent/70"
        : "bg-primary/70 hover:bg-primary/70"
      : undefined;

  return (
    <div
      // `relative` unconditionally: it is the positioning context a floated
      // error needs, and it changes nothing for a block one.
      className={cn("relative flex flex-col gap-1", wrapperClassName)}
      // The Button base carries `disabled:pointer-events-none`, so a title on a
      // disabled button never surfaces on hover. The wrapper is the hover
      // target that actually shows the reason.
      title={unavailableReason || undefined}
    >
      <Button
        type="button"
        variant={tone === "teal" ? "accent" : "neutral"}
        size={size}
        disabled={unavailable}
        title={unavailableReason || undefined}
        onClick={() => guard(() => void runOnce())}
        className={cn(
          // A label swap must not make the control taller (spec §3.6a, §5.3).
          // Width is NOT covered — `unavailableLabel` deliberately swaps
          // `Kiosk` for `Kiosk offline`, which widens the button; fixed widths
          // are the call site's job. The Button base sets this too; restated so
          // the guarantee is this component's, not a base-class detail a
          // refactor could drop.
          "whitespace-nowrap",
          gatedFill,
          darkDisabled,
          className,
        )}
      >
        {icon}
        {hideLabel ? <span className="sr-only">{shown}</span> : shown}
      </Button>
      {error ? (
        <p
          className={cn(
            "text-xs",
            surface === "dark" ? "text-attention" : "text-destructive",
            // FLOATED: out of flow, so rendering it cannot resize the row this
            // wrapper sits in. That row is a live call's control bar on all
            // three in-call surfaces, and it must not move under her hand — the
            // same invariant that fixed the widths of Mute, Camera and Captions
            // ("the control bar stops moving under her cursor mid-call"). In
            // flow it does move: on the overlays a one-line error grows the bar
            // by ~20px, lifting End call and Mute; in the tile's fixed 380x300
            // window the wrapper shrinks toward min-content, so the message
            // wraps to several lines and permanently eats a third of the guest's
            // video face, with no dismissal short of a successful retry.
            //
            // It floats ABOVE the button because every one of those bars is
            // page-bottom. Opaque background + shadow because it lands over
            // video; `max-w`/`line-clamp-2` + `title` bound the worst case to
            // two lines whatever the string.
            errorPlacement === "float" &&
              cn(
                "absolute bottom-full right-0 z-30 mb-1 line-clamp-2 max-w-64 rounded-button border px-2 py-1 shadow-md",
                surface === "dark" ? "border-primary-foreground/25 bg-primary" : "border-border bg-card",
              ),
          )}
          title={errorPlacement === "float" ? error : undefined}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
