/**
 * ZoneClocksCard (Task 7): the presentation half of spec 3.7 -- four analog
 * faces with day/night tinting in the dashboard's right column.
 *
 * The zone maths itself is already pinned by tests/lib/clocks/zone-time.test.ts
 * (Task 6, node project). What this file owns is everything that file cannot
 * reach: that the four zones are wired to the right IANA identifiers, that the
 * day/night tint -- the entire reason D7 chose analog -- actually tracks the
 * instant, that the reading is available to a screen reader, that the tick
 * cadence is the specified 20s and not per-second, and that the interval is
 * released on unmount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZoneClocksCard } from "@/components/dashboard/zone-clocks-card";

/**
 * A US night / India day. Chosen because all four zones read differently at
 * this instant and Pacific has rolled back to the previous calendar day, so a
 * zone wired to the wrong identifier -- or an implementation deriving the hour
 * from the UTC date -- cannot pass:
 *   06:14Z -> India 11:44 (day) | Eastern 02:14 | Central 01:14 | Pacific 23:14
 */
const US_NIGHT = new Date("2026-07-19T06:14:00Z");

/** The mirror image, twelve hours on: India 23:44 (night), all three US zones day. */
const US_DAY = new Date("2026-07-19T18:14:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(US_NIGHT);
});

