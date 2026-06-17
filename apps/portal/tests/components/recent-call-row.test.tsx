import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecentCallRow, type RecentCall } from "@/components/dashboard/recent-call-row";

const base: RecentCall = {
  id: "c1",
  channel: "VIDEO",
  state: "COMPLETED",
  room_number: "705",
  caller_number: null,
  ring_started_at: "2026-06-17T05:32:00Z",
  duration_seconds: 132,
  notes: "Guest needed extra towels.",
  propertyName: "Super 8 by Wyndham Oklahoma City",
  timeZone: "America/Chicago",
};

function renderRow(call: RecentCall) {
  return render(
    <ul>
      <RecentCallRow call={call} />
    </ul>,
  );
}

afterEach(cleanup);

describe("RecentCallRow", () => {
  it("shows a note icon when the call has notes, hidden until expanded", async () => {
    const user = userEvent.setup();
    renderRow(base);

    // Collapsed: hotel name is the title (no room/Lobby), note icon present,
    // notes/detail not yet shown.
    expect(screen.getByText("Super 8 by Wyndham Oklahoma City")).toBeTruthy();
    expect(screen.queryByText(/Room/i)).toBeNull();
    expect(screen.getByRole("img", { name: "Has notes" })).toBeTruthy();
    expect(screen.queryByText("Guest needed extra towels.")).toBeNull();
    expect(screen.queryByText("Caller")).toBeNull();

    await user.click(screen.getByRole("button"));

    // Expanded: detail fields + the notes text.
    expect(screen.getByText("Guest needed extra towels.")).toBeTruthy();
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getByText("Caller")).toBeTruthy();
  });

  it("omits the note icon and shows an empty-notes message when there are no notes", async () => {
    const user = userEvent.setup();
    renderRow({ ...base, notes: null });

    expect(screen.queryByRole("img", { name: "Has notes" })).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/No notes recorded/i)).toBeTruthy();
  });

  it("shows the handler name on the admin (operator-wide) view", async () => {
    const user = userEvent.setup();
    renderRow({ ...base, handlerName: "Alex Agent" });

    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Handled by")).toBeTruthy();
    expect(screen.getByText("Alex Agent")).toBeTruthy();
  });

  it("omits the handler field on the agent view (no handlerName)", async () => {
    const user = userEvent.setup();
    renderRow(base); // no handlerName

    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("Handled by")).toBeNull();
  });
});
