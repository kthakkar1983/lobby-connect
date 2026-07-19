"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the two in-call surfaces — the audio overlay
 * (components/softphone/audio-call-overlay.tsx) and the video overlay
 * (components/video-call/video-call.tsx). Both files carried a SHARED-CHROME
 * SEAM comment predicting this extraction, and they had already drifted
 * (37/63 vs 40/60). Spec §4.
 *
 * The shell owns the frame: the full-screen root, the header strip with its
 * live beacon, the body split, and the control-bar chrome. It owns NO call
 * behaviour — every handler stays in its overlay.
 *
 * Two of the audio/video differences Kumar called DELIBERATE are props here, so
 * they stop diverging by accident:
 *   - `playbookBasis` — the body ratio, named by the PLAYBOOK's width
 *   - `emergency`     — 911 is AUDIO ONLY. Video has no 911 machinery anywhere
 *                       in the codebase (video-call.tsx omits `triggerEmergency`
 *                       when registering tile controls). Absent here means
 *                       absent, not forgotten.
 *
 * The third difference — video shows a guest video feed where audio shows a
 * call card — is NOT expressed as a prop and deliberately so: `stage` is an
 * opaque render function and this shell cannot tell the two apart. Audio
 * genuinely needs a left panel too, so a nullable stage would have been worse.
 * That difference stays CALLER-OWNED. Do not describe it as enforced here.
 */

/**
 * Body ratio, keyed by the PLAYBOOK's share — the right-hand panel, and the
 * LARGER half on both surfaces.
 *
 * Naming this by the playbook (rather than a bare "37/63") is deliberate: the
 * plan documented the direction backwards, and a reviewer demonstrated that
 * swapping `stage` and `panel` here left the entire suite green. Two things now
 * stop that: these keys read in the same direction as spec §4's table, and
 * tests/components/call-shell.test.tsx pins the mapping.
 *
 * Today: audio playbook 63%, video playbook 60% — both preserved exactly by the
 * Task 11 extraction. Task 12 widens audio's playbook to 70% (spec §4, D9),
 * which takes TWO edits: add a "70%" entry here AND change the
 * `playbookBasis` passed at audio-call-overlay.tsx's call site.
 */
const SPLITS = {
  "63%": { stage: "basis-[37%]", panel: "basis-[63%]" },
  "60%": { stage: "basis-2/5", panel: "basis-3/5" },
} as const;

export type PlaybookBasis = keyof typeof SPLITS;

export function CallShell({
  title,
  emergency,
  bannersAboveBody,
  playbookBasis,
  stage,
  panel,
  bannersBelowBody,
  controls,
  controlBarClassName,
}: {
  /** Header text after the live beacon, e.g. "On call · The Sample Hotel". */
  readonly title: ReactNode;
  /**
   * Header top-right. AUDIO ONLY — this is the 911 control, and it is a live
   * path even while the call tile is up (the overlay's `collapsed` state hides
   * the call card and caption band, never the header). When DocPiP is
   * unsupported or the agent closed the tile, this is the ONLY 911.
   */
  readonly emergency?: ReactNode;
  /**
   * Banners between the header and the body: audio's emergency-active and
   * emergency-failed strips (which carry the instruction to relay the property
   * address), video's audio-blocked and media-warning strips.
   */
  readonly bannersAboveBody?: ReactNode;
  /** The PLAYBOOK's share of the body (the right-hand panel). See SPLITS. */
  readonly playbookBasis: PlaybookBasis;
  /**
   * Left panel, rendered by the caller with the basis this shell hands it.
   * The caller keeps ownership of its own test id, its collapsed handling and
   * its contents — the two stages have nothing else in common.
   */
  readonly stage: (basis: string) => ReactNode;
  /**
   * Right panel — the caller's FULLY RENDERED playbook side, not a bare
   * playbook. Audio passes the basis into <PlaybookPanel>; video wraps a
   * Playbook/Chat tab panel and replaces it wholesale when collapsed.
   */
  readonly panel: (basis: string) => ReactNode;
  /**
   * Banners between the body and the control bar — a structurally different
   * position from `bannersAboveBody`. Audio's caption band and video's
   * notes-save Retry/Discard affordance live here.
   */
  readonly bannersBelowBody?: ReactNode;
  readonly controls: ReactNode;
  /**
   * Per-surface control-bar arrangement. The chrome (border, background,
   * padding) is shared; the two bars lay their contents out differently today
   * — audio `justify-between gap-3`, video `gap-2`. Task 12 converges them.
   */
  readonly controlBarClassName?: string;
}) {
  const basis = SPLITS[playbookBasis];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header strip — live beacon + property; emergency (audio) top-right. */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          {title}
        </span>
        {emergency ? <span className="flex items-center gap-2">{emergency}</span> : null}
      </div>

      {bannersAboveBody}

      <div className="flex flex-1 overflow-hidden">
        {stage(basis.stage)}
        {panel(basis.panel)}
      </div>

      {bannersBelowBody}

      <div className={cn("flex items-center border-t border-border bg-card p-3", controlBarClassName)}>
        {controls}
      </div>
    </div>
  );
}
