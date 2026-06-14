import { describe, it, expect, vi } from "vitest";
import { createPlaybookSignedUrl } from "@/lib/storage/playbook";

function fakeAdmin(result: unknown) {
  return {
    storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue(result) }) },
  } as never;
}

describe("createPlaybookSignedUrl", () => {
  it("returns the signed url on success", async () => {
    const admin = fakeAdmin({ data: { signedUrl: "https://x/y.pdf" }, error: null });
    expect(await createPlaybookSignedUrl(admin, "a/b.pdf")).toBe("https://x/y.pdf");
  });
  it("returns null on storage error", async () => {
    const admin = fakeAdmin({ data: null, error: { message: "nope" } });
    expect(await createPlaybookSignedUrl(admin, "a/b.pdf")).toBeNull();
  });
});
