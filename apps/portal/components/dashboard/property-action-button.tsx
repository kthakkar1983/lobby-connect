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
 * control bar is navy, where `text-destructive` (#C81E1E) reads at ~2.5:1 and
 * fails AA — so the dark surface carries its error in blaze instead.
 *
 * SIZING. `size="sm"` (h-8) is the card scale, normalized per spec §3.6a/D15.
 * The tile's Connect is deliberately smaller because it lives in a Document-PiP
 * window; `className` is merged last so twMerge lets a caller drop the default
 * height and type scale rather than fight it.
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
  /** What the control sits on — drives the error colour only. */
  readonly surface?: "light" | "dark";
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
  hideLabel = false,
  className,
  wrapperClassName,
}: PropertyActionButtonProps) {
  const { gated, guard } = useDutyGuard();
  const unavailable = unavailableReason != null;
  const shown = unavailable ? (unavailableLabel ?? label) : label;

  return (
    <div
      className={cn("flex flex-col gap-1", wrapperClassName)}
      // The Button base carries `disabled:pointer-events-none`, so a title on a
      // disabled button never surfaces on hover. The wrapper is the hover
      // target that actually shows the reason.
      title={unavailableReason ?? undefined}
    >
      <Button
        type="button"
        variant={tone === "teal" ? "accent" : "neutral"}
        size="sm"
        disabled={unavailable}
        title={unavailableReason ?? undefined}
        onClick={() => guard(onAction)}
        className={cn(
          // A state or label change must not resize a control (spec §3.6a,
          // §5.3) — one convention, applied at every site. The Button base
          // already sets this; restated here so the guarantee is this
          // component's, not a base-class detail a refactor could drop.
          "whitespace-nowrap",
          // Duty gating reads as unavailable without BEING unavailable: the
          // control stays live so the click can be intercepted.
          gated && !unavailable && "opacity-60",
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
