# Twilio Voice Setup — Plan 5a (manual steps + credentials to gather)

This is your checklist for standing up the Twilio side of the inbound audio path. Do these in the Twilio Console; hand me the credentials in **Section 6** and I wire the code.

Related: `docs/specs/2026-05-30-05a-voice-backend-design.md`.

> **Cost note before you start:** Twilio voice is billed **per minute, rounded up to the next minute** — never per call, and rates are **cents, not dollars** (US local inbound ≈ $0.0085/min; the browser leg ≈ $0.004–0.0085/min). If a test call looked like ~$1, check **Console → Monitor → Logs → Calls** — each call shows its exact price. A ~$1 charge is almost certainly a number's monthly rental, an international leg, or a console outbound test (not how our inbound-to-browser flow works).

---

## 1. Upgrade the account & tidy up

1. Sign in to the Twilio Console (the default "My First Twilio Account" project is fine — single account for v1).
2. **Upgrade** the account: add a payment method. This removes the trial "this is a trial account" voice preamble and trial call limits, which we need for clean 5a testing.
3. (Optional) Rename the account/project to **"Lobby Connect — Pilot"** for clarity.
4. You can **release the free trial 855 toll-free number** after Step 2 (we're using a local number instead — cheaper inbound, no toll-free verification, local presence for a hotel).

> We are **not** creating subaccounts. Single account for the single-tenant v1 pilot. Subaccounts come later (v2) as the per-tenant boundary.

---

## 2. Buy a local phone number

1. **Phone Numbers → Manage → Buy a number.**
2. Filter: **Country = US**, **Capabilities = Voice**, and pick the **pilot property's area code** if available.
3. Buy one number (~$1.15/mo). **Write it down in E.164 format**, e.g. `+1XXXXXXXXXX` — this becomes the pilot property's `routing_did`.

> Leave the number's webhook config for **Section 5** — we set it after the tunnel is running, because the URL changes per session.

---

## 3. Gather the Account SID + Auth Token

1. **Console home / Account → API keys & tokens** (or the dashboard "Account Info" panel).
2. Copy the **Account SID** (starts with `AC…`).
3. Copy the **Auth Token** (click to reveal). This is what verifies inbound webhook signatures (HMAC).

> Treat the Auth Token like a password. Never commit it.

---

## 4. Create an API Key + Secret

(Used by Plan 5b's browser token route, but create it now so we have everything.)

1. **Account → API keys & tokens → Create API key.**
2. Name it `lobby-connect-5a`, type **Standard**.
3. Copy the **SID** (starts with `SK…`) and the **Secret** — **the Secret is shown only once.** If you lose it, delete the key and make a new one.

---

## 5. Tunnel + webhook wiring (each dev session)

Twilio must reach your local dev server over the public internet. We use a tunnel.

1. I'll run `next dev` (against your local Supabase) on its usual port.
2. Start a tunnel to that port using **`cloudflared`** (chosen for simplicity — anonymous quick tunnels, no account/authtoken):
   - One-time install: `brew install cloudflared`.
   - Each session: `cloudflared tunnel --url http://localhost:<port>` → copy the printed `https://….trycloudflare.com` URL.
   - (Alternatives if ever needed: `ngrok` requires a free authtoken; the Twilio CLI is a third option. We default to cloudflared.)
3. In **Phone Numbers → Manage → Active numbers → (your number) → Voice configuration**:
   - **"A call comes in"**: Webhook, **HTTP POST**, URL = `https://<tunnel>/api/twilio/voice/incoming`
   - **"Call status changes"** (status callback): **HTTP POST**, URL = `https://<tunnel>/api/twilio/voice/status`
4. Save. **Re-point these two URLs whenever the tunnel URL changes** (free tunnels rotate on restart).

> The `<Dial action>` URL (`/dial-result`) is set by our TwiML at runtime — you don't configure it in the console.

---

## 6. Credentials to hand me

Paste these into `apps/portal/.env.local` (I'll provide the exact template and `.env.example`). **Do not** commit `.env.local`.

| Env var | Where it comes from | Looks like |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Section 3 | `AC…` |
| `TWILIO_AUTH_TOKEN` | Section 3 | 32-char hex |
| `TWILIO_API_KEY_SID` | Section 4 | `SK…` |
| `TWILIO_API_KEY_SECRET` | Section 4 | shown once |
| `TWILIO_PHONE_NUMBER` | Section 2 | `+1XXXXXXXXXX` (E.164) |

Tell me the tunnel URL each session so I can confirm the webhook config, or update it yourself per Section 5.

---

## 7. Quick verification (after I've wired the code)

1. From your phone, call the local number.
2. You should hear: "Connecting you to the front desk, one moment…" then ringback for ~120s, then an apology, then hang up. (No browser is registered yet in 5a — that's expected; the softphone arrives in 5b.)
3. Check **Console → Monitor → Logs → Calls**: the call appears with its (tiny) price and the request/response.
4. I'll confirm a matching `calls` row landed in local Supabase with `state = NO_ANSWER`.

---

## Checklist

- [ ] Account upgraded (payment method added)
- [ ] Trial 855 released (optional)
- [ ] Local number purchased, noted in E.164
- [ ] Account SID + Auth Token gathered
- [ ] API Key SID + Secret created (Secret saved)
- [ ] Tunnel running, both webhook URLs pointed at it
- [ ] Five env vars handed over / in `.env.local`
