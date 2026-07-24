/**
 * ShiftsTable — Task 6 (UI-copy polish batch 4, factual fix): the admin
 * timesheet surfaces the app's real shift cap (`MAX_SHIFT_MS`,
 * packages/shared/src/protocol.ts = 10h), not the unrelated Supabase-session
 * `SESSION_MAX_MS` (12h). Two user-facing strings had drifted to the wrong
 * number — the "capped" ended-reason badge and the empty-state description.
 * Pins both at 10h so a revert can't silently reintroduce the stale 12h copy.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The real actions module is a "use server" file that pulls in the Supabase
// server client + requireRole + revalidatePath (+ env validation) — none of
// which this test needs to prove. Mirrors fleet-board.test.tsx's stub of
// AvailabilityToggle for the same reason.
vi.mock("@/app/(admin)/admin/shifts/actions", () => ({
  editShiftAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  addShiftAction: vi.fn(),
}));

import { ShiftsTable } from "@/app/(admin)/admin/shifts/shifts-table";
import type { ShiftTimesheetRow, TimesheetRange } from "@/lib/shifts/query";

afterEach(() => cleanup());

const range: TimesheetRange = {
  fromIso: "2026-07-16T00:00:00.000Z",
  toIso: "2026-07-23T00:00:00.000Z",
  label: "Jul 16 – Jul 23, 2026",
};

const cappedRow: ShiftTimesheetRow = {
  id: "s1",
  userId: "u1",
  name: "Dilnoza Agent",
  role: "AGENT",
  startedAt: "2026-07-20T00:00:00.000Z",
  endedAt: "2026-07-20T10:00:00.000Z",
  endedReason: "capped",
  clockedSeconds: 36000,
  callCount: 3,
  talkSeconds: 1200,
  remoteCount: 1,
  utilization: 3,
};

describe("ShiftsTable — shift cap copy (Task 6: 12h -> 10h)", () => {
  it("labels a capped shift's badge with the real 10h cap, not the stale 12h", () => {
    render(<ShiftsTable rows={[cappedRow]} range={range} roster={[]} />);
    expect(screen.getByText("Capped 10h")).toBeTruthy();
    expect(screen.queryByText("Capped 12h")).toBeNull();
  });

  it("the empty-state description cites the real 10h cap, not the stale 12h", () => {
    render(<ShiftsTable rows={[]} range={range} roster={[]} />);
    expect(screen.getByText(/10h cap/)).toBeTruthy();
    expect(screen.queryByText(/12h cap/)).toBeNull();
  });
});
