import { describe, expect, it } from "vitest";

describe("assertNotSelfDemote", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "b",
        patch: { role: "AGENT" },
      }),
    ).toBeNull();
  });

  it("returns null when actor == target but patch has no role change", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "a",
        patch: { full_name: "New Name" },
      }),
    ).toBeNull();
  });

  it("rejects when actor == target and role is in patch", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "a",
        patch: { role: "AGENT" },
      }),
    ).toBe("You can't change your own role.");
  });
});

describe("assertNotSelfDeactivate", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "b",
        patch: { active: false },
      }),
    ).toBeNull();
  });

  it("returns null when patch sets active=true on self", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "a",
        patch: { active: true },
      }),
    ).toBeNull();
  });

  it("rejects when actor == target and patch sets active=false", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "a",
        patch: { active: false },
      }),
    ).toBe("You can't deactivate yourself.");
  });
});

describe("assertNotSelfDelete", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDelete } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDelete({ actorId: "a", targetId: "b" }),
    ).toBeNull();
  });

  it("rejects when actor == target", async () => {
    const { assertNotSelfDelete } = await import("@/lib/users/guards");
    expect(assertNotSelfDelete({ actorId: "a", targetId: "a" })).toBe(
      "You can't delete yourself.",
    );
  });
});
