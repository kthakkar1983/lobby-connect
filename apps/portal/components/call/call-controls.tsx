"use client";

/**
 * The shared vocabulary of the in-call control bar, consumed by the audio
 * overlay (components/softphone/audio-call-overlay.tsx) and the video overlay
 * (components/video-call/video-call.tsx). Spec §5.
 *
 * <CallShell> owns the bar's chrome (border, background, padding, gap); this
 * file owns what goes IN it. Both existed as hand-rolled <button> elements in
 * two files that had already drifted — different heights, different type
 * scales, different orders — which is the drift §4 exists to stop. Anything
 * that appears on BOTH bars belongs here, so a change lands once.
 *
 * TWO THINGS THIS FILE GUARANTEES:
 *
 *   1. NOTHING REFLOWS WHEN A STATE CHANGES. Every control here is fixed-width
 *      and fixed-height, and no label varies with state. The bar used to move
 *      under the agent's cursor mid-call every time she muted (`Mute` ->
 *      `Unmute`) or cut her camera (`Cam off` -> `Cam on`). Spec §5.3 — the
 *      same convention as §3.6a/§3.6b on the property cards.
 *   2. THE TERMINATING CONTROL READS IDENTICALLY ON BOTH SURFACES. `End call`,
 *      sentence case, one definition (D11). Its per-surface FILL is the single
 *      deliberate difference and it is an explicit prop — see <EndCallButton>.
 *
 * Widths are in rem, never px. The portal scales its root font to 112.5% at
 * `lg` (globals.css), so a px width silently stops matching its own label at
 * the breakpoint where most agents actually work.
 */

import { PhoneOff } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The call-adjusting controls — mute, camera, captions — grouped in one
 * recessed tray, visually separate from the controls that LEAVE or END the call
 * (spec §5.4). Connect in particular hands off to RustDesk and is a
 * categorically different action from a mic toggle.
 */
export function CallControlTray({ children }: { readonly children: ReactNode }) {
  return (
    <div className="ml-auto flex items-center gap-2 rounded-[calc(var(--radius-button)+4px)] bg-background p-1">
      {children}
    </div>
  );
}

/** Separates the tray from Connect / End call. Spec §5.4. */
export function CallControlDivider() {
  return <div aria-hidden="true" className="mx-1 w-px self-stretch bg-border" />;
}

/**
 * A tray toggle — `Mute` on both surfaces, `Camera` on video. The label is
 * FIXED and the state is carried by the fill plus the icon, so the control
 * cannot change width when the agent presses it (spec §5.3).
 *
 * The fill recipe is <CaptionToggle>'s, deliberately: captions already sit in
 * this tray, and one visual language for "this toggle is engaged" beats three.
 * Unpressed is transparent-on-tray to match it exactly.
 *
 * ⚠ `pressed` means SUPPRESSION IS ENGAGED on both controls — mic muted, camera
 * off — never "the device is live". The polarity is uniform on purpose: two
 * toggles sitting side by side in one tray that highlighted for opposite
 * reasons would be worse than either convention alone. Because "pressed" on a
 * control labelled `Camera` is genuinely ambiguous to a screen-reader user,
 * `title` states the action the click performs in words, the way
 * <CaptionToggle> already does.
 *
 * The label owes 4.5:1 (WCAG 1.4.3) in BOTH states: this control is enabled, so
 * the inactive-component exemption never applies to it. `text-text-muted` is
 * 5.5:1 on the page background and `text-accent-text` is the AA-on-white deep
 * teal — neither state dims the element, only the fill.
 */
export function CallToggleButton({
  label,
  icon,
  pressed,
  title,
  onToggle,
  className,
}: {
  readonly label: string;
  /** Already-rendered icon element (RSC client-boundary safety). */
  readonly icon: ReactNode;
  /** True when the suppression is engaged (muted / camera off). */
  readonly pressed: boolean;
  /** What the next click will do, e.g. "Turn your camera on". */
  readonly title: string;
  readonly onToggle: () => void;
  readonly className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      title={title}
      onClick={onToggle}
      className={cn(
        "w-28 justify-center border",
        pressed
          ? "border-accent bg-accent/10 text-accent-text hover:bg-accent/10 hover:text-accent-text"
          : "border-border text-text-muted",
        className,
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * The terminating control. One definition so the label, the icon and the scale
 * cannot drift apart again — video's used to be `text-[1.1875rem] font-bold`
 * with an 18px icon while every sibling was `text-sm`/16px, and audio's said
 * `Hang up` while video's said `End`.
 *
 * `tone` is the ONE difference, and it is deliberate:
 *
 *   - VIDEO is navy (`bg-primary`) — spec §5.2 / D11.
 *   - AUDIO is blaze (`bg-attention`), because red=911 was reading as the "end
 *     call" cue. That is an intentional override of "blaze = needs-attention,
 *     never a CTA" for this one control (punch-list B1, Kumar 2026-06-18;
 *     relabelled 2026-07-19). 911 stays red, top-right. Audio is the ONE
 *     surface where a red 911 button and the end-call button coexist, and this
 *     fill is the visual separation that decision bought — on the surface where
 *     a mistap has life-safety consequences. Do NOT "unify" it to navy.
 *
 * Making it a prop is what keeps that a decision instead of drift (spec §4).
 */
export function EndCallButton({
  tone,
  onEnd,
}: {
  readonly tone: "navy" | "blaze";
  readonly onEnd: () => void;
}) {
  return (
    <Button
      type="button"
      variant="neutral"
      size="sm"
      onClick={onEnd}
      className={cn(
        "font-semibold",
        tone === "blaze" && "bg-attention text-attention-foreground hover:bg-attention/90",
      )}
    >
      <PhoneOff aria-hidden="true" />
      End call
    </Button>
  );
}
