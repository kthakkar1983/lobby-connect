import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CallRow, type CallRowData } from "@/components/call/call-row";
import type { CallDetail } from "@/components/call/call-detail-body";

const baseDetail: CallDetail = {
  id: "c1",
  channel: "VIDEO",
  state: "COMPLETED",
  direction: "INBOUND",
  caller_number: null,
  room_number: "705",
  ring_started_at: "2026-06-17T05:32:00Z",
  duration_seconds: 132,
  notes: null,
  recording_url: null,
  propertyName: "Super 8 by Wyndham Oklahoma City",
  timeZone: "America/Chicago",
  handlerName: "Alex Agent",
};

function renderRow(detail: CallDetail) {
  const call: CallRowData = { secondary: "Room 705", detail };
  return render(<CallRow call={call} />);
}

afterEach(cleanup);

// Task 17 (outbound-video-calls plan): CallRow renders the collapsed-header
// <StatusPill kind="call"> from CallRowData.detail — this is the primary
// per-call-row surface where an OUTBOUND NO_ANSWER (agent-placed call-back
// the guest didn't pick up) must read "No answer", not "Missed".
describe("CallRow", () => {
  it("shows the standard blaze 'Missed' pill for an inbound NO_ANSWER (unchanged default)", () => {
    renderRow({ ...baseDetail, state: "NO_ANSWER", direction: "INBOUND", handlerName: "Unanswered" });
    const pill = screen.getByText("Missed");
    expect(pill.className).toContain("attention");
  });

  it("shows 'No answer' — not 'Missed', and not the attention/blaze class — for an OUTBOUND NO_ANSWER", () => {
    renderRow({ ...baseDetail, state: "NO_ANSWER", direction: "OUTBOUND" });
    const pill = screen.getByText("No answer");
    expect(pill.className).not.toContain("attention");
    expect(screen.queryByText("Missed")).toBeNull();
  });

  it("is unaffected by direction for a non-NO_ANSWER state", () => {
    renderRow({ ...baseDetail, state: "COMPLETED", direction: "OUTBOUND" });
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("expands to show the call detail body without crashing on an outbound call", async () => {
    const user = userEvent.setup();
    renderRow({ ...baseDetail, state: "NO_ANSWER", direction: "OUTBOUND" });
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Property")).toBeTruthy();
  });

  it("the expand button carries an inset focus ring", () => {
    renderRow(baseDetail);
    const button = screen.getByRole("button");
    expect(button.className).toContain("focus-visible:ring-inset");
    expect(button.className).toContain("focus-visible:ring-ring");
  });
});
