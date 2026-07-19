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
 *   1. NOTHING REFLOWS WHEN A STATE CHANGES. No VISIBLE label here varies with
 *      state. The bar used to move under the agent's cursor mid-call every time
 *      she muted (`Mute` -> `Unmute`) or cut her camera (`Cam off` -> `Cam on`).
 *      Spec §5.3 — the same convention as §3.6a/§3.6b on the property cards.
 *      Precisely: the TOGGLES are additionally fixed-width (`w-28`), because
 *      their icon swaps between glyphs of different advance widths.
 *      <EndCallButton> is NOT width-constrained — it does not need to be, since
 *      its label is a constant. If a state-varying label is ever added to it,
 *      the constant-label guarantee is what breaks, and a width must come with
 *      it. (The Task-12 commit message overstated this as "every control has a
 *      fixed width"; only the toggles do.)
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
 * The call-adjusting controls — mute, camera, captions — grouped in one tray,
 * separate from the controls that LEAVE or END the call (spec §5.4). Connect in
 * particular hands off to RustDesk and is a categorically different action from
 * a mic toggle.
 *
 * ⚠ UNVERIFIED ON HARDWARE. The tray fill is `bg-background` (#F4F7F7) sitting
 * on the control bar's `bg-card` (#FFFFFF) — a 1.08:1 difference. The grouping
 * is definitely in the DOM (pinned below and in call-controls.test.tsx) but
 * whether it READS as a tray on a real monitor has not been looked at. Confirm
 * at smoke; the house lesson is that a visual outcome is verified by LOOKING,
 * never by reasoning ([[kiosk-css-animation-reverted]]).
 *
 * If it does not read, do NOT reach for `bg-muted` without re-running the
 * numbers: it darkens the tray enough to drop the UNPRESSED label
 * (`text-text-muted`) from 5.08:1 to 4.57:1, i.e. inside a rounding error of
 * failing 1.4.3. A hairline `border-border` adds separation and costs the label
 * contrast nothing — that is the cheaper direction.
 */
export function CallControlTray({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-testid="call-control-tray"
      className="ml-auto flex items-center gap-2 rounded-[calc(var(--radius-button)+4px)] bg-background p-1"
    >
      {children}
    </div>
  );
}

/** Separates the tray from Connect / End call. Spec §5.4. */
export function CallControlDivider() {
  return (
    <div
      aria-hidden="true"
      data-testid="call-control-divider"
      className="mx-1 w-px self-stretch bg-border"
    />
  );
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
 * reasons would be worse than either convention alone.
 *
 * THAT UNIFORMITY COSTS `Camera` ITS SEMANTICS, AND `stateLabel` PAYS IT BACK.
 * A screen reader announces the accessible name plus the pressed state, so
 * `Mute` + pressed reads "Mute, pressed" = muted, which is right — but `Camera`
 * + pressed reads "Camera, pressed" at exactly the moment the camera is OFF.
 * `title` does NOT rescue this: per the accessible-name computation, name-from-
 * content wins over the title attribute, so `title` never enters the name and
 * AT exposes it inconsistently (VoiceOver commonly drops it once content has
 * supplied a name). The only reliable announcement was the inverted one.
 * `stateLabel` composes an explicit accessible name, "Camera, camera is off".
 * Do NOT instead invert `pressed` to `!cameraOff` — that fixes the
 * announcement by breaking the visual polarity above.
 *
 * WHY aria-label RATHER THAN AN sr-only SPAN. The sr-only span was tried first
 * and MEASURED: name-from-content concatenates adjacent nodes with no
 * separator AND trims each one, so `{label}` + `<span> camera is off</span>`
 * computes to "Cameracamera is off" — a mangled announcement — no matter which
 * side the space is written on. aria-label is the only way to put a separator
 * in the name deterministically. It is composed FROM `label` here, so the
 * visible text and the accessible name cannot drift apart.
 *
 * `Mute` deliberately passes no `stateLabel`: "Mute, pressed" is already
 * unambiguous, and adding one would change its accessible name for no gain.
 * The asymmetry is the point — it tracks which name is ambiguous, not which
 * surface the control sits on.
 *
 * The visible label stays at the FRONT of the accessible name (WCAG 2.5.3 Label
 * in Name) so voice control still matches "click Camera", and the state is
 * never rendered, so it cannot reflow the bar.
 *
 * CONTRAST — the label owes 4.5:1 (WCAG 1.4.3) in BOTH states: this control is
 * ENABLED, so the inactive-component exemption never applies to it. Measured on
 * the surface it actually renders on, which is the tray, NOT white:
 *
 *   - unpressed `text-text-muted` on the tray's `bg-background`  = 5.08:1  PASS
 *   - pressed   `text-foreground` on `bg-accent/10` over the tray
 *     (the composite is #E0EFEF, not #FFFFFF)                    = 11.86:1 PASS
 *
 * `text-accent-text` shipped here first and failed on that composite (~3.81:1
 * against the then-current token) — under a comment that asserted it passed
 * because it is the AA-on-white deep teal. The token was later darkened (merge
 * 1ef6ee8, 2026-07-19) so it clears AA on white with more margin, but this
 * control does not render on white; on the tray composite the deep-teal text
 * token is still the wrong choice. State is carried by the border, the fill and
 * the icon, so nothing is lost by holding the label at full strength. Neither
 * state dims the ELEMENT — only the fill — per the standing lesson.
 */
export function CallToggleButton({
  label,
  icon,
  pressed,
  title,
  stateLabel,
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
  /**
   * Screen-reader-only state, e.g. "camera is off". Pass it whenever
   * `<label> + pressed` does not already read as the true state. Composed into
   * the accessible name as "<label>, <stateLabel>"; never rendered visibly, so
   * it cannot reflow the bar.
   */
  readonly stateLabel?: string;
  readonly onToggle: () => void;
  readonly className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      /* Kept prefixed by the VISIBLE label so WCAG 2.5.3 (Label in Name) holds
         and voice control still matches "click Camera". Absent when there is
         no state to disambiguate, so the name falls back to the content. */
      aria-label={stateLabel ? `${label}, ${stateLabel}` : undefined}
      title={title}
      onClick={onToggle}
      className={cn(
        "w-28 justify-center border",
        pressed
          ? "border-accent bg-accent/10 text-foreground hover:bg-accent/10 hover:text-foreground"
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
