import { describe, it, expect } from "vitest";
import {
  countToday,
  avgPickupSeconds,
  sumTodayDurationSeconds,
  avgCallLengthSeconds,
  countByOutcome,
  splitByChannel,
  splitTodayByChannel,
  hourlyVolume,
  countLiveCalls,
  type AnsweredDurationCall,
  type OutcomeCall,
  type ChannelCall,
  type HourlyCall,
  type DatedChannelCall,
  type LiveCall,
} from "@/lib/dashboard/calls";

const NOW = new Date("2026-06-08T02:00:00Z"); // 9:00 PM America/Chicago on Jun 7

describe("countToday", () => {
  it("counts items whose ring_started_at is 'today' in their own timezone", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" }, // Jun 7 8pm CT -> today
      { ring_started_at: "2026-06-06T01:00:00Z", timeZone: "America/Chicago" }, // earlier -> no
      { ring_started_at: "2026-06-08T01:30:00Z", timeZone: "America/New_York" }, // Jun 7 9:30pm ET -> today
    ];
    expect(countToday(items, NOW)).toBe(2);
  });
  it("is 0 for empty", () => {
    expect(countToday([], NOW)).toBe(0);
  });
});

describe("avgPickupSeconds", () => {
  it("averages answered_at - ring_started_at over today's answered calls, rounded", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", answered_at: "2026-06-08T01:00:10Z", timeZone: "America/Chicago" }, // 10s
      { ring_started_at: "2026-06-08T01:05:00Z", answered_at: "2026-06-08T01:05:20Z", timeZone: "America/Chicago" }, // 20s
      { ring_started_at: "2026-06-08T01:06:00Z", answered_at: null, timeZone: "America/Chicago" }, // unanswered -> ignored
    ];
    expect(avgPickupSeconds(items, NOW)).toBe(15);
  });
  it("returns null when there are no answered calls today", () => {
    expect(avgPickupSeconds([], NOW)).toBeNull();
    expect(
      avgPickupSeconds(
        [{ ring_started_at: "2026-06-08T01:00:00Z", answered_at: null, timeZone: "America/Chicago" }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("sumTodayDurationSeconds", () => {
  const NOW2 = new Date("2026-06-08T02:00:00Z");
  it("sums duration_seconds over today's calls, treating null as 0, ignoring non-today", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", duration_seconds: 120, timeZone: "America/Chicago" }, // today
      { ring_started_at: "2026-06-08T01:10:00Z", duration_seconds: null, timeZone: "America/Chicago" }, // today, null -> 0
      { ring_started_at: "2026-06-06T01:00:00Z", duration_seconds: 999, timeZone: "America/Chicago" }, // not today
    ];
    expect(sumTodayDurationSeconds(items, NOW2)).toBe(120);
  });
  it("is 0 for empty", () => {
    expect(sumTodayDurationSeconds([], NOW2)).toBe(0);
  });
});

describe("avgCallLengthSeconds", () => {
  it("averages duration_seconds over today's answered calls, rounded", () => {
    const items: AnsweredDurationCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", answered_at: "2026-06-08T01:00:05Z", duration_seconds: 100, timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:10:00Z", answered_at: "2026-06-08T01:10:05Z", duration_seconds: 200, timeZone: "America/Chicago" },
    ];
    expect(avgCallLengthSeconds(items, NOW)).toBe(150);
  });
  it("ignores unanswered, null-duration, and non-today calls", () => {
    const items: AnsweredDurationCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", answered_at: "2026-06-08T01:00:05Z", duration_seconds: 100, timeZone: "America/Chicago" }, // counts
      { ring_started_at: "2026-06-08T01:10:00Z", answered_at: null, duration_seconds: 999, timeZone: "America/Chicago" }, // unanswered -> ignored
      { ring_started_at: "2026-06-08T01:20:00Z", answered_at: "2026-06-08T01:20:05Z", duration_seconds: null, timeZone: "America/Chicago" }, // no duration -> ignored
      { ring_started_at: "2026-06-06T01:00:00Z", answered_at: "2026-06-06T01:00:05Z", duration_seconds: 999, timeZone: "America/Chicago" }, // not today -> ignored
    ];
    expect(avgCallLengthSeconds(items, NOW)).toBe(100);
  });
  it("returns null when there are no qualifying calls", () => {
    expect(avgCallLengthSeconds([], NOW)).toBeNull();
  });
});

