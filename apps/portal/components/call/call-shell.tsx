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
 * The audio/video differences that Kumar called DELIBERATE are props here, so
 * they stop diverging by accident:
 *   - `split`     — the body ratio (see the ⚠ below; it is easy to read backwards)
 *   - `stage`     — video shows guest video; audio shows a call card instead
 *   - `emergency` — 911 is AUDIO ONLY. Video has no 911 machinery anywhere in
 *                   the codebase (video-call.tsx omits `triggerEmergency` when
 *                   registering tile controls). Absent here means absent, not
 *                   forgotten.
 */

/**
 * ⚠ READ THE DIRECTION. These are `stage` (LEFT) / `panel` (RIGHT) basis
 * classes, and the RIGHT-hand panel — the playbook side — is the LARGER of the
 * two on both surfaces. A ratio quoted as "70/30" in the spec means 70% to the
 * PLAYBOOK, not to the stage.
 *
 * Today: audio 37/63, video 40/60 — both preserved exactly by the extraction.
 * Task 12 moves audio to 30/70 (spec §4, D9) by editing this map alone.
 */
const SPLITS = {
  "37/63": { stage: "basis-[37%]", panel: "basis-[63%]" },
  "40/60": { stage: "basis-2/5", panel: "basis-3/5" },
} as const;

export type CallSplit = keyof typeof SPLITS;

export function CallShell({
  title,
  emergency,
  bannersAboveBody,
  split,
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
  readonly split: CallSplit;
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
  const basis = SPLITS[split];

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
