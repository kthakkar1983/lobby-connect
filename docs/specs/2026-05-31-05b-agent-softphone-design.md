# Plan 5b — Agent/Admin Softphone + Presence Design

- **Status**: Approved (brainstorm complete)
- **Date**: 2026-05-31
- **Spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (§4 critical path, §5.1 profiles, §5.6 calls, §6 portal UX)
- **Builds on**: Plan 5a (Backend voice path) — tag `plan-05a-voice-backend-complete`, smoke-confirmed `t13-smoke-confirmed`
- **Setup guide**: `docs/setup/2026-05-30-twilio-voice-setup.md` (Twilio env already gathered in 5a)

---

## 1. Purpose

Make inbound audio calls actually answerable. Plan 5a stood up the server side — Twilio rings the call-taker's browser `<Client>` identity — but no browser registers as that client yet, so every call times out to the apology. 5b builds the **browser softphone**: the access-token route, the Twilio Device, the incoming-call UI, in-call controls, the room#/notes capture, and **presence** (who's online), for **both AGENT and ADMIN** call-takers.

This completes the audio path end-to-end. Video (kiosk) and the playbook panel are Plan 6.

---

## 2. Scope

**In:**

- **Agent shell**: the agent route group is a placeholder today — add the real logged-in frame (header, sign-out, connection/status indicator), mirroring the admin shell.
- **Softphone widget**: one shared client component mounted in **both** the agent dashboard and the admin portal chrome. Connection state, Ready switch (agents), incoming-call banner (Accept/Decline), in-call bar (timer, mute, hang up), room# + notes capture.
- **`/api/twilio/token`**: user-scoped route returning a short-lived Twilio AccessToken + VoiceGrant for the caller's `twilio_identity` (incoming-only).
- **Presence**: a heartbeat (piggybacking the 20s polling) that keeps `status` + `last_seen_at` fresh, and a Vercel Cron sweep that flips stale call-takers to `OFFLINE`.
- **Answer reporting** (`/api/twilio/voice/answered`): the browser reports the accepted call so the record gets `handled_by_user_id`, `answered_at`, and `state = IN_PROGRESS`; presence flips to `ON_CALL`.
- **Migration 0006**: add `'AWAY'` to the `profiles.status` CHECK constraint.

**Out (deferred / forward-compat preserved):**

- **Outbound calling** from the softphone — incoming-only in v1; no TwiML App SID needed yet. Add app SID + outbound later.
- **Video / Agora, playbook panel + upload** — Plan 6. The in-call view reserves the layout region they slot into.
- **Property cards + recent-calls history** on the agent dashboard — independent context panels; small follow-on, not 5b.
- **Ready-gates-routing** — in v1 presence is informational only (locked). The routing webhook is untouched; the future gate is a one-line check (see §3.2).
- **Mobile call experience** — desktop-first (locked decision). Agents are not expected to take calls from cell phones. Emergency mobile *login* may work incidentally, but no call UX is designed or guaranteed for it. Explicit non-goal.

---

## 3. Locked Decisions

### 3.1 Availability model — "Option B" (Ready switch, display-only in v1)

The agent's Ready/Not-ready intent is stored in `profiles.status`, extended with a fourth value **`AWAY`**:

| Situation | `status` | Set by |
|---|---|---|
| Connected + Ready, not on a call | `AVAILABLE` | dashboard heartbeat |
| Connected + switched off | `AWAY` | dashboard heartbeat |
| On a call | `ON_CALL` | answer route (entry) / dashboard (exit) |
| Browser stopped checking in (~90s) | `OFFLINE` | Vercel Cron sweep |

The dashboard re-asserts the chosen state on every heartbeat, so a brief reconnect restores it; the cron only owns the transition *to* `OFFLINE`. **On login the agent defaults to `AVAILABLE`** (zero friction for the pilot). The strict call-center default (`AWAY` until the agent clicks Ready) is a one-line change deferred to scale-time.

Rejected alternative: a separate `ready` boolean column. Folding intent into `status` means the future routing gate is a single field read (`status = 'AVAILABLE'`) and avoids a second source of truth that can drift from the displayed light.

### 3.2 Presence is informational in v1; routing untouched

