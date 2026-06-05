# Lobby Connect — v1 Pilot End-to-End Smoke Test

**Purpose:** validate the deployed pilot end-to-end before the hotel relies on it. This is the
**final launch step** — provisioning (Supabase + Vercel + Twilio) is already done.

**Status when this was written (2026-06-04):** prod Supabase live (migrations `0001`–`0011` + bootstrap
applied), Supabase Auth Site URL + redirect URLs set, both apps deployed green on Vercel with full prod env,
Twilio voice webhook repointed. Admin sign-in confirmed working.

**Progress (2026-06-05):** §1 seed, §2 RBAC, §4 kiosk video **PASS**. Plan 9 stuck-user recovery validated
in prod (both users reset → onboarding → signed in). **§3 voice** initially hit "no one is available" — root
cause was a `routing_did` mismatch (property had `+14058610196`; the account's only Twilio number is
`+14058750410`), now **corrected on prod**. (The Twilio error 11200 seen in logs was historical — the live
webhook already points at the clean `lobby-connect-portal.vercel.app`, not the deployment-protected alias.)
A **sign-out** bug from the user-menu dropdown was also fixed + deployed (`d52f6be`). **Still to run:** retest
§3 voice *connect* (agent signed in to answer), §5 emergency (933-only), §6 owner, §7 observability.

**Live URLs**
- Portal: `https://lobby-connect-portal.vercel.app`
- Kiosk: `https://lobby-connect-kiosk.vercel.app`
- Admin login: the email/password created during prod bootstrap (Supabase Auth → Users).

---

## ⚠️ Read first — two safety/expectation notes

1. **EMERGENCY TEST USES 933, NEVER 911.** Production env has `EMERGENCY_DIAL_NUMBER=911`, which dials a
   **real PSAP**. To smoke-test the emergency path you must **temporarily** set it to `933` (Twilio's E911
   address-readback test number that never reaches a dispatcher), redeploy, test, then set it back to `911`
   and redeploy. Procedure is in §5. **Do not trigger the emergency button while it is set to 911.**
2. **The `/status` "Presence sweep" card may show amber/red — that is EXPECTED.** The pilot runs the
   presence cron **once daily** (Vercel Hobby limit), and the card is tuned for that, but between daily runs
   it can read stale. Not a failure. (Before public launch: Vercel Pro + per-minute cron — see launch checklist.)

---

## 0. Prerequisites (gather before starting)