afterEach(() => {
  // Strict order. cleanup() first, so unmount's clearInterval still runs against
  // the fake clock. Then restore the setInterval/clearInterval spies the unmount
  // test installs, which puts back the FAKE implementations they wrapped. Only
  // then hand the timers back, so nothing leaks into the next file -- doing
  // useRealTimers() before restoreAllMocks() would let the restore overwrite the
  // real timers with the fake ones again.
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * The face circle for a zone, as a class string.
 *
 * The first <circle> in a face is the dial. The hub circle that follows carries
 * fill-primary/fill-background, so if the two are ever reordered this returns
 * the hub and the tint assertions fail loudly rather than passing vacuously.
 * getAttribute("class"), not .className -- on an SVG element that is an
 * SVGAnimatedString, not a string.
 */
function faceClass(label: string): string {
  const wrapper = screen.getByText(label).closest("div");
  return wrapper?.querySelector("circle")?.getAttribute("class") ?? "";
}

describe("ZoneClocksCard", () => {
  it("labels all four zones geographically", () => {
    render(<ZoneClocksCard />);
    // Exact strings: the middle dot is the specified separator (spec 3.7), and
    // a regex would let "US Eastern" through.
    for (const label of ["India", "US · Eastern", "US · Central", "US · Pacific"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("reads each zone's own wall clock, so the times are not vision-only", () => {
    render(<ZoneClocksCard />);
    expect(screen.getByText("India 11:44")).toBeTruthy();
    expect(screen.getByText("US · Eastern 02:14")).toBeTruthy();
    expect(screen.getByText("US · Central 01:14")).toBeTruthy();
    // Pacific has rolled back over midnight into the previous day.
    expect(screen.getByText("US · Pacific 23:14")).toBeTruthy();
  });

  it("hides the dial from assistive tech and lets the text carry the time", () => {
    render(<ZoneClocksCard />);

    // The reading is sr-only on purpose. Making it visible would defeat D7:
    // the shift card directly above already carries a large digital clock, and
    // four more numeric readouts beneath it read as one undifferentiated block.
    expect(screen.getByText("India 11:44").getAttribute("class")).toContain("sr-only");

    // ...which only works if the dial itself is not also announced, or a screen
    // reader gets twelve meaningless tick marks before the time.
    const dial = screen.getByText("India").closest("div")?.querySelector("svg");
    expect(dial?.getAttribute("aria-hidden")).toBe("true");
  });

  it("tints the face by local day or night", () => {
    render(<ZoneClocksCard />);

    // 11:44 in India: day.
    expect(faceClass("India")).toContain("fill-card");
    expect(faceClass("India")).not.toContain("fill-call");

    // The small hours across the US: night.
    for (const label of ["US · Eastern", "US · Central", "US · Pacific"]) {
      expect(faceClass(label)).toContain("fill-call");
      expect(faceClass(label)).not.toContain("fill-card");
    }
  });

  it("flips a zone's tint with the instant rather than pinning it per zone", () => {
    // Same component, twelve hours on: the whole board inverts. Guards against
    // a tint hardcoded per zone, which would look right in the test above and
    // be wrong for half of every day.
    vi.setSystemTime(US_DAY);
    render(<ZoneClocksCard />);

    expect(faceClass("India")).toContain("fill-call");
    for (const label of ["US · Eastern", "US · Central", "US · Pacific"]) {
      expect(faceClass(label)).toContain("fill-card");
    }
  });

  it("points the hands the right way round the dial", () => {
    // handAngles is already tested in the node project, but the step from an
    // angle to an svg coordinate is not, and it is the one thing here that can
    // be silently wrong: SVG's y-axis grows downward and zero degrees has to
    // mean twelve, not three. A sign error passes every other test in this file
    // and is obvious only on screen.
    vi.setSystemTime(new Date("2026-07-18T21:30:00Z")); // India 03:00 exactly
    render(<ZoneClocksCard />);

    const face = screen.getByText("India").closest("div");
    // The hands are the only lines not drawn at the tick weight.
    const hands = Array.from(face?.querySelectorAll("line") ?? []).filter(
      (line) => line.getAttribute("stroke-width") !== "1.5",
    );
    expect(hands).toHaveLength(2);

    // A missing hand reads as NaN here and fails the assertion, so the
    // optional chaining cannot quietly pass.
    const tip = (index: number) => ({
      x: Number(hands[index]?.getAttribute("x2")),
      y: Number(hands[index]?.getAttribute("y2")),
    });

    // 03:00 -> hour hand east (13 out from the centre at 32,32), minute hand
    // north (20 up). Both start at the centre.
    expect(tip(0).x).toBeCloseTo(45, 5);
    expect(tip(0).y).toBeCloseTo(32, 5);
    expect(tip(1).x).toBeCloseTo(32, 5);
    expect(tip(1).y).toBeCloseTo(12, 5);
  });

  it("ticks on the 20s cadence, not per second", () => {
    // Ten seconds before a minute boundary in India (11:44:50 IST).
    vi.setSystemTime(new Date("2026-07-19T06:14:50Z"));
    render(<ZoneClocksCard />);
    expect(screen.getByText("India 11:44")).toBeTruthy();

    // 19s later the wall clock has passed 11:45, but no tick has fired yet, so
    // the face has not moved. A per-second tick fails here.
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(screen.getByText("India 11:44")).toBeTruthy();

    // One more second completes the interval and the face catches up. A tick
    // slower than 20s fails here.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("India 11:45")).toBeTruthy();
  });

  it("releases its interval on unmount", () => {
    // Spies on the card's OWN scheduling rather than vi.getTimerCount(), which
    // counts every pending timer on the shared fake clock -- React's scheduler
    // and anything RTL leaves behind included. An absolute `toBe(1)` on a global
    // count fails for defects this test does not own. Same idiom as
    // call-back-shortcut.test.tsx:195 and video-call-outbound.test.tsx:140.
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<ZoneClocksCard />);

    // Located by cadence, so this identifies the card's tick specifically.
    // 20_000 as a literal, not an import: TICK_MS is module-private, and the
    // cadence test above pins the same figure the same way.
    const tickIndex = setIntervalSpy.mock.calls.findIndex((call) => call[1] === 20_000);
    expect(tickIndex).toBeGreaterThanOrEqual(0);
    const tickId = setIntervalSpy.mock.results[tickIndex]?.value;

    unmount();

    // A leaked interval would keep calling setState on an unmounted tree for
    // the life of the tab -- and this card is mounted on every dashboard route
    // change (the aside is hidden off-home, not unmounted, but the component
    // still remounts across sign-in/out). Asserting on the ID, not just on
    // "clearInterval fired", so clearing some OTHER timer cannot satisfy this.
    expect(clearIntervalSpy).toHaveBeenCalledWith(tickId);
  });

  it("renders no clock reading on the server", () => {
    // The dashboard workspace is a "use client" tree that Next still renders to
    // HTML on the server, so a time-derived FIRST render is a hydration
    // mismatch waiting to happen: the server's clock (our box) and the agent's
    // (her PC in India) are different machines, and any skew at all -- not just
    // a render that straddles a minute boundary -- makes the two disagree.
    // Effects do not run during a static render, so this is exactly the markup
    // the server would emit.
    const markup = renderToStaticMarkup(<ZoneClocksCard />);

    expect(markup).toContain("India");
    expect(markup).not.toMatch(/\d{2}:\d{2}/);
  });
});