Per the architecture spec, `status` drives the "who's online" UI only. The 5a routing webhook still **always** dials the assigned primary agent regardless of status. The forward-compatible upgrade to availability-based routing is a one-line guard in `/incoming` — "include the agent as a dial target only if `status = 'AVAILABLE'`" — done at scale-time when call pools/overflow exist to design around. No schema or UI rework required then.

### 3.3 One softphone widget, both roles, role-aware controls

The widget is a single shared client component mounted in both the agent layout and the admin shell, because 5a routing **already dials accepting admins** — they need a registered Device to ever pick up. The token/Device/incoming-banner/Accept-Decline/in-call-controls/room#/notes core is identical for both roles. The **Ready/Away switch is shown for AGENT only**; ADMIN availability is already controlled per-property via the `admin_call_availability` toggle built in 4c (an admin's per-property "accepting calls"), so the widget shows them connection + `ON_CALL` presence but not a single Ready switch. Both roles heartbeat `last_seen_at`/`status` and are swept to `OFFLINE`.

### 3.4 Token route (`/api/twilio/token`)

- **Auth**: user-scoped (Supabase session). Resolve the caller's profile; require role AGENT or ADMIN with a non-null `twilio_identity`. OWNER or null identity → 403.
- **Token**: Twilio `AccessToken` with a `VoiceGrant` (`incomingAllow: true`, no outgoing app SID — incoming-only), `identity` = the profile's `twilio_identity` (the same `lc_<uuid>` 5a routing dials, via `toTwilioIdentity`). TTL 1 hour; the browser refetches on expiry / Device error.
- **Credentials**: `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (gathered in 5a env) + `TWILIO_ACCOUNT_SID`.

### 3.5 Call lifecycle ownership (clean split with 5a)

5a owns ring-in and finalization; 5b owns the answer transition only:

- **5b answer route** (`/api/twilio/voice/answered`): browser POSTs the call id (received as a `<Client>` parameter, see §3.6) when it accepts → verify session + same `operator_id` + call is `RINGING` → set `state = IN_PROGRESS`, `handled_by_user_id`, `answered_at = now`; set the answerer's `status = ON_CALL`. Writes via service-role client (calls table is service-role-write-only) after verifying the user session.
- **On hangup/disconnect**: the browser reverts the user's `status` from `ON_CALL` → `AVAILABLE`. Call finalization (terminal `state`, `ended_at`, `duration_seconds`) stays owned by 5a's existing `/dial-result` + `/status` webhooks — 5b does not touch them. The `/status` finalizer leaves `answered_at` intact if already set.

### 3.6 Correlating the ring to its record

5a's TwiML builder gets one additive extension: each `<Client>` carries a `<Parameter name="callId" value="<calls.id>"/>` so the browser knows which `calls` row is ringing (Twilio's default connection params expose only the client-leg SID, not the parent record). The 5a builder already isolates `<Client>` construction, so this is a localized change with its own unit test; existing 5a TwiML tests get the new attribute.

### 3.7 Presence mechanics

- **Write path**: `profiles` self-update is restricted to name/password (architecture spec §7 policies), so presence does **not** write `status`/`last_seen_at` from the browser's user-scoped client. Instead a single route **`/api/presence`** (session-verified, then service-role write for the caller's own row) handles both the heartbeat tick and explicit Ready/Away toggles. This mirrors the answer-route pattern and avoids widening profile RLS.
- **Heartbeat**: the dashboard's existing 20s poll tick (and refetch-on-focus) POSTs `/api/presence` with the current intended `status`, updating `last_seen_at = now`. The Ready/Away switch and `ON_CALL`/revert transitions post through the same route.
- **Offline sweep**: `/api/cron/mark-stale-offline` (service role, Node runtime) sets `status = 'OFFLINE'` for profiles whose `last_seen_at` is older than ~90s and not already `OFFLINE`. Scheduled via `vercel.json` cron at `* * * * *` (every minute — Vercel's finest granularity). Idempotent; never logged to the audit table (high-frequency, low-value, per the spec's "what does not get logged").

---

## 4. Architecture & Components

```
apps/portal/
  app/
    (agent)/
      layout.tsx                  ← add header/shell + mount <Softphone/>
      agent/page.tsx              ← real dashboard (in-call region + reserved video/playbook slot)
    (admin)/...                   ← mount <Softphone/> in the admin shell chrome
    api/
      twilio/
        token/route.ts            ← AccessToken + VoiceGrant (user-scoped)
        voice/answered/route.ts   ← answer transition (IN_PROGRESS/handled_by/answered_at)
      presence/route.ts           ← heartbeat + Ready/Away/ON_CALL writes (session-verified, service-role write of own row)
      cron/
        mark-stale-offline/route.ts ← OFFLINE sweep (service role)
  components/
    softphone/                    ← shared client component(s): provider, banner, in-call bar, ready switch
  lib/
    voice/
      identity.ts                 ← reused (toTwilioIdentity)
      twiml.ts                    ← +<Parameter callId> (5a extension)
      presence.ts                 ← pure: deriveStatus(), isStale(), default-on-login
      call-state.ts               ← pure: answer/hangup transition guards
  vercel.json                     ← + cron schedule
