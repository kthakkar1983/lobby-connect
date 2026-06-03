import { describe, it, expect } from "vitest";
import {
  validateAuditFilter,
  mergeActorNames,
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  type AuditRow,
} from "@/lib/audit/query";

describe("validateAuditFilter", () => {
  it("defaults and clamps the limit", () => {
    expect(validateAuditFilter({}).limit).toBe(AUDIT_DEFAULT_LIMIT);
    expect(validateAuditFilter({ limit: "0" }).limit).toBe(AUDIT_DEFAULT_LIMIT);
    expect(validateAuditFilter({ limit: "99999" }).limit).toBe(AUDIT_MAX_LIMIT);
    expect(validateAuditFilter({ limit: "120" }).limit).toBe(120);
  });
  it("trims action, empty -> null", () => {
    expect(validateAuditFilter({ action: "  user.invited " }).action).toBe("user.invited");
    expect(validateAuditFilter({ action: "  " }).action).toBeNull();
  });
});

describe("mergeActorNames", () => {
  const base: AuditRow = {
    id: "1",
    actor_user_id: "u1",
    actor_type: "USER",
    action: "x",
    entity_type: "y",
    entity_id: null,
    details: null,
    created_at: "2026-06-03T00:00:00Z",
  };

  it("resolves USER names, falls back to Unknown", () => {
    const out = mergeActorNames([base], [{ id: "u1", full_name: "Ada" }]);
    expect(out[0]?.actorName).toBe("Ada");
    expect(mergeActorNames([base], [])[0]?.actorName).toBe("Unknown");
  });
  it("labels SYSTEM and null actors as System", () => {
    expect(mergeActorNames([{ ...base, actor_type: "SYSTEM" }], [])[0]?.actorName).toBe("System");
    expect(mergeActorNames([{ ...base, actor_user_id: null }], [])[0]?.actorName).toBe("System");
  });
});
