# Lobby Connect — v1 Pilot Launch Checklist

**Status at time of writing:** v1 is **feature-complete** (Plan 8 was the final build plan). This runbook
takes the pilot from local-only to a live deployment for one hotel.

> **Progress (2026-06-04):** §1 Supabase, §2 Twilio, §4 Vercel deploy, and §5 env are **DONE** — both apps
> are live with full prod env, admin sign-in confirmed. **Remaining: §7 end-to-end smoke**, which now has a
> dedicated complete checklist at `docs/setup/2026-06-04-smoke-test-checklist.md`. See
> `memory/project-status.md` → "PILOT LAUNCH — IN PROGRESS" for the authoritative resume pointer.

**Legend:** 🧑 = you must do this manually (external dashboard/console — Claude has no access) ·
🤖 = Claude can do in-repo · ✅ = already done.

---

## 0. Already done ✅

- All v1 code complete and committed to `main` (migrations `0001`–`0011`, both apps, 252 tests passing).
- Portal Sentry env wired in `apps/portal/.env.local` (DSN + auth token + org/project).
- Kiosk Sentry DSN in hand (paste at deploy — see §5).
- Deploy secrets generated (see §6 — paste pending).
- `apps/portal/vercel.json` already declares the `mark-stale-offline` cron (`* * * * *`).

---

## 1. Provision production Supabase 🧑

1. **Create the project** — Supabase dashboard → New project. Note the region.
2. **Grab credentials** (Settings → API): `Project URL`, `anon` key, `service_role` key.
   These become `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Apply migrations `0001`–`0011`** — either:
   - `supabase link --project-ref <ref>` then `supabase db push` (applies the whole `supabase/migrations/` chain in order), **or**
   - paste each migration file into the dashboard SQL editor in numeric order.
4. **DO NOT run `supabase/seed.sql` as-is.** It inserts fake users straight into `auth.users` and is
   explicitly *local-dev only*. Use the prod bootstrap in the Appendix instead.
5. **Bootstrap the operator + first admin** — after creating the admin via Authentication → Add user,
   run `supabase/bootstrap-prod.sql` (edit the three placeholders first). The admin then invites everyone
   else through the in-app flow. (Full SQL also reproduced in the Appendix below.)
6. **Auth URL config (easy to miss)** — Authentication → URL Configuration → set **Site URL** and the
   **redirect allow-list** to the prod portal URL. Otherwise invite / password-reset emails point at
   `localhost` and the links break.

---

## 2. Twilio (reuse the dev account/number) 🧑

1. Phone Numbers → your pilot number → **Voice webhook** → `https://<prod-portal>/api/twilio/voice/incoming`,
   method **HTTP POST**. (The `dial-result` and `status` callbacks resolve from the request origin, so they
   follow automatically — no separate config.)
2. Confirm the **E911 emergency address** is registered on the number (required for the in-call 911 path).
3. In prod env, set `EMERGENCY_DIAL_NUMBER=911`. **Keep `933` everywhere non-prod** (933 = address-readback
   test, never reaches a PSAP).
4. See `docs/setup/2026-05-30-twilio-voice-setup.md` for the full original setup.

---

## 3. Agora (reuse the existing app) 🧑

No new provisioning — just have `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE` ready to paste into the portal's
Vercel env (the kiosk fetches its video token from the portal, so the kiosk needs no Agora secret).

---

## 4. Deploy to Vercel 🧑

The portal and kiosk are two separate Vercel projects from the same monorepo.

1. **Create both projects**, root directories `apps/portal` and `apps/kiosk`. The portal's build/cron config
   is already in `apps/portal/vercel.json`.
2. **First deploy** both (env can be partially blank — the Sentry SDK and optional vars no-op). This yields
   the two Vercel URLs.