supabase/migrations/
  0006_status_away.sql            ← extend profiles.status CHECK with 'AWAY'
```

**Data flow (happy path):**

1. Call-taker opens dashboard → Server Component loads their profile (role, `twilio_identity`) → client `<Softphone/>` GETs `/api/twilio/token` → registers Twilio Device → status set `AVAILABLE`, heartbeat begins.
2. Guest calls → 5a `/incoming` rings the `<Client>` with a `callId` parameter → browser shows banner + ring sound.
3. Agent clicks **Accept** → Device answers → browser POSTs `/api/twilio/voice/answered` with `callId` → record → `IN_PROGRESS`, `handled_by`, `answered_at`; status → `ON_CALL`. Audio connects.
4. In-call: timer, mute, hang up; agent types room# + notes (saved on hangup).
5. Hang up → Device disconnects → 5a `/dial-result`/`/status` finalize the record; browser reverts status → `AVAILABLE`.
6. **Decline** → Device rejects that leg; other rung clients continue; all-decline/timeout → 5a apology.

---

## 5. Testing

- **Pure helpers first (TDD)**: `lib/voice/presence.ts` (status derivation, staleness, login default) and `lib/voice/call-state.ts` (answer/hangup transition guards) get Vitest unit tests before wiring.
- **Token claim building**: a pure helper for the VoiceGrant/identity assembly is unit-tested; the route is a thin wrapper.
- **Routes**: `token`, `answered`, and `mark-stale-offline` get mocked-client tests in the 5a style (mock `@/lib/supabase/*` + session). Signature/role guards covered.
- **TwiML extension**: update 5a `twiml.test.ts` to assert the `callId` parameter; the empty-targets/apology paths stay green.
- **Gates**: `pnpm test && pnpm lint && pnpm typecheck && pnpm build` all green; manual two-browser smoke (one tab answers a real call) as the live check.

---

## 6. Migration

`0006_status_away.sql` — drop and re-add the `profiles.status` CHECK to include `'AWAY'`:

```sql
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('AVAILABLE', 'ON_CALL', 'AWAY', 'OFFLINE'));
```

Committed before applied; local-only (repo unpushed), consistent with 0001–0005. No data backfill needed (default stays `OFFLINE`).

---

## 7. Roadmap reorder (recorded here)

During this brainstorm the post-5b order was changed so the agent dashboard work stays continuous and video is de-risked earlier. New order:

1. **5b** — agent/admin softphone + presence (this plan)
2. **6** — Kiosk + agent video split-screen + playbook (upload + display). New prerequisite: Agora account + credentials (manual setup, mirrors the Twilio setup).
3. **7** — Owner portal (built after video so its call views show both AUDIO and VIDEO from day one).

Safe: nothing in Plans 1–5a depends on the 6-vs-7 order; the `calls` table is already video-ready (`channel`, `agora_channel_name`, `handled_by_user_id`). CLAUDE.md build-status table + `project-status` memory updated to match.

---

## 8. Forward-compat seams

| Future feature | Seam left in 5b |
|---|---|
| Ready gates routing | `status = 'AVAILABLE'` is the single field; add one guard in `/incoming`. |
| Video + playbook (Plan 6) | In-call view is a two-region layout; video feed + playbook drop into the reserved region. No repaint. |
| Outbound calling | VoiceGrant is incoming-only; add a TwiML App SID + outbound UI later. |
| Strict "Away until Ready" default | One-line change to the login-default in `presence.ts`. |
| Property cards / call history | Independent panels; agent dashboard is built to host them later. |
