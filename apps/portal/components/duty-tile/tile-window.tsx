"use client";

// The deskphone tile UI — rendered via createPortal into the Document-PiP
// window's body (which `preparePipDocument` styled `bg-primary`). Everything
// here is Gate 3.0 prototype content: the pod list is demo data and the ring
// is self-scheduled; no call/softphone/realtime integration on purpose.

import {
  classifyGap,
  formatGap,
  type GapClass,
  type TickStats,
} from "@/lib/duty-tile/tick-stats";

const GAP_PILL: Record<GapClass, string> = {
  ok: "bg-live/15 text-live",
  degraded: "bg-attention/20 text-attention",
  throttled: "bg-destructive text-destructive-foreground",
};

const DEMO_POD = [
  { name: "The Sample Hotel", note: "quiet" },
  { name: "Rosewood Inn", note: "quiet" },
  { name: "Hilltop Suites", note: "quiet" },
];

interface TileWindowProps {
  agentName: string;
  stats: TickStats;
  parentHidden: boolean;
  pendingDueAt: number | null;
  ringing: { startedAt: number; lateMs: number } | null;
  lastResult: string | null;
  tileSize: { w: number; h: number } | null;
  onScheduleRing: (seconds: number) => void;
  onCancelPending: () => void;
  onAnswer: () => void;
  onDismiss: () => void;
  onOffDuty: () => void;
}

export function TileWindow({
  agentName,
  stats,
  parentHidden,
  pendingDueAt,
  ringing,
  lastResult,
  tileSize,
  onScheduleRing,
  onCancelPending,
  onAnswer,
  onDismiss,
  onOffDuty,
}: TileWindowProps) {
  // The parent's 1s heartbeat re-renders this tree, so wall-clock reads stay
  // fresh — and a frozen clock is itself visible proof of a throttled tab.
  const now = Date.now();

  if (ringing) {
    const ringingFor = Math.max(0, Math.floor((now - ringing.startedAt) / 1_000));
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-attention p-4 font-sans text-ink">
        <div className="animate-pulse text-center">
          <p className="font-label text-xs font-semibold uppercase tracking-[0.2em]">
            Incoming call
          </p>
          <p className="mt-1 font-display text-2xl font-bold">The Sample Hotel</p>
          <p className="text-sm">Phone · ringing {ringingFor}s</p>
        </div>
        <div className="flex w-full max-w-64 flex-col gap-2">
          <button
            type="button"
            onClick={onAnswer}
            className="w-full rounded-lg bg-live px-4 py-3 text-base font-semibold text-ink shadow-sm hover:bg-live/90"
          >
            Answer
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-lg bg-ink/10 px-4 py-2 text-sm font-medium hover:bg-ink/20"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const gapClass = classifyGap(stats.maxGapMs);
  const countdown =
    pendingDueAt !== null ? Math.max(0, Math.ceil((pendingDueAt - now) / 1_000)) : null;

  return (
    <div className="flex min-h-dvh flex-col gap-3 overflow-y-auto bg-primary p-3 font-sans text-primary-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/60">
          Lobby Connect
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="size-2 rounded-full bg-live" aria-hidden />
          Line ready
        </span>
      </div>

      <div>
        <p className="font-display text-4xl font-semibold tabular-nums">
          {new Date(now).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
        <p className="text-xs text-primary-foreground/60">{agentName} · on duty</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-primary-foreground/70">
        <span>tab {parentHidden ? "hidden" : "visible"}</span>
        <span>· tick {formatGap(stats.lastGapMs)}</span>
        <span>· max {formatGap(stats.maxGapMs)}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${GAP_PILL[gapClass]}`}>
          {gapClass}
        </span>
      </div>

      <div className="rounded-lg bg-primary-foreground/5 p-2">
        <p className="mb-1 font-label text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/50">
          Pod (demo data)
        </p>
        <ul className="space-y-1">
          {DEMO_POD.map((p) => (
            <li key={p.name} className="flex items-center justify-between text-xs">
              <span>{p.name}</span>
              <span className="flex items-center gap-1 text-primary-foreground/50">
                <span className="size-1.5 rounded-full bg-live/70" aria-hidden />
                {p.note}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg bg-primary-foreground/5 p-2">
        <p className="mb-1.5 font-label text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/50">
          Test ring
        </p>
        {countdown !== null ? (
          <div className="flex items-center justify-between text-xs">
            <span>
              Rings in <span className="font-semibold tabular-nums">{countdown}s</span> — go
              fullscreen somewhere
            </span>
            <button
              type="button"
              onClick={onCancelPending}
              className="rounded px-2 py-1 text-primary-foreground/60 hover:bg-primary-foreground/10"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            {[
              { label: "15s", seconds: 15 },
              { label: "60s", seconds: 60 },
              { label: "6 min", seconds: 360 },
            ].map((o) => (
              <button
                key={o.seconds}
                type="button"
                onClick={() => onScheduleRing(o.seconds)}
                className="flex-1 rounded-md border border-primary-foreground/20 px-2 py-1.5 text-xs font-medium hover:bg-primary-foreground/10"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {lastResult ? (
        <p className="text-xs text-primary-foreground/70">Last ring: {lastResult}</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between text-[10px] text-primary-foreground/40">
        <span>{tileSize ? `${tileSize.w}×${tileSize.h}` : ""}</span>
        <button
          type="button"
          onClick={onOffDuty}
          className="rounded px-2 py-1 hover:bg-primary-foreground/10 hover:text-primary-foreground/70"
        >
          Go off duty
        </button>
      </div>
    </div>
  );
}
