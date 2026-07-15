import { describe, it, expect, vi } from "vitest";
import { stampKioskLiveness } from "@/lib/kiosk/stamp-liveness";

function makeAdmin(operatorId: string | null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "properties") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: operatorId ? { operator_id: operatorId } : null }) }) }),
      };
    }
    return { upsert };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, upsert };
}

describe("stampKioskLiveness", () => {
  it("upserts last_seen_at by property_id with the resolved operator", async () => {
    const { client, upsert } = makeAdmin("op-1");
    await stampKioskLiveness(client, "prop-1");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0]!;
    expect(row).toMatchObject({ operator_id: "op-1", property_id: "prop-1" });
    expect(typeof row.last_seen_at).toBe("string");
    expect(opts).toMatchObject({ onConflict: "property_id" });
  });
  it("no-ops when the property has no operator (defensive)", async () => {
    const { client, upsert } = makeAdmin(null);
    await stampKioskLiveness(client, "prop-x");
    expect(upsert).not.toHaveBeenCalled();
  });
});
