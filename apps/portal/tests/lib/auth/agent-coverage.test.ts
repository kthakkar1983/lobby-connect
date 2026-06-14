import { describe, it, expect, vi, beforeEach } from "vitest";

const assignmentsResult = vi.fn();
const propertiesResult = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({ is: () => assignmentsResult() }),
        in: () => ({ order: () => propertiesResult() }),
      }),
    }),
  }),
}));

import { getAgentCoverage } from "@/lib/auth/agent-coverage";

beforeEach(() => {
  assignmentsResult.mockReset();
  propertiesResult.mockReset();
});

describe("getAgentCoverage", () => {
  it("returns empty when the agent has no active assignments", async () => {
    assignmentsResult.mockResolvedValue({ data: [] });
    expect(await getAgentCoverage("a1")).toEqual({ ids: [], properties: [] });
  });

  it("resolves assigned property ids -> property rows", async () => {
    assignmentsResult.mockResolvedValue({ data: [{ property_id: "p1" }, { property_id: "p2" }] });
    propertiesResult.mockResolvedValue({
      data: [
        { id: "p1", name: "Hotel One", timezone: "America/Chicago" },
        { id: "p2", name: "Hotel Two", timezone: "America/New_York" },
      ],
    });
    const cov = await getAgentCoverage("a1");
    expect(cov.ids).toEqual(["p1", "p2"]);
    expect(cov.properties).toHaveLength(2);
    expect(cov.properties[0]).toMatchObject({ id: "p1", timezone: "America/Chicago" });
  });
});
