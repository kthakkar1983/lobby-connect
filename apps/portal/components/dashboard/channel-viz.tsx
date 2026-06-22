import { cn } from "@/lib/utils";
import type { HourBucket } from "@/lib/dashboard/calls";
import { CHANNEL_COLOR } from "@/lib/dashboard/channel-colors";

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
      {(["AUDIO", "VIDEO"] as const).map((ch) => (
        <span key={ch} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-[2px]", CHANNEL_COLOR[ch].fill)} aria-hidden="true" />
          {CHANNEL_COLOR[ch].label}
        </span>
      ))}
    </div>
  );
}

/** The three grouped series for the hourly chart (brand mapping, spec §5 / punch-list B3).
 *  Channel colours come from the shared CHANNEL_COLOR source so the chart and the
 *  recent-calls channel icon always agree; "missed" is an outcome, not a channel. */
const HOURLY_SERIES = [
  { key: "audio", label: CHANNEL_COLOR.AUDIO.label, color: CHANNEL_COLOR.AUDIO.fill },
  { key: "video", label: CHANNEL_COLOR.VIDEO.label, color: CHANNEL_COLOR.VIDEO.fill },
  { key: "missed", label: "Missed", color: "bg-attention" },
] as const;

/** Legend for the 3-series hourly chart: Phone (teal) · Video (navy) · Missed (blaze). */
export function HourlyLegend({ className }: { readonly className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-[11px] text-text-muted", className)}>
      {HOURLY_SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-[2px]", s.color)} aria-hidden="true" />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Hourly call volume by hour of day (24 buckets from `hourlyVolume`), drawn as thin
 * rounded-top bars grouped side-by-side per hour — one per series (answered phone,
 * answered video, missed) — over light y-axis gridlines. Bars are `flex-1` so the row
 * stays inside its container (the chart also lives on the mobile owner portal); heights
 * scale to the busiest single bar of the night.
 */
export function HourlyVolumeChart({
  data,
  className,
}: {
  readonly data: ReadonlyArray<HourBucket>;
  readonly className?: string;
}) {
  const max = Math.max(1, ...data.flatMap((b) => [b.audio, b.video, b.missed]));

  return (
    <div className={className}>
      <div className="relative h-32">
        {/* Light horizontal gridlines (0 / ⅓ / ⅔ / baseline). Decorative. */}
        <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-border/60" />
          ))}
        </div>
        <div
          className="relative flex h-full items-end gap-[3px]"
          role="img"
          aria-label="Calls by hour: answered phone, answered video, and missed"
        >
          {data.map((b) => (
            <div
              key={b.hour}
              className="flex h-full flex-1 items-end justify-center gap-[2px]"
              title={`${hourLabel(b.hour)}: ${b.audio} phone, ${b.video} video, ${b.missed} missed`}
            >
              {HOURLY_SERIES.map((s) => {
                const v = b[s.key];
                return (
                  <div
                    key={s.key}
                    className={cn("max-w-[5px] flex-1 self-end rounded-t-[2px]", s.color)}
                    // `max(2px, …)` keeps a non-zero count visible even when tiny vs the
                    // night's peak; a zero count collapses to 0 (an empty, aligned slot).
                    style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : "0px" }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-text-muted">
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
          <div className={CHANNEL_COLOR.AUDIO.fill} style={{ flexGrow: audio }} aria-hidden="true" />
          <div className={CHANNEL_COLOR.VIDEO.fill} style={{ flexGrow: video }} aria-hidden="true" />
        </>
      )}
    </div>
  );
}
