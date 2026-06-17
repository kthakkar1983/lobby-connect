"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@lc/shared";

/**
 * Shared gradient header for every portal (spec §5.3 / §1): a navy→teal band with
 * a static field of connection-lines (the brand seam motif), a time-aware greeting
 * in cream, an account-menu slot, and a seam hairline along the bottom edge that
 * continues the navy rail's right-edge seam.
 *
 * The lines are STATIC by construction (plain <path>, no motion) so they need no
 * reduced-motion guard. Agent/admin pass the `AccountMenu`; owner passes its own
 * `UserMenu` into the same slot.
 */

// A right-weighted fan of curved strokes. Decorative (aria-hidden); teal + mint at
// low opacity over the gradient, concentrated in the right ~60% so the greeting reads
// clean on the left. viewBox is stretched to the band via preserveAspectRatio="none".
const LINES = Array.from({ length: 14 }, (_, i) => ({
  d: `M ${188 + i * 9} ${96 - i * 2} C ${332 + i * 5} ${74 - i * 4}, ${472 + i * 3} ${30 - i * 2}, 616 ${24 - i}`,
  width: 0.9 + (i % 5) * 0.1,
  opacity: 0.12 + (i % 6) * 0.026,
  mint: i % 3 === 1,
}));

function ConnectionLines() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100"
      viewBox="0 0 600 80"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {LINES.map((line, i) => (
        <path
          key={i}
          d={line.d}
          stroke="currentColor"
          strokeWidth={line.width}
          strokeOpacity={line.opacity}
          className={line.mint ? "text-live" : "text-accent"}
        />
      ))}
    </svg>
  );
}

export function DashboardHeader({
  firstName,
  children,
}: {
  readonly firstName: string;
  readonly children?: React.ReactNode;
}) {
  // Time-aware, mirroring GreetingLine: render a neutral default on the server and
  // resolve the greeting on the client so the local hour never mismatches hydration.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  return (
    <header className="relative isolate overflow-hidden rounded-card bg-[image:var(--gradient-header)] shadow-md">
      <ConnectionLines />
      <div className="relative flex min-h-[11rem] items-start justify-between gap-4 px-6 py-5">
        <p className="font-display text-3xl font-semibold leading-tight text-sidebar-foreground">
          {greeting}, {firstName}.
        </p>
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-[2px] bg-[image:var(--gradient-seam)]"
        aria-hidden="true"
      />
    </header>
  );
}