describe("countByOutcome", () => {
  it("buckets today's calls by state into answered/missed/failed", () => {
    const items: OutcomeCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", state: "COMPLETED", timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:05:00Z", state: "NO_ANSWER", timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:10:00Z", state: "FAILED", timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:15:00Z", state: "RINGING", timeZone: "America/Chicago" }, // live -> not an outcome
      { ring_started_at: "2026-06-06T01:00:00Z", state: "COMPLETED", timeZone: "America/Chicago" }, // not today
    ];
    expect(countByOutcome(items, NOW)).toEqual({ answered: 1, missed: 1, failed: 1 });
  });
  it("is all zero for empty", () => {
    expect(countByOutcome([], NOW)).toEqual({ answered: 0, missed: 0, failed: 0 });
  });
});

describe("splitByChannel", () => {
  it("counts AUDIO vs VIDEO across the given items", () => {
    const items: ChannelCall[] = [{ channel: "AUDIO" }, { channel: "AUDIO" }, { channel: "VIDEO" }];
    expect(splitByChannel(items)).toEqual({ audio: 2, video: 1 });
  });
  it("is zero for empty", () => {
    expect(splitByChannel([])).toEqual({ audio: 0, video: 0 });
  });
});

describe("hourlyVolume", () => {
  it("buckets today's answered audio/video and missed (NO_ANSWER) calls by local hour", () => {
    const items: HourlyCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", channel: "AUDIO", state: "COMPLETED", timeZone: "America/Chicago" }, // 20:00 CT -> audio
      { ring_started_at: "2026-06-08T01:30:00Z", channel: "VIDEO", state: "COMPLETED", timeZone: "America/Chicago" }, // 20:30 CT -> video
      { ring_started_at: "2026-06-08T01:45:00Z", channel: "AUDIO", state: "NO_ANSWER", timeZone: "America/Chicago" }, // 20:45 CT -> missed (not audio)
      { ring_started_at: "2026-06-08T00:30:00Z", channel: "AUDIO", state: "COMPLETED", timeZone: "America/Chicago" }, // 19:30 CT -> audio
      { ring_started_at: "2026-06-06T01:00:00Z", channel: "AUDIO", state: "COMPLETED", timeZone: "America/Chicago" }, // not today
    ];
    const buckets = hourlyVolume(items, NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets[20]).toEqual({ hour: 20, audio: 1, video: 1, missed: 1 });
    expect(buckets[19]).toEqual({ hour: 19, audio: 1, video: 0, missed: 0 });
    expect(buckets[0]).toEqual({ hour: 0, audio: 0, video: 0, missed: 0 });
  });
  it("excludes FAILED and still-live calls from all three series", () => {
    const items: HourlyCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", channel: "AUDIO", state: "FAILED", timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:00:00Z", channel: "VIDEO", state: "RINGING", timeZone: "America/Chicago" },
      { ring_started_at: "2026-06-08T01:00:00Z", channel: "AUDIO", state: "IN_PROGRESS", timeZone: "America/Chicago" },
    ];
    expect(hourlyVolume(items, NOW)[20]).toEqual({ hour: 20, audio: 0, video: 0, missed: 0 });
  });
  it("returns 24 zeroed buckets for empty", () => {
    const buckets = hourlyVolume([], NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets.every((b, i) => b.hour === i && b.audio === 0 && b.video === 0 && b.missed === 0)).toBe(true);
  });
});

describe("splitTodayByChannel", () => {
  it("splits today's calls by channel, ignoring non-today", () => {
    const items: DatedChannelCall[] = [
      { ring_started_at: "2026-06-08T01:00:00Z", channel: "AUDIO", timeZone: "America/Chicago" }, // today
      { ring_started_at: "2026-06-08T01:30:00Z", channel: "VIDEO", timeZone: "America/Chicago" }, // today
      { ring_started_at: "2026-06-08T00:30:00Z", channel: "AUDIO", timeZone: "America/Chicago" }, // today
      { ring_started_at: "2026-06-06T01:00:00Z", channel: "AUDIO", timeZone: "America/Chicago" }, // not today
    ];
    expect(splitTodayByChannel(items, NOW)).toEqual({ audio: 2, video: 1 });
  });
  it("is zero for empty", () => {
    expect(splitTodayByChannel([], NOW)).toEqual({ audio: 0, video: 0 });
  });
});

describe("countLiveCalls", () => {
  it("counts RINGING + IN_PROGRESS split by channel, ignoring finished calls", () => {
    const items: LiveCall[] = [
      { state: "RINGING", channel: "AUDIO" },
      { state: "IN_PROGRESS", channel: "VIDEO" },
      { state: "IN_PROGRESS", channel: "AUDIO" },
      { state: "COMPLETED", channel: "AUDIO" }, // finished -> ignored
      { state: "NO_ANSWER", channel: "VIDEO" }, // finished -> ignored
    ];
    expect(countLiveCalls(items)).toEqual({ total: 3, audio: 2, video: 1 });
  });
  it("is zero for empty", () => {
    expect(countLiveCalls([])).toEqual({ total: 0, audio: 0, video: 0 });
  });
});
