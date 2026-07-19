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
 * control bar is navy. Two things key off it, both contrast:
 *
 *   - THE ERROR COLOUR. `text-destructive` (#C81E1E) reads at ~2.5:1 on the
 *     tile's navy and fails AA, so a dark surface carries its error in blaze.
 *   - THE DISABLED TREATMENT (spec §7's third fix). The Button base dims a
 *     disabled control with `disabled:opacity-50`, which on navy leaves teal at
 *     50% over ink at 50% and drops the label to roughly 2:1. A dark surface
 *     mutes the FILL instead and keeps the label light: still unmistakably
 *     unavailable, still readable. Light surfaces keep the base treatment.
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

import { Button } from "@/components/ui/button";
import { useDutyGuard } from "@/components/dashboard/off-duty-prompt";
import { cn } from "@/lib/utils";

export type PropertyActionButtonProps = {
  readonly label: string;
  /** May be async; the guard withholds the call entirely when off duty. */
  readonly onAction: () => void;
  /** Already-rendered icon element (RSC client-boundary safety). */
  readonly icon?: React.ReactNode;
  /** Non-duty unavailability. Present => genuinely disabled, reason in `title`. */
  readonly unavailableReason?: string | null;
  /** Label while unavailable. Defaults to `label`. */
  readonly unavailableLabel?: string;
  /** Inline failure message rendered under the button. */
  readonly error?: string | null;
  /** Button fill. Teal for the in-call surfaces; navy (default) for cards. */
  readonly tone?: "navy" | "teal";
  /** What the control sits on — drives the error colour and the disabled treatment. */
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
  tone = "navy",
  surface = "light",
  size = "sm",
  hideLabel = false,
  className,
  wrapperClassName,
}: PropertyActionButtonProps) {
  const { gated, guard } = useDutyGuard();
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

  return (
    <div
      className={cn("flex flex-col gap-1", wrapperClassName)}
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
        onClick={() => guard(onAction)}
        className={cn(
          // A label swap must not make the control taller (spec §3.6a, §5.3).
          // Width is NOT covered — `unavailableLabel` deliberately swaps
          // `Kiosk` for `Kiosk offline`, which widens the button; fixed widths
          // are the call site's job. The Button base sets this too; restated so
          // the guarantee is this component's, not a base-class detail a
          // refactor could drop.
          "whitespace-nowrap",
          // Duty gating reads as unavailable without BEING unavailable: the
          // control stays live so the click can be intercepted.
          gated && !unavailable && "opacity-60",
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
          )}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
