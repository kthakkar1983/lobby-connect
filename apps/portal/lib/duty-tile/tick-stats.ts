// Gate 3.0 prototype (stack-consolidation migration plan, Phase 3): the parent
// tab runs a 1s heartbeat while the Document-PiP tile is open. These pure
// helpers accumulate the observed gaps so the tile can display live proof that
// Chrome is (or is not) throttling the tab's timers behind the PiP exemption.

export interface TickStats {
  readonly count: number;
  readonly lastTickAt: number | null;
  readonly lastGapMs: number | null;
  readonly maxGapMs: number | null;
}

export const INITIAL_TICK_STATS: TickStats = {
  count: 0,
  lastTickAt: null,
  lastGapMs: null,
  maxGapMs: null,
};

export function recordTick(stats: TickStats, nowMs: number): TickStats {
  if (stats.lastTickAt === null) {
    return { count: 1, lastTickAt: nowMs, lastGapMs: null, maxGapMs: null };
  }
  const gap = nowMs - stats.lastTickAt;
  return {
    count: stats.count + 1,
    lastTickAt: nowMs,
    lastGapMs: gap,
    maxGapMs: stats.maxGapMs === null ? gap : Math.max(stats.maxGapMs, gap),
  };
}

export type GapClass = "ok" | "degraded" | "throttled";

// A 1s interval in a healthy tab fires within ~1–2s even under load. Chrome's
// background throttling clamps hidden tabs to 1 wake/s, and *intensive*
// throttling (after 5 min hidden) to 1 wake/min — so a gap ≥10s can only mean
// the exemption failed.
export function classifyGap(gapMs: number | null): GapClass {
  if (gapMs === null || gapMs < 2_500) return "ok";
  if (gapMs < 10_000) return "degraded";
  return "throttled";
}

export function formatGap(gapMs: number | null): string {
  if (gapMs === null) return "—";
  return `${(gapMs / 1_000).toFixed(1)}s`;
}
