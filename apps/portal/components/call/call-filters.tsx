import Link from "next/link";
import type { Route } from "next";
import type { CallChannel } from "@lc/shared";
import { buildCallsHref, type Outcome } from "@/lib/calls/filters";
import { cn } from "@/lib/utils";

type PillProps = { readonly href: string; readonly label: string; readonly active: boolean; readonly dot?: string };

function Pill({ href, label, active, dot }: PillProps) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "border-accent bg-accent/10 text-accent-text" : "border-border text-text-muted hover:text-foreground",
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" /> : null}
      {label}
    </Link>
  );
}

const LABEL = "font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted";

export function CallFilters({
  basePath,
  properties,
  activeProperty,
  activeChannel,
  activeOutcome,
}: {
  readonly basePath: string;
  readonly properties: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly activeProperty: string | null;
  readonly activeChannel: CallChannel | null;
  readonly activeOutcome: Outcome | null;
}) {
  // Each pill keeps the other active filters and drops the cursor (new filter → newest page).
  const href = (over: { property?: string | null; channel?: CallChannel | null; outcome?: Outcome | null }) =>
    buildCallsHref(basePath, {
      property: "property" in over ? over.property : activeProperty,
      channel: "channel" in over ? over.channel : activeChannel,
      outcome: "outcome" in over ? over.outcome : activeOutcome,
    });

  return (
    <div className="flex flex-col gap-2">
      {properties.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>Hotel</span>
          <Pill href={href({ property: null })} label="All" active={!activeProperty} />
          {properties.map((p) => (
            <Pill key={p.id} href={href({ property: p.id })} label={p.name} active={activeProperty === p.id} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Channel</span>
        <Pill href={href({ channel: null })} label="All" active={!activeChannel} />
        <Pill href={href({ channel: "AUDIO" })} label="Phone" active={activeChannel === "AUDIO"} />
        <Pill href={href({ channel: "VIDEO" })} label="Video" active={activeChannel === "VIDEO"} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Outcome</span>
        <Pill href={href({ outcome: null })} label="All" active={!activeOutcome} />
        <Pill href={href({ outcome: "answered" })} label="Answered" active={activeOutcome === "answered"} dot="bg-live" />
        <Pill href={href({ outcome: "missed" })} label="Missed" active={activeOutcome === "missed"} dot="bg-attention" />
        <Pill href={href({ outcome: "failed" })} label="Failed" active={activeOutcome === "failed"} dot="bg-muted-foreground" />
      </div>
    </div>
  );
}
