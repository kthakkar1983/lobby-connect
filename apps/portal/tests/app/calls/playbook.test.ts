import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
let propertyRow: Record<string, unknown> | null = null;
let profileRow: Record<string, unknown> | null = null;
const createSignedUrlMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }),
          }),
        };
      }
      if (table === "calls") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }),
          }),
        };
      }
      // properties
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
        }),
      };
    },
    storage: {
      from: () => ({ createSignedUrl: createSignedUrlMock }),
    },
  }),
}));

import { GET } from "@/app/api/calls/[id]/playbook/route";

function call(id: string) {
  const request = new Request(`http://localhost:3000/api/calls/${id}/playbook`);
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  getUser.mockReset();
  createSignedUrlMock.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRow = { id: "call-1", property_id: "prop-1", operator_id: "op-1" };
  propertyRow = { playbook_pdf_url: "op-1/prop-1/playbook.pdf", playbook_version: 2 };
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://storage.example.com/signed/playbook.pdf" },
    error: null,
  });
});

describe("GET /api/calls/[id]/playbook", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
  });

  it("404 when the call is in a different operator", async () => {
    callRow = { id: "call-1", property_id: "prop-1", operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
  });

  it("returns hasPlaybook: false when no playbook is set", async () => {
    propertyRow = { playbook_pdf_url: null, playbook_version: null };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPlaybook).toBe(false);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns a signed URL when a playbook is set", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPlaybook).toBe(true);
    expect(body.signedUrl).toBe("https://storage.example.com/signed/playbook.pdf");
    expect(body.version).toBe(2);
    expect(createSignedUrlMock).toHaveBeenCalledWith("op-1/prop-1/playbook.pdf", 3600);
  });

  it("500 when storage signing fails", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "bucket not found" },
    });
    expect((await call("call-1")).status).toBe(500);
  });
});
