/**
 * Wire DTOs for the kiosk↔portal HTTP contract.
 *
 * These interfaces are the single source of truth for the three API routes
 * consumed by the kiosk. Both sides import from @lc/shared so a shape drift
 * fails typecheck in either app before reaching the wire.
 */

import type { KioskCtaStyle } from "./supabase-types";

/** Returned by GET /api/kiosk/config */
export interface KioskConfig {
  propertyId: string;
  logoUrl: string | null;
  welcomeHeading: string;
  welcomeMessage: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  breakfastHours: string | null;
  apologyMessage: string | null;
  phoneNumber: string | null;
  ctaStyle: KioskCtaStyle;
}

/** Returned by POST /api/kiosk/call-started */
export interface CallStartResult {
  callId: string;
  channelName: string;
}

/**
 * Returned by GET /api/video/token. The `provider` literal is the wire
 * discriminator: the SERVER decides the provider per call (today: always
 * "livekit") so kiosk and portal can never disagree mid-call; a future
 * second provider re-adds its variant here.
 */
export interface VideoTokenResult {
  provider: "livekit";
  url: string;
  channelName: string;
  token: string;
}
