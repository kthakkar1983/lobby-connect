import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import { cn } from "@/lib/utils";

type Tone = "default" | "live" | "attention" | "destructive";

/**
 * A top-level dashboard stat card (agent stat row, admin pulse row). White card
 * so it reads as a distinct tile on the page surface — unlike `StatTile`
 * (`bg-background`), which is for sub-tiles *inside* a white card (e.g. an
 * outcomes strip), where a white tile would nest cards.
 *
 * Pass `href` to make the whole tile a drill-in link (teal hover + chevron
 * affordance + focus ring). Without it the tile is a plain, non-interactive div.
 */
export function DashTile({
  value,
  label,
  sub,
  tone = "default",
  href,
}: {
  readonly value: string | number;
  readonly label: string;
  readonly sub?: string;
  readonly tone?: Tone;
  readonly href?: Route;
}) {
  const valueColor =
    tone === "live"
      ? "text-live-foreground"
      : tone === "attention"
        ? "text-attention-text"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";

  const body = (
    <div className="min-w-0 flex-1">
      <div className={cn("font-mono text-2xl font-semibold leading-tight", valueColor)}>{value}</div>
      <div className="mt-0.5 font-label text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div> : null}
    </div>
  );

  const base = "flex-1 rounded-card border border-border bg-card px-4 py-3 shadow-md";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "group flex items-center gap-2 transition-[border-color,box-shadow] duration-150",
          "hover:border-accent hover:shadow-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {body}
        <ChevronRight
          className="size-4 shrink-0 text-text-muted transition-colors group-hover:text-accent-text"
          aria-hidden="true"
        />
      </Link>
    );
  }

  return <div className={base}>{body}</div>;
}
