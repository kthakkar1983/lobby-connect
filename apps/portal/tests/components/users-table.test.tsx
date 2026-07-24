/**
 * UsersTable — Task 8 (UI-copy polish batch 4): the admin users table printed
 * RAW DB enums in the Presence ("ON_CALL", "AVAILABLE", …) and Role ("ADMIN",
 * "AGENT", "OWNER") columns — banned by the copy guide ("never expose the DB
 * enum"). Presence now renders through the existing `presenceLabel` mapper
 * (already used by the owner portal); Role renders through a small local
 * label map. Copy-only — no pill/zebra visual restyle (that's Batch 5).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real actions module is a "use server" file that pulls in the Supabase
// admin client ("server-only" + service-role env) + requireRole + revalidatePath
// — none of which this test needs to prove. Mirrors shifts-table.test.tsx's /
// fleet-board.test.tsx's stub of the same kind for the same reason.
vi.mock("@/app/(admin)/admin/users/actions", () => ({
  createUserAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  updateUserAction: vi.fn(),
  hardDeleteUserAction: vi.fn(),
}));

import { UsersTable, type UserRow } from "@/app/(admin)/admin/users/users-table";

afterEach(() => cleanup());

const onCallAgent: UserRow = {
  id: "u1",
  full_name: "Dilnoza Agent",
  email: "dilnoza@example.com",
  role: "AGENT",
  status: "ON_CALL",
  active: true,
  must_change_password: false,
  last_seen_at: new Date().toISOString(),
};

describe("UsersTable — enum humanization (Task 8)", () => {
  it("renders the humanized presence label, not the raw DB enum", () => {
    render(<UsersTable users={[onCallAgent]} actorId="actor-1" />);
    expect(screen.getByText("On call")).toBeTruthy();
    expect(screen.queryByText("ON_CALL")).toBeNull();
  });

  it("renders the humanized role label, not the raw DB enum", () => {
    render(<UsersTable users={[onCallAgent]} actorId="actor-1" />);
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.queryByText("AGENT")).toBeNull();
  });

  it("still shows the exempt placeholder for a role with no presence (OWNER)", () => {
    const owner: UserRow = { ...onCallAgent, id: "u2", role: "OWNER", status: "OFFLINE" };
    render(<UsersTable users={[owner]} actorId="actor-1" />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
  });
});
