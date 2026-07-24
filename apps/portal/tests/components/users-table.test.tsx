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

// Batch 5b / Task 4: the Role + Status inline spans were replaced with the
// shared StatusBadge primitive. Role keeps its distinct text-foreground
// (not StatusBadge's default muted text-muted-foreground) via a className
// override, so pin that explicitly — it is the one non-literal swap in this
// migration and the easiest thing to silently regress.
describe("UsersTable — Role/Status pills via StatusBadge (Batch 5b Task 4)", () => {
  it("renders the Role pill as a muted StatusBadge with the foreground text override", () => {
    render(<UsersTable users={[onCallAgent]} actorId="actor-1" />);
    const role = screen.getByText("Agent");
    expect(role.dataset.slot).toBe("status-badge");
    expect(role.dataset.variant).toBe("muted");
    expect(role.className).toContain("text-foreground");
    expect(role.className).not.toContain("text-muted-foreground");
  });

  it("renders the Status pill as a live StatusBadge for an active user", () => {
    render(<UsersTable users={[onCallAgent]} actorId="actor-1" />);
    const status = screen.getByText("Active");
    expect(status.dataset.slot).toBe("status-badge");
    expect(status.dataset.variant).toBe("live");
  });

  it("renders the Status pill as a muted StatusBadge for a deactivated user", () => {
    const deactivated: UserRow = { ...onCallAgent, id: "u3", active: false };
    render(<UsersTable users={[deactivated]} actorId="actor-1" />);
    const status = screen.getByText("Deactivated");
    expect(status.dataset.slot).toBe("status-badge");
    expect(status.dataset.variant).toBe("muted");
  });

  it("renders the Status pill as an attention StatusBadge for a pending-setup user", () => {
    const pending: UserRow = { ...onCallAgent, id: "u4", must_change_password: true };
    render(<UsersTable users={[pending]} actorId="actor-1" />);
    const status = screen.getByText("Pending setup");
    expect(status.dataset.slot).toBe("status-badge");
    expect(status.dataset.variant).toBe("attention");
  });
});
