import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let propertyRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/kiosk/config/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/config", {
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  propertyRow = {
    id: "prop-1",
    name: "The Sample Hotel",
    active: true,
    logo_url: null,
    kiosk_welcome_heading: null,
    kiosk_welcome_message: "How can we help?",
    kiosk_checkin_time: "3:00 PM",
    kiosk_checkout_time: null,
    kiosk_wifi_network: null,
    kiosk_wifi_password: null,
    kiosk_breakfast_hours: null,
    kiosk_apology_message: "Sorry, nobody is available.",
    kiosk_cta_style: "accent",
    property_phone_number: "+14055551234",
  };
});

describe("GET /api/kiosk/config", () => {
  it("401 without a token", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("401 with a bad token", async () => {
    expect((await GET(req("garbage"))).status).toBe(401);
  });

  it("returns display fields, defaulting the heading to the property name", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await GET(req(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.welcomeHeading).toBe("Welcome to The Sample Hotel");
    expect(body.checkinTime).toBe("3:00 PM");
    expect(body.checkoutTime).toBeNull();
  });

  it("404 when the property is inactive/missing", async () => {
    propertyRow = null;
    const token = signKioskToken("prop-1", SECRET);
    expect((await GET(req(token))).status).toBe(404);
  });

  it("returns the kiosk cta style", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await GET(req(token));
    expect((await res.json()).ctaStyle).toBe("accent");
  });
});
