import { cn } from "@/lib/utils";

type Tone = "default" | "live" | "attention" | "destructive";

/**
 * A top-level dashboard stat card (agent stat row, admin pulse row). White card
 * so it reads as a distinct tile on the page surface — unlike `StatTile`
 * (`bg-background`), which is for sub-tiles *inside* a white card (e.g. an
 * outcomes strip), where a white tile would nest cards.
 */
export function DashTile({
  value,
  label,
  sub,
  tone = "default",
}: {
  readonly value: string | number;
  readonly label: string;
  readonly sub?: string;
  readonly tone?: Tone;
}) {
  const valueColor =
    tone === "live"
      ? "text-live-foreground"
      : tone === "attention"
        ? "text-attention-text"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="flex-1 rounded-card border border-border bg-card px-4 py-3 shadow-md">
      <div className={cn("font-mono text-2xl font-semibold leading-tight", valueColor)}>{value}</div>
      <div className="mt-0.5 font-label text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div> : null}
    </div>
  );
}
