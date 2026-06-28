/**
 * Y-axis math for the hourly-volume chart (channel-viz). Pure so the scale and
 * its labels are computed once and tested in isolation.
 */

/**
 * The axis maximum: the busiest single bar rounded up to the next multiple of 3
 * (floored at 3). A multiple of 3 keeps the thirds — the four gridline labels —
 * whole numbers, and the floor stops a one-call night from drawing a degenerate
 * 0/1 axis.
 */
export function niceAxisMax(peak: number): number {
  return Math.max(3, Math.ceil(Math.max(0, peak) / 3) * 3);
}

/** The four gridline labels, top → bottom (max, ⅔, ⅓, 0) — all integers. */
export function axisTicks(peak: number): number[] {
  const m = niceAxisMax(peak);
  return [m, (m * 2) / 3, m / 3, 0];
}
