import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: p } = await admin
    .from("properties")
    .select(
      "id, name, active, logo_url, kiosk_welcome_heading, kiosk_welcome_message, kiosk_checkin_time, kiosk_checkout_time, kiosk_wifi_network, kiosk_wifi_password, kiosk_breakfast_hours, kiosk_apology_message, property_phone_number",
    )
    .eq("id", verified.propertyId)
    .maybeSingle();

  if (!p || !p.active) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  return NextResponse.json({
    propertyId: p.id,
    logoUrl: p.logo_url,
    welcomeHeading: p.kiosk_welcome_heading ?? `Welcome to ${p.name}`,
    welcomeMessage: p.kiosk_welcome_message,
    checkinTime: p.kiosk_checkin_time,
    checkoutTime: p.kiosk_checkout_time,
    wifiNetwork: p.kiosk_wifi_network,
    wifiPassword: p.kiosk_wifi_password,
    breakfastHours: p.kiosk_breakfast_hours,
    apologyMessage: p.kiosk_apology_message,
    phoneNumber: p.property_phone_number,
  });
}
