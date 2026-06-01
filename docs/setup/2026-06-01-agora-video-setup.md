# Agora + Kiosk Setup Guide (Plan 6a)

Follow these steps once before running the live smoke test or deploying to production.

---

## 1. Create the Agora project

1. Go to [console.agora.io](https://console.agora.io) → **Projects** → **Create**.
2. Name it **"Lobby Connect"**.
3. Select **Secured mode (APP ID + Token)** — **not** Testing mode. Secured mode requires a server-signed token for every channel join, which is what `GET /api/agora/token` issues.
4. Click **Submit** and copy the **App ID**.

> **Why secured mode?** Testing mode allows anyone who knows your App ID to join any channel. Secured mode means a guest must first hit your portal API to get a short-lived token — the only authorization gate for kiosk access.

---

## 2. Enable the App Certificate

1. In the Agora Console, open your new project → **Config**.
2. Find **Primary Certificate** and click **Enable**.
3. Copy the **Primary Certificate** value (32-char hex string).

The certificate is the server-side secret used to sign tokens. Never expose it in browser code.

---

## 3. Set environment variables

**`apps/portal/.env.local`** (portal — server-side only):

```dotenv
AGORA_APP_ID=<your 32-char App ID>
AGORA_APP_CERTIFICATE=<your 32-char Primary Certificate>
KIOSK_CONFIG_SECRET=<output of: openssl rand -hex 32>
```

**`apps/kiosk/.env.local`** (kiosk):

```dotenv
VITE_PORTAL_API_URL=http://localhost:3000
```

For production, add all four variables to their respective **Vercel project env** settings (portal: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `KIOSK_CONFIG_SECRET`; kiosk: `VITE_PORTAL_API_URL=https://lobby-connect-portal.vercel.app`).

---

## 4. Mint a kiosk config token (pilot — manual)

The kiosk authenticates to every portal API route via a long-lived HMAC token minted from the property UUID. Generate one with `tsx` (already available via pnpm):

```bash
# From repo root
KIOSK_CONFIG_SECRET=<your secret> npx tsx -e "
  const { signKioskToken } = await import('./apps/portal/lib/kiosk/config-token.ts');
  console.log(signKioskToken('<PROPERTY_UUID>', process.env.KIOSK_CONFIG_SECRET));
"
```

Replace `<PROPERTY_UUID>` with the UUID from your `properties` table (visible in Supabase Studio → Table Editor → properties).

The output is the `?t=` value you append to the kiosk URL on first launch. The kiosk persists it to `localStorage` so subsequent page loads don't need the query param.

> **Plan 7 note:** The owner portal will generate and display tokens from the property detail page, eliminating this manual step.

---

## 5. Kiosk launch checklist (per device, one-time)

1. Open `https://<kiosk-url>/?t=<token>` in Chrome on the tablet.
2. When the browser prompts for **camera** and **microphone** permissions, click **Allow**. Chrome persists this per origin, so future page loads won't prompt again.
3. Lock screen orientation to **landscape** (iOS: Accessibility → Display & Text Size → Auto-Rotate Off; Android: pull down Quick Settings → rotate lock).
4. Enable **Guided Access** (iOS) or **Screen Pinning** (Android) to prevent guests from leaving the app.
5. Leave the device on the **K-01 home screen**.

---

## 6. Free-tier note

Agora's free tier includes **10,000 video minutes per month**. At ~5 minutes per call, that covers roughly 2,000 calls/month — well beyond the single-hotel pilot workload. No billing configuration is needed until you expand to additional properties.

---

## 7. Verifying the setup (quick smoke)

After setting env vars and seeding the pilot property (see Task 18 SQL), run both dev servers:

```bash
pnpm dev:portal   # http://localhost:3000
pnpm dev:kiosk    # http://localhost:5173
```

Open `http://localhost:5173/?t=<token>` — the K-01 home screen should load with the property info card. If you see "Loading…" indefinitely, check the browser console for a `401` on `/api/kiosk/config` (wrong token or missing `KIOSK_CONFIG_SECRET`).
