import { describe, it, expect } from "vitest";
import { diffFields, emptyToNull } from "@/lib/audit/diff";

describe("diffFields", () => {
  it("returns only changed fields with from/to", () => {
    const { updates, changes } = diffFields(
      { name: "A", tz: "X" },
      { name: "B", tz: "X" },
      ["name", "tz"],
    );
    expect(updates).toEqual({ name: "B" });
    expect(changes).toEqual([{ field: "name", from: "A", to: "B" }]);
  });

  it("returns empty update set when nothing changed", () => {
    const { updates, changes } = diffFields({ a: 1 }, { a: 1 }, ["a"]);
    expect(updates).toEqual({});
    expect(changes).toEqual([]);
  });
});

describe("emptyToNull", () => {
  it("trims, maps blank to null, keeps content", () => {
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("  hi ")).toBe("hi");
  });
});