- [ ] A **phone** you can call from (your cell) — to place the inbound audio test call.
- [ ] A **laptop/desktop browser** — signed in to the portal (acts as the agent's softphone + dashboard).
- [ ] A **second device or browser** for the kiosk (a tablet ideally; a second browser window works).
- [ ] The **Twilio routing number** for the pilot property (the number whose webhook you just pointed at the portal).
- [ ] Allow **microphone + camera** permissions in both browsers when prompted (required for audio/video).

> Single-operator tip: you can play every role yourself. Assign your **admin** account as the property's
> primary agent (admins are assignable and already have a `twilio_identity`), keep the portal open on the
> laptop, call from your phone, and run the kiosk in a second window.

---

## 1. Seed the pilot data (portal, as admin)

- [ ] Sign in at `https://lobby-connect-portal.vercel.app` as the admin. **Expected:** lands on `/admin`.
- [ ] **(Optional) Invite an agent** — `/admin/users` → Invite → enter an email you control → accept the
      emailed invite → set a password (`/onboarding`). **Expected:** invite email arrives (confirms the
      Supabase Site URL is correct) and the new agent can sign in. *Skip this if you'll use your admin as
      the call-taker.*
- [ ] **Create the pilot property** — `/admin/properties` → New. Set **routing DID = the Twilio number**
      (E.164, e.g. `+1512...`), plus property phone, after-hours phone, and kiosk welcome/apology messages.
      **Expected:** redirects to the property detail page.
- [ ] **Assign a primary agent** — on the property detail page, use the **Assignment** card to assign the
      agent (or your admin). **Expected:** card shows the assigned name.
- [ ] **Generate the kiosk link** — on the same page, **Kiosk device link** card → **Generate kiosk link** →
      **Copy** the URL. **Expected:** a `https://lobby-connect-kiosk.vercel.app/?t=...` URL.

---

## 2. Auth & role access (RBAC)

- [ ] Admin can open `/admin/users`, `/admin/properties`, `/admin/audit`, `/admin/status`. **Expected:** all load.
- [ ] **Negative:** sign in as a non-admin (agent or owner) and try `/admin/audit` and `/admin/status`.
      **Expected:** redirected away (not a 404, not the page).
- [ ] (If an owner exists) owner sign-in lands on the owner portal; agent sign-in lands on the agent dashboard.

---

## 3. Voice path — inbound audio call

**Setup:** sign in to the portal as the assigned agent (or admin) on the laptop and **keep the dashboard
open** (this connects the softphone). Make sure mic permission is granted.

- [ ] **Answer case:** call the Twilio routing number from your phone. **Expected:** you hear the greeting;
      the portal softphone rings; click **Answer** → two-way audio works.
- [ ] Hang up. **Expected (check `/admin/audit` or the DB):** the `calls` row went
      `RINGING → IN_PROGRESS → COMPLETED`, with `handled_by`, `answered_at`, and a non-null `duration_seconds`.
- [ ] **No-answer case:** call again and **don't** answer. **Expected:** after the ring window (~120s) you
      hear the apology message; the `calls` row ends `NO_ANSWER`.

> If the softphone never rings: confirm the agent is signed in with the dashboard open, the property's
> `routing_did` exactly matches the dialed number, and the agent is assigned + active.

---

## 4. Kiosk path — video call

**Setup:** open the **kiosk link** (from §1) on the tablet/second browser. **Expected:** it leaves
"loading…" and shows the kiosk Home screen (it's now paired to the property). Grant camera + mic.

- [ ] Keep the portal open on the laptop as the assigned agent (dashboard visible).
- [ ] **Answer case:** on the kiosk, start a call (tap through the recording notice). **Expected:** the agent
      dashboard shows an **incoming-video banner** → click **Accept** → two-way video in the 40/60 split.
- [ ] On the agent side, enter a **Room #** and a **note** during the call. **Expected:** they save.
- [ ] End the call. **Expected:** `calls` row `RINGING → IN_PROGRESS → COMPLETED` with `duration_seconds`.
- [ ] **No-answer case:** start a kiosk call and don't accept on the agent side. **Expected:** kiosk times
      out to the apology screen; `calls` row ends `NO_ANSWER`.

---

## 5. Emergency path — ⚠️ 933 ONLY

**Never run this while `EMERGENCY_DIAL_NUMBER=911`.** Procedure:

- [ ] In Vercel → portal project → Settings → Environment Variables, set **`EMERGENCY_DIAL_NUMBER=933`**
      (Production), then **redeploy** the portal.
- [ ] Start a kiosk→agent video call (as in §4) and connect it.
- [ ] On the agent's connected view, trigger **Emergency**. **Expected:** a Twilio **Conference** forms
      (guest + agent + the 933 line); you hear the 933 address read-back; an `incidents` row is created
      (visible to admin/owner). Confirm agent mute/leave behaves.
- [ ] **Restore production safety:** set **`EMERGENCY_DIAL_NUMBER=911`** again and **redeploy**. Double-check
      it's back to `911` before considering the pilot live.

---

## 6. Owner portal (optional for pilot, if an owner account exists)

- [ ] Owner signs in on a **phone** → Home glance cards (agent presence, today's count, open-incident badge).
- [ ] Call history shows the test calls (audio + video); a call detail opens.
- [ ] Owner can edit kiosk content, upload a playbook (View opens a signed URL), and resolve an incident.

---

## 7. Observability

- [ ] `/admin/status`: **Supabase** card green; **Recent errors (24h)** shows a count + "View in Sentry"
      link; **Twilio webhook** card flips to "just now" after a test call. (Presence-sweep card amber/red is
      expected on the daily cron — see top note.)
- [ ] `/admin/audit`: lists the actions you performed (`property.created`, `assignment.changed`,
      `property.kiosk_link_generated`, `user.invited`, etc.). The action filter narrows correctly; "Load more" works.
- [ ] **Sentry scrub check:** trigger a deliberate error (e.g. a thrown error in a throwaway action, or note
      one from the testing above), confirm it appears in the Sentry **portal** project, and that the event
      payload contains **no phone number and no recording URL**. Repeat for the **kiosk** project if convenient.

---

## 8. Wrap-up

- [ ] `EMERGENCY_DIAL_NUMBER` is back to **`911`** in prod (if §5 was run).
- [ ] No unexpected errors in Sentry from the smoke run.
- [ ] Note any failures with the exact step + what you saw, for follow-up.

**Known-expected quirks (not failures):** `/status` presence-sweep card amber (daily cron); kiosk shows
"loading…" only if opened without a `?t=` token (re-open the generated link).

**Before public launch (separate from this smoke):** Vercel Pro + restore per-minute cron
(`apps/portal/vercel.json` → `* * * * *` and `CRON_SWEEP_INTERVAL_MS=60_000` in
`apps/portal/lib/status/signals.ts`); consider the kiosk device-registry/token-revocation system for
multi-device/multi-property scale.
