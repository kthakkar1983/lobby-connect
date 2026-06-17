import { cn } from "@/lib/utils";
import type { HourBucket } from "@/lib/dashboard/calls";

/**
 * Shared channel visualisations for the dashboards (spec §5): phone/video split
 * always shown with a legend. teal = phone/AUDIO (`bg-accent`), navy = video/VIDEO
 * (`bg-primary`). Both are pure presentational components driven by the §6 helpers.
 */

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function ChannelLegend({ className }: { readonly className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-[11px] text-text-muted", className)}>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-[2px] bg-accent" aria-hidden="true" />
        Phone
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-[2px] bg-primary" aria-hidden="true" />
        Video
      </span>
    </div>
  );
}

/**
 * Stacked phone/video volume by hour of day (24 buckets from `hourlyVolume`).
 * Heights scale to the busiest hour; empty hours render as baseline whitespace.
 */
export function HourlyVolumeChart({
  data,
  className,
}: {
  readonly data: ReadonlyArray<HourBucket>;
  readonly className?: string;
}) {
  const max = Math.max(1, ...data.map((b) => b.audio + b.video));

  return (
    <div className={className}>
      <div className="flex h-28 items-stretch gap-[3px]" role="img" aria-label="Calls by hour, phone and video">
        {data.map((b) => {
          const total = b.audio + b.video;
          return (
            // `h-full` gives each column a definite height so the bar's percentage
            // height resolves (with `items-end`/auto-height columns the bars
            // collapse to 0 and nothing renders); `justify-end` bottom-aligns them.
            <div
              key={b.hour}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${hourLabel(b.hour)}: ${b.audio} phone, ${b.video} video`}
            >
              {total > 0 && (
                <div
                  className="flex flex-col overflow-hidden rounded-[2px]"
                  style={{ height: `${(total / max) * 100}%` }}
                >
                  <div className="bg-primary" style={{ flexGrow: b.video }} />
                  <div className="bg-accent" style={{ flexGrow: b.audio }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-muted">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  );
}

/**
 * Thin horizontal phone/video split bar for per-property / pod rows. Renders a
 * muted track when there are no calls.
 */
export function ChannelBar({
  audio,
  video,
  className,
}: {
  readonly audio: number;
  readonly video: number;
  readonly className?: string;
}) {
  const total = audio + video;
  return (
    <div className={cn("flex h-2 overflow-hidden rounded-full bg-muted", className)}>
      {total > 0 && (
        <>
          <div className="bg-accent" style={{ flexGrow: audio }} aria-hidden="true" />
          <div className="bg-primary" style={{ flexGrow: video }} aria-hidden="true" />
        </>
      )}
    </div>
  );
}
