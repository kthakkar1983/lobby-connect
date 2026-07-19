"use client";

// Four analog faces for the dashboard's right column (spec 3.7).
//
// ANALOG, not digital: the shift card directly above already carries a large
// digital mono clock, and four more numeric readouts beneath it would read as
// one undifferentiated block of numbers.
//
// DAY/NIGHT TINTING is the point, not decoration. Analog is ambiguous about
// AM/PM, and across a 10.5-hour offset "is it the middle of the night there"
// is the actual question an agent is asking. A light face for day and a navy
// one for night answers it without reading anything. This is the one thing
// analog does BETTER than digital here rather than merely differently -- so if
// the tinting ever goes, the case for analog goes with it.
//
// The zone maths lives in lib/clocks/zone-time.ts and takes the instant as an
// argument; this file owns presentation and the tick, nothing else.

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { handAngles, zoneTime } from "@/lib/clocks/zone-time";

const ZONES = [
  { label: "India", timeZone: "Asia/Kolkata" },
  { label: "US · Eastern", timeZone: "America/New_York" },
  { label: "US · Central", timeZone: "America/Chicago" },
  { label: "US · Pacific", timeZone: "America/Los_Angeles" },
] as const;

/**
 * Minute-hand accuracy is all these need, so tick every 20s rather than every
 * second: four faces re-rendering 60x a minute, for a whole shift, to move
 * nothing a human can see.
 */
const TICK_MS = 20_000;

// Dial geometry, in the svg's own 64x64 user space.
const CENTRE = 32;
const DIAL_RADIUS = 29;
const TICK_OUTER_RADIUS = 24;
const HOUR_HAND = { length: 13, width: 2.6 } as const;
const MINUTE_HAND = { length: 20, width: 1.7 } as const;

/** A point on the dial. Zero degrees points at twelve, hence the -90. */
function pointAt(degrees: number, radius: number): { readonly x: number; readonly y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: CENTRE + Math.cos(radians) * radius,
    y: CENTRE + Math.sin(radians) * radius,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function Hand({
  degrees,
  length,
  width,
  isNight,
}: {
  readonly degrees: number;
  readonly length: number;
  readonly width: number;
  readonly isNight: boolean;
}) {
  const tip = pointAt(degrees, length);
  return (
    <line
      x1={CENTRE}
      y1={CENTRE}
      x2={tip.x}
      y2={tip.y}
      className={isNight ? "stroke-background" : "stroke-primary"}
      strokeWidth={width}
      strokeLinecap="round"
    />
  );
}

function ClockFace({
  label,
  timeZone,
  now,
}: {
  readonly label: string;
  readonly timeZone: string;
  /** Null until mounted -- see ZoneClocksCard. */
  readonly now: Date | null;
}) {
  const reading = now ? zoneTime(now, timeZone) : null;
  const hands = reading ? handAngles(reading.hours, reading.minutes) : null;
  // Before the first tick we know nothing, so show the light face: it matches
  // the card behind it and reads as an empty dial rather than asserting that
  // it is night somewhere it isn't.
  const isNight = reading?.isNight ?? false;

  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-button)] border border-border p-3">
      {/* aria-hidden: the dial is twelve tick marks and two lines, which is
          noise to a screen reader. The sr-only reading below carries the time
          instead -- keep the two together. */}
      <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden="true">
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={DIAL_RADIUS}
          className={isNight ? "fill-call stroke-muted-foreground/40" : "fill-card stroke-border"}
          strokeWidth="1.5"
        />
        {Array.from({ length: 12 }, (_, index) => {
          const degrees = index * 30;
          // Quarters are longer, so twelve/three/six/nine read at a glance.
          const outer = pointAt(degrees, TICK_OUTER_RADIUS);
          const inner = pointAt(degrees, TICK_OUTER_RADIUS - (index % 3 === 0 ? 7 : 4));
          return (
            <line
              key={degrees}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              className={isNight ? "stroke-muted-foreground" : "stroke-muted-foreground/60"}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          );
        })}
        {hands ? (
          <>
            <Hand degrees={hands.hour} {...HOUR_HAND} isNight={isNight} />
            <Hand degrees={hands.minute} {...MINUTE_HAND} isNight={isNight} />
            <circle
              cx={CENTRE}
              cy={CENTRE}
              r="2.2"
              className={isNight ? "fill-background" : "fill-primary"}
            />
          </>
        ) : null}
      </svg>
      <p className="text-center font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {label}
      </p>
      {/* 24-hour, deliberately: it resolves the same AM/PM ambiguity the
          tinting resolves visually, which "2:14" would not. */}
      {reading ? (
        <span className="sr-only">
          {`${label} ${twoDigits(reading.hours)}:${twoDigits(reading.minutes)}`}
        </span>
      ) : null}
    </div>
  );
}

export function ZoneClocksCard() {
  // Null on the first render, filled in on mount.
  //
  // This card sits in a "use client" workspace that Next still renders to HTML
  // on the server, so a time-derived FIRST render would be a hydration mismatch
  // waiting to happen: the server's clock (our box) and the agent's (her PC,
  // mostly in India) are different machines, and any skew at all -- not merely
  // a render that straddles a minute boundary -- makes the server's hands
  // disagree with the client's. Every other time-driven component here is
  // incidentally safe because its time-derived branch sits behind client-only
  // state; this one has no such branch, so it says so explicitly.
  //
  // The cost is one frame of a dial without hands. It shifts no layout -- the
  // svg box is fixed either way -- and it is honest: the server genuinely
  // cannot know what these clocks read.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="gap-3 p-4">
      <p className="font-label text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        Clocks
      </p>
      <div className="grid grid-cols-2 gap-3">
        {ZONES.map((zone) => (
          <ClockFace
            key={zone.timeZone}
            label={zone.label}
            timeZone={zone.timeZone}
            now={now}
          />
        ))}
      </div>
    </Card>
  );
}
