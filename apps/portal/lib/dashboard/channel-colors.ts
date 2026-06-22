/**
 * Single source of truth for the call-CHANNEL colour mapping on the dashboards
 * (brand spec §5): teal = phone/AUDIO, navy = video/VIDEO. The hourly chart, the
 * channel legend/bar, and the recent-call channel icon all read from here so a
 * phone call is the same colour wherever it appears.
 *
 * (s1-test follow-up: the chart coloured by channel — teal/navy — while the
 * recent-calls list left its channel icon muted grey, so the two looked unrelated.
 * Outcome colours — mint=answered / blaze=missed / grey=failed — are a SEPARATE
 * concern and stay on the status dot/pill; this file is channel only.)
 */
export type CallChannel = "AUDIO" | "VIDEO";

export const CHANNEL_COLOR: Record<
  CallChannel,
  { readonly fill: string; readonly icon: string; readonly label: string }
> = {
  AUDIO: { fill: "bg-accent", icon: "text-accent", label: "Phone" },
  VIDEO: { fill: "bg-primary", icon: "text-primary", label: "Video" },
};

/** Narrow the free-text `calls.channel` column to a known channel (defaults to AUDIO). */
export function asChannel(value: string): CallChannel {
  return value === "VIDEO" ? "VIDEO" : "AUDIO";
}
