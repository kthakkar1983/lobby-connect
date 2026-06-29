import { describe, it, expect, vi, beforeEach } from "vitest";
const createBrowserClient = vi.fn((..._a: unknown[]) => ({ realtime: {}, channel: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...a: unknown[]) => createBrowserClient(...a),
}));
beforeEach(() => {
  createBrowserClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});
describe("createBrowserSupabaseClient", () => {
  it("constructs a browser client from the public env (never the service key)", async () => {
    const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
    createBrowserSupabaseClient();
    expect(createBrowserClient).toHaveBeenCalledWith("https://proj.supabase.co", "anon-key");
    expect(createBrowserClient).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("service"),
    );
  });
});
