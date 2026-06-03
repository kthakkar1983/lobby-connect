import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null = null;
let propertyRow: Record<string, unknown> | null = null;
const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

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
      // properties
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
        }),
        update: updateMock,
      };
    },
    storage: { from: () => ({ upload: uploadMock, createSignedUrl: createSignedUrlMock }) },
  }),
}));

vi.mock("@/lib/auth/audit", () => ({ logAuditEvent: vi.fn() }));

import { GET, POST } from "@/app/api/owner/properties/[id]/playbook/route";

const PROP = "00000000-0000-0000-0000-0000000000c1";

function getReq(): Promise<Response> {
  return GET(new Request(`http://localhost/api/owner/properties/${PROP}/playbook`), {
    params: Promise.resolve({ id: PROP }),
  }) as Promise<Response>;
}

function postReq(file: File | null): Promise<Response> {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return POST(
    new Request(`http://localhost/api/owner/properties/${PROP}/playbook`, {
      method: "POST",
      body: fd,
    }),
    { params: Promise.resolve({ id: PROP }) },
  ) as Promise<Response>;
}

function pdf(bytes = 1024) {
  return new File([new Uint8Array(bytes)], "p.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  getUser.mockReset();
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  updateMock.mockClear();
  updateEqMock.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  profileRow = { id: "owner-1", operator_id: "op-1", role: "OWNER" };
  propertyRow = {
    id: PROP,
    operator_id: "op-1",
    owner_user_id: "owner-1",
    playbook_pdf_url: "op-1/" + PROP + "/playbook.pdf",
    playbook_version: 2,
  };
  uploadMock.mockResolvedValue({ data: { path: "x" }, error: null });
  updateEqMock.mockResolvedValue({ error: null });
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://x/signed.pdf" },
    error: null,
  });
});

describe("POST /api/owner/properties/[id]/playbook", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await postReq(pdf())).status).toBe(401);
  });

  it("403 when the caller is not the property owner", async () => {
    propertyRow = { ...propertyRow, owner_user_id: "someone-else" };
    expect((await postReq(pdf())).status).toBe(403);
  });

  it("400 on a non-PDF", async () => {
    const png = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    expect((await postReq(png)).status).toBe(400);
  });

  it("400 on an oversize file", async () => {
    const big = pdf(10 * 1024 * 1024 + 1);
    expect((await postReq(big)).status).toBe(400);
  });

  it("uploads and bumps the version", async () => {
    const res = await postReq(pdf());
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(3);
    expect(uploadMock).toHaveBeenCalledWith(
      "op-1/" + PROP + "/playbook.pdf",
      expect.anything(),
      expect.objectContaining({ contentType: "application/pdf", upsert: true }),
    );
    expect(updateMock).toHaveBeenCalled();
  });
});

describe("GET /api/owner/properties/[id]/playbook", () => {
  it("403 when not the owner", async () => {
    propertyRow = { ...propertyRow, owner_user_id: "someone-else" };
    expect((await getReq()).status).toBe(403);
  });

  it("hasPlaybook:false when none set", async () => {
    propertyRow = { ...propertyRow, playbook_pdf_url: null };
    const body = await (await getReq()).json();
    expect(body.hasPlaybook).toBe(false);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns a signed URL", async () => {
    const body = await (await getReq()).json();
    expect(body.hasPlaybook).toBe(true);
    expect(body.signedUrl).toBe("https://x/signed.pdf");
    expect(body.version).toBe(2);
  });
});
