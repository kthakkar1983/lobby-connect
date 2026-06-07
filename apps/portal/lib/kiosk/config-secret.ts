import "server-only";

/**
 * Reads KIOSK_CONFIG_SECRET at call-time (so vi.stubEnv works in tests).
 *
 * Lives in its own crypto-free module so the boot-time config check in
 * instrumentation.ts can import it without dragging `node:crypto` (used by the
 * sign/verify helpers in config-token.ts) into the edge instrumentation chunk,
 * which webpack cannot bundle (`UnhandledSchemeError: node:crypto`).
 */
export function getKioskConfigSecret(): string {
  const s = process.env.KIOSK_CONFIG_SECRET;
  if (!s) {
    throw new Error(
      "Missing KIOSK_CONFIG_SECRET env var. Set it in apps/portal/.env.local (see .env.example).",
    );
  }
  return s;
}