3. **Set env** for each app (§5), including the cross-reference URLs now that both URLs exist.
4. **Redeploy** both so the URL-dependent vars take effect.
5. **Cron** — set to **daily** (`0 8 * * *`) for the Hobby pilot, since Vercel **Hobby caps crons at once
   per day**. The `/status` presence card is tuned to match (warn after 1.5 days, down after 3). The
   dashboard's live availability label may lag (cosmetic only — call routing is unaffected).
   **Before public launch:** move to **Vercel Pro**, set `apps/portal/vercel.json`'s schedule back to
   `* * * * *`, and set `CRON_SWEEP_INTERVAL_MS` in `apps/portal/lib/status/signals.ts` to `60_000`
   (that one constant retunes the `/status` thresholds). Two-line flip.

---

## 5. Environment variable inventory

### Portal (Vercel → portal project → Settings → Environment Variables)

| Var | Need | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ❗ required | from §1 (prod Supabase) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❗ required | from §1 |
| `SUPABASE_SERVICE_ROLE_KEY` | ❗ required | from §1 — mark **sensitive** |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | required | reuse dev values |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | required | reuse dev values |
| `TWILIO_PHONE_NUMBER` | required | the pilot number, E.164 |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` | required | reuse dev values |
| `CRON_SECRET` | required | §6 — gates the cron route |
| `KIOSK_CONFIG_SECRET` | required | §6 — signs kiosk config tokens |
| `EMERGENCY_DIAL_NUMBER` | required | **`911`** in prod only |
| `NEXT_PUBLIC_APP_URL` | set after first deploy | prod portal URL |
| `KIOSK_ORIGIN` | set after first deploy | prod **kiosk** URL — CORS allow-origin |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | ✅ have | portal DSN |
| `SENTRY_AUTH_TOKEN` | ✅ have | mark **sensitive**, server-only |
| `SENTRY_ORG` / `SENTRY_PROJECT` | ✅ have | `lobby-connect` / `portal` |

### Kiosk (Vercel → kiosk project)

| Var | Need | Notes |
|---|---|---|
| `VITE_PORTAL_API_URL` | required | set after first deploy → prod portal URL |
| `VITE_SENTRY_DSN` | ✅ in hand | kiosk DSN |

> **Cross-reference loop:** the portal needs the kiosk's URL (`KIOSK_ORIGIN`) and the kiosk needs the
> portal's URL (`VITE_PORTAL_API_URL`), but neither URL exists until deployed. That's why §4 is
> *deploy → set URLs → redeploy*.

---

## 6. Generated secrets — paste targets

Generated for this launch (also put these in `apps/portal/.env.local` for local parity):

```
CRON_SECRET=<generated — see chat / regenerate with: openssl rand -hex 32>
KIOSK_CONFIG_SECRET=<generated — see chat / regenerate with: openssl rand -hex 32>
```

> Secrets are intentionally **not committed**. Regenerate any time with `openssl rand -hex 32`.

---

## 7. End-to-end smoke (after deploy) 🧑 — **← current step**

The full, self-contained smoke checklist lives in **`docs/setup/2026-06-04-smoke-test-checklist.md`**.
It covers: seeding the pilot property + assignment + kiosk link, auth/RBAC, the audio call path
(answer + no-answer), the kiosk video path, the **933-only** emergency procedure, owner portal, and
observability (`/status`, `/audit`, Sentry scrub check) — with expected results and the daily-cron caveat.

---

## Appendix — prod bootstrap SQL

The canonical, ready-to-run script is **`supabase/bootstrap-prod.sql`** (committed). Run it **after**
migrations `0001`–`0011` and **after** creating the admin via Dashboard → Authentication → Add user. Edit
the three placeholders (`<ADMIN_AUTH_USER_ID>`, `<ADMIN_FULL_NAME>`, `<ADMIN_EMAIL>`) first. It creates the
operator, links the admin profile, sets the admin's `twilio_identity` (so they can take calls), and seeds
the default operator setting — idempotent and safe to re-run.
