"use client";

import type { ReactNode } from "react";

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
 * Audio playbook 70%, video playbook 60% (spec §4, D9). Audio has no video to
 * show, so its call card genuinely needs less room than video's stage; the 63%
 * it shipped with was, in Kumar's words, "barely noticeable compared to 60-40".
 */
const SPLITS = {
  "70%": { stage: "basis-[30%]", panel: "basis-[70%]" },
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
  /**
   * The control bar's contents. Its chrome — border, background, padding and
   * gap — is owned here and is now IDENTICAL on both surfaces: Task 11 needed a
   * `controlBarClassName` escape hatch to keep the extraction a pure move
   * (audio laid out `justify-between gap-3`, video `gap-2`), and Task 12
   * converged them, so the hatch is gone. Both bars now read: inputs
   * (flex-1, right-packing the cluster), then Connect leading the cluster
   * (Mute · [Camera] · Captions), a divider, then End call as the far-right
   * bookend (spec §3.1, 2026-07-20 — the tray wrapper and its `ml-auto` push
   * were dropped). The shared vocabulary lives in components/call/call-controls.tsx.
   */
  readonly controls: ReactNode;
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

      <div className="flex items-center gap-3 border-t border-border bg-card p-3">{controls}</div>
    </div>
  );
}
