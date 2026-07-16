import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The sign-out route must redirect to /sign-in in a way that survives the box's
// Traefik proxy. A route handler's `request.url` there resolves to the
// container's internal bind address (http://0.0.0.0:3000), so an absolute
// redirect built from it 303s the browser to an unreachable 0.0.0.0:3000/sign-in
// (the reported prod bug). A RELATIVE Location is resolved by the browser
// against the real page origin instead.

const { logSignOut, signOutSpy } = vi.hoisted(() => ({
  logSignOut: vi.fn(async () => {}),
  signOutSpy: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://sb.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));
vi.mock("@/lib/auth/audit", () => ({ logSignOut }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u-1" } } }),
      signOut: signOutSpy,
    },
  }),
}));

import { POST } from "@/app/auth/signout/route";

beforeEach(() => {
  logSignOut.mockClear();
  signOutSpy.mockClear();
});

describe("POST /auth/signout", () => {
  it("303-redirects to a RELATIVE /sign-in, never leaking the proxied 0.0.0.0:3000 host", async () => {
    const request = new NextRequest("http://0.0.0.0:3000/auth/signout", { method: "POST" });
    const res = await POST(request);

    expect(res.status).toBe(303);
    const location = res.headers.get("location");
    expect(location).toBe("/sign-in");
    // The regression guard: the container's internal bind address must never
    // reach the browser's Location.
    expect(location).not.toContain("0.0.0.0");
  });

  it("still signs the user out and audits it", async () => {
    const request = new NextRequest("http://0.0.0.0:3000/auth/signout", { method: "POST" });
    await POST(request);
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(logSignOut).toHaveBeenCalledWith("u-1");
  });
});
