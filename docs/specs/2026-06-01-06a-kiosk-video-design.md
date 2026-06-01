# Plan 6a — Kiosk + Live Video Path Design

- **Status**: Approved (brainstorm complete)
- **Date**: 2026-06-01
- **Spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (§2 video path, §3.3 properties, §3.6 calls, §8 kiosk→portal API surface, §9 UI states)
- **Builds on**: Plan 5b (Agent/Admin softphone + presence) — tag `plan-05b-agent-softphone-complete`
- **Setup guide (deliverable)**: `docs/setup/2026-06-01-agora-video-setup.md` (Agora account + App ID/Certificate — mirrors the Twilio setup doc)
- **Decomposition**: Plan 6 is split into **6a** (this — kiosk + live video), **6b** (playbook upload + display), **6c** (emergency call). Each gets its own spec → plan → build → tag, like 5a/5b.

---

## 0. Provenance note (why this spec is unusually explicit)

Several decisions below — the kiosk info-card layout, the 40/60 agent split, the in-call control set including Hold/Swap/Emergency, and owner-managed config — were agreed in **earlier sessions that never wrote them to any doc, schema, or memory**. They were re-derived from the user's recollection during the 2026-06-01 brainstorm. This spec is the durable record so they are never lost again. The downstream 6b/6c decisions are recorded in §9 for the same reason.

---

## 1. Purpose

Stand up the **video path** end-to-end: a tablet in the hotel lobby (the kiosk) lets an after-hours guest start a video call that the same agent/admin pool answers in the portal, on a split-screen alongside the (empty-for-now) playbook panel. 5a/5b made inbound **audio** answerable; 6a makes inbound **video** answerable.

6a ends with a demoable, real **kiosk → agent two-way video call**. The playbook content (6b) and the Emergency action (6c) are explicitly deferred; their UI seams are reserved here.

---

## 2. Scope

**In:**

- **Kiosk app** (`apps/kiosk/`, Vite SPA, tablet-locked, no auth, no Supabase creds): info-card home screen (K-01), recording disclosure (K-02), ringing (K-03), connected (K-04), ended (K-05), no-answer apology (K-08). Agora WebRTC client.
- **Kiosk identity**: per-property signed config token carried in the kiosk URL, stored locally, sent on every portal API call.
- **Portal API surface** (kiosk has no backend of its own): `/api/agora/token`, `/api/kiosk/call-started`, `/api/kiosk/call-ended`, `/api/kiosk/heartbeat`. All service-role writes behind config-token verification.
- **Agent/admin incoming-video**: poll-based incoming-video banner for eligible call-takers + accept (first-wins race), via `/api/calls/[id]/answer-video`. Agora join on accept.
- **Agent connected view**: 40% guest video (self-PiP) / 60% playbook panel (empty-state in 6a), control bar (Mute · Cam off · Hold/Swap disabled placeholders · Emergency stub → 6c · End), Room # + Notes (reusing the 5b `/api/calls/notes` route).
- **Migration 0007**: 6 new `properties` columns for the kiosk info card.
- **Kiosk setup/launch checklist** (`docs/setup/`): nightly launch, camera/mic pre-grant, config-token install, orientation lock.

**Out (deferred / forward-compat preserved):**

- **Playbook upload + display** — Plan 6b. The 60% panel renders an empty-state in 6a.
- **Emergency call** (conferencing + on-call alert + incident logging) — Plan 6c. The button renders and opens a "coming soon" notice; no telephony in 6a. See §9.2.
- **Hold / Swap** — depend on the locked-cut "held-call slot." Rendered as **disabled placeholders** with a tooltip; real multi-call machinery is a later plan. See §3.7.
- **Owner self-service editing of kiosk info / playbook upload** — Plan 7 (owner portal). 6a adds the schema + kiosk *reads/displays*; values are **seeded via SQL** for 6a build/test. See §3.2.
- **Call recording** (Agora Cloud Recording) — not in v1. The K-02 disclosure ("may be recorded") is shown now (honest, harmless); real recording — for both audio and video paths — is a dedicated future slice. Schema (`calls.recording_url`, `recording_sid`) already ready.
- **Kiosk provisioning UI** — generating/rotating a kiosk config token from the portal is a small admin tool; for the pilot the token is minted manually (script/SQL). See §3.3.

---

## 3. Locked Decisions

### 3.1 Kiosk home (K-01) — owner info card + auto-sizing call button

The top of the screen is an **owner-maintained info card**; the call button fills whatever vertical space remains. **Every field is optional and a blank field does not render** — so the button grows to fill the freed space (flex layout, the button is `flex:1` under the card).

Fixed v1 field set (eight), mapped to `properties`:

| Card element | Column | Status |
|---|---|---|
| Logo | `logo_url` | exists |
| Welcome heading | `kiosk_welcome_heading` | **new** (defaults to `Welcome to {name}` if null) |
| Welcome message | `kiosk_welcome_message` | exists |
| Check-in time | `kiosk_checkin_time` | **new**, free text |
| Check-out time | `kiosk_checkout_time` | **new**, free text |
| WiFi network | `kiosk_wifi_network` | **new**, free text |
| WiFi password | `kiosk_wifi_password` | **new**, free text |
| Breakfast hours | `kiosk_breakfast_hours` | **new**, free text |

All new fields are **free text** (handles "7–10 AM weekdays, 8–11 weekends", "3:00 PM", etc.). A flexible custom-rows list is explicitly deferred — addable later via a `kiosk_info_rows` JSONB column without touching the fixed ones. WiFi password on a lobby screen is accepted as intended after-hours guest convenience.

### 3.2 Config editing is owner-owned; 6a seeds, Plan 7 builds the UI

The info-card fields and the playbook are the **owner's** to manage — they know their property best — and that editing/upload UI belongs to the **owner portal (Plan 7)**. 6a therefore:

- adds the schema (migration 0007) and makes the **kiosk read/display** the fields;
- **does not** add an editing UI in either the admin or owner portal;
- relies on **manual SQL seeding** of the kiosk info fields for 6a build/test (consistent with the project's existing manual-seed workflow).

This was an explicit choice (chosen over pulling owner-portal forms forward into 6a) to keep 6a focused on the genuinely new surfaces — the kiosk and the agent split-screen — and to keep the safer, smaller implementation. Plan 7 adds owner self-service editing of these fields + playbook upload as named owner-portal scope.

### 3.3 Kiosk identity — per-property signed config token

The kiosk holds **no Supabase credentials**. It is identified by a per-property **signed config token** (`property_id` + signature, e.g. HMAC with a server secret, or a signed JWT). Flow:

- The token is delivered in the **kiosk URL** at setup (`https://lobby-connect-kiosk.vercel.app/?t=<token>`), read once, and persisted to `localStorage`; the URL param is then cleared.
- The kiosk sends the token (header or body) on **every** `/api/kiosk/*` and `/api/agora/token` call.
- Each portal route **verifies the signature and extracts `property_id`** server-side before doing anything. Invalid/expired token → 401.

For the pilot the token is minted **manually** (a small script / SQL using the server secret). A portal admin tool to generate/rotate kiosk tokens is deferred (noted in §2 Out). `lib/kiosk/config-token.ts` holds pure `signKioskToken()` / `verifyKioskToken()` helpers (unit-tested) so the route is a thin wrapper and the future admin tool reuses the same signer.

### 3.4 Kiosk call flow (state machine)

| Screen | What happens |
|---|---|
| **K-01 Home** | Info card + "Talk to the Front Desk" button (idle/default). |
| **K-02 Recording notice** | Centered dialog "Calls may be recorded for training purposes." Single **OK**. No other choice. |
| → on OK | GET `/api/agora/token` → join Agora channel (publisher) → POST `/api/kiosk/call-started` (INSERT `calls`, `channel=VIDEO`, `state=RINGING`, `agora_channel_name`). A **120s timeout starts internally**. |
| **K-03 Ringing** | Guest self-preview, "Ringing the front desk…" pulse. Controls: **Mute · Camera off · Cancel**. **No timer shown anywhere.** |
| **K-04 Connected** | Agent joins channel → full-screen agent video, guest self in PiP. Controls: **End Call · Mute · Camera off**. No timer. |
| **K-05 Ended** | Either side ends → "Thanks — hope we helped!" (~4s) → POST `/api/kiosk/call-ended` (`COMPLETED`) → back to K-01. |
| **K-08 No answer** | Internal 120s elapses, nobody joined → owner `kiosk_apology_message` + `property_phone_number` (appended if non-null) → POST `/api/kiosk/call-ended` (`NO_ANSWER`) → auto-home after 10s. |

**No countdown is ever visible to the guest.** The 120s is internal only and drives the K-08 transition.

Camera/mic permission is **not** requested in-flow — it is pre-granted on the kiosk device (Chrome persists the grant per origin) as part of the nightly **setup/launch checklist**, not a screen. Fallbacks: Agora fails to start, network drops mid-call, or media is somehow unavailable → fall through to **K-08** apology → home (per architecture §9.2). No guest-facing permission UI.

### 3.5 Incoming-video routing — poll + first-to-accept-wins

There is **no Twilio parallel-dial for video** (that's the audio path). Instead:

- **Eligible call-takers** for a property = the **primary agent** (active assignment) + **admins with `accepting_calls=true`** for that property — the same pool 5a's audio routing targets (`lib/voice/planDial` defines this set; reuse its query shape).
- Each eligible call-taker's portal **polls for `RINGING` VIDEO calls** for their properties on the existing **20s cadence + refetch-on-focus** (reusing 5b's polling pattern) and shows an **incoming-video banner**.
- **First to accept wins** via `/api/calls/[id]/answer-video`: session-verified, same-`operator_id`, then an optimistic `RINGING → IN_PROGRESS` update **guarded by `.eq("state","RINGING")`** — the loser gets **409** (identical race pattern to 5b's `/api/twilio/voice/answered`). On success: set `handled_by_user_id`, `answered_at = now`, answerer `status = ON_CALL`.
- The accepting call-taker then GETs `/api/agora/token` for that channel and joins; video flows.

Polling latency (≤20s) is acceptable for v1 (locked realtime decision). A future enhancement (Agora `remote-user-joined` SDK signal / Supabase subscription) can tighten it with no schema change.

### 3.6 Agent connected view — 40 / 60 split

- **Left 40%**: guest video, with the agent's **self-preview as a small PiP** inside the guest tile.
- **Right 60%**: playbook panel — **empty-state in 6a** ("No playbook uploaded yet"); 6b renders the PDF here. The 60/40 weighting (playbook the larger surface) is the locked decision; video on the **left**.
- **Control bar**: `Room #` · `Notes` · **Mute** · **Cam off** · **Hold** (disabled) · **Swap** (disabled) · **Emergency** (stub → 6c) · **End**.
- Room # / Notes **reuse the 5b `/api/calls/notes` route** (saves `room_number` + `notes` scoped to `handled_by_user_id` on hangup). No new notes route.
- The connected view is a **full-screen overlay** that opens when a video call is accepted (desktop-first, 1280px target). The compact 5b softphone widget continues to own the **audio** path unchanged; video is a distinct surface. The **incoming-video banner renders in the dashboard chrome** next to the softphone widget (so both call types announce in one place), while the in-call video experience is its own `<VideoCall/>` component mounted in both the `(agent)` and `(admin)` layouts.

### 3.7 Hold / Swap — disabled placeholders (Option A)

Hold and Swap let an agent juggle two calls — precisely the **"held-call slot" that CLAUDE.md cuts from v1** (schema-ready for later). They are rendered in the control bar **disabled, with a "coming soon" tooltip**, so their final position is fixed and adding behavior later is non-disruptive. Real multi-call machinery (hold signaling to the guest/kiosk, a second incoming path, swap state) is a later plan. Chosen over (b) un-cutting the held-call slot now (roughly doubles agent-side complexity) and (c) omitting the buttons entirely.

### 3.8 Agora tokens (`/api/agora/token`)

- **Auth**: kiosk calls authenticate via the **config token** (§3.3); agent/admin calls authenticate via the **Supabase session** (must be an eligible call-taker for that call's property).
- **Token**: an Agora RTC token scoped to the call's `agora_channel_name`, generated with the Agora Node library (works natively on Vercel Functions). 1-hour expiry. Publisher role for both kiosk and the answering agent (two-way A/V). Per-joiner `uid`.
- **Credentials**: `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` (the `.env.example` placeholders; gathered via the new Agora setup guide). `lib/agora/token.ts` holds the pure token-build helper (unit-tested); the route is a thin wrapper.

---

## 4. Architecture & Components

```
apps/kiosk/                              ← Vite SPA, tablet-locked, no auth, no Supabase
  src/
    App.tsx                              ← state machine: K-01 → K-02 → K-03 → K-04 → K-05/K-08
    screens/{Home,RecordingNotice,Ringing,Connected,Ended,Apology}.tsx
    lib/
      config.ts                          ← read/persist config token from URL → localStorage
      portal-api.ts                      ← typed fetch wrappers for /api/kiosk/* + /api/agora/token
      agora.ts                           ← Agora client join/leave/publish/subscribe (dynamic import)
    index.css                            ← kiosk tokens (light theme)

apps/portal/
  app/
    api/
      agora/token/route.ts               ← Agora RTC token (kiosk: config-token auth · agent: session auth)
      kiosk/
        call-started/route.ts            ← INSERT calls (VIDEO/RINGING, agora_channel_name)
        call-ended/route.ts              ← UPDATE calls (terminal state, ended_at, duration_seconds)
        heartbeat/route.ts               ← kiosk liveness (v1: audit/no-op; see §6)
      calls/[id]/answer-video/route.ts   ← RINGING→IN_PROGRESS first-wins (409 on race) + ON_CALL
    (agent)/...                          ← incoming-video banner + mount video call view
    (admin)/...                          ← same, for accepting admins
  components/
    video-call/                          ← shared client: incoming banner, 40/60 connected view, controls
  lib/
    kiosk/config-token.ts                ← pure sign/verify (HMAC or signed JWT)
    agora/token.ts                       ← pure Agora token build
    voice/planDial.ts                    ← reused: eligible call-taker set (primary + accepting admins)

supabase/migrations/
  0007_kiosk_info_fields.sql             ← +6 properties columns
```

**Data flow (happy path):**

1. Guest taps **Talk to the Front Desk** (K-01) → **K-02** recording notice → taps **OK**.
2. Kiosk GETs `/api/agora/token` (config-token auth) → joins Agora channel → POSTs `/api/kiosk/call-started` → `calls` row (`VIDEO`/`RINGING`/`agora_channel_name`). Internal 120s starts. Kiosk shows **K-03**.
3. Eligible call-takers' portals poll, see the `RINGING` video call → **incoming-video banner**.
4. First to **Accept** → `/api/calls/[id]/answer-video` (`RINGING→IN_PROGRESS`, `handled_by`, `answered_at`, `ON_CALL`; 409 to losers) → GETs `/api/agora/token` (session auth) → joins channel.
5. Kiosk sees remote user join → **K-04**; agent sees **40/60 connected view**. Two-way A/V. Agent types Room #/Notes.
6. Either side ends → kiosk **K-05** + POSTs `/api/kiosk/call-ended` (`COMPLETED`, duration); agent view closes, Room#/Notes saved via `/api/calls/notes`, `status → AVAILABLE`. Kiosk returns to **K-01**.
7. **No accept within 120s** → kiosk **K-08** apology (10s) + POSTs `call-ended` (`NO_ANSWER`) → **K-01**.

---

## 5. State & call-state ownership

- **Kiosk owns** ring-in (`call-started`) and finalization (`call-ended`) for the **video** path — symmetric to how 5a's webhooks own the audio path. The kiosk is the source of truth for "call ended" because it is the always-present party (the guest's device).
- **Agent answer** (`answer-video`) owns only the `RINGING → IN_PROGRESS` transition + `handled_by`/`answered_at`/`ON_CALL`, mirroring 5b's audio `/answered`.
- **Race safety**: the `.eq("state","RINGING")` guard makes accept idempotent and single-winner. If the kiosk has already moved the call to a terminal state (guest cancelled at K-03), a late accept finds no `RINGING` row → 409 → banner clears.
- **Duration**: computed on `call-ended` from `answered_at`→`ended_at` (or null if never answered). Reuse 5a's duration helper if present.

---

## 6. Kiosk heartbeat (v1 = minimal)

`/api/kiosk/heartbeat` is POSTed by the kiosk ~every 30s (config-token auth). v1 keeps it **simple**: update an in-memory/last-seen marker only as needed for the future status page — per architecture §8 it may log to audit or be a near-no-op. **No new table in 6a.** A `kiosks` table with `last_seen_at` for a "kiosk offline" indicator is a deferred enhancement (forward-compat: the route exists and is the single place to add the write).

---

## 7. Testing

- **Pure helpers first (TDD)**: `lib/kiosk/config-token.ts` (sign/verify round-trip, tamper rejection, expiry), `lib/agora/token.ts` (claim/channel/role/expiry assembly), and any kiosk-flow reducer (state transitions K-01…K-08, 120s timeout, cancel) get Vitest unit tests before wiring.
- **Routes**: `agora/token`, `kiosk/call-started`, `kiosk/call-ended`, `calls/[id]/answer-video` get mocked-client tests in the 5a/5b style (mock `@/lib/supabase/*`, session/config-token). Cover the auth split (config-token vs session), the `RINGING` race (409), and same-`operator_id` guards.
- **Kiosk app**: component/reducer tests for the state machine; the Agora client is dynamically imported and mocked (never at module top — SSR/test crash, same rule as the Twilio SDK in 5b).
- **Gates**: `pnpm test && pnpm lint && pnpm typecheck && pnpm build` green across both apps.
- **Live smoke (the real check)**: a real kiosk (or kiosk URL with a valid config token) starts a call; a second browser logged in as the primary agent answers; two-way video confirmed; `calls` row goes `RINGING → IN_PROGRESS → COMPLETED` with `handled_by`/`answered_at`/`duration`; a no-answer run confirms `NO_ANSWER` + K-08. Requires `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE` in `apps/portal/.env.local` (and the kiosk's Agora App ID).

---

## 8. Migration

`0007_kiosk_info_fields.sql` — add six nullable text columns to `properties`:

```sql
alter table properties
  add column if not exists kiosk_welcome_heading text,
  add column if not exists kiosk_checkin_time   text,
  add column if not exists kiosk_checkout_time  text,
  add column if not exists kiosk_wifi_network   text,
  add column if not exists kiosk_wifi_password  text,
  add column if not exists kiosk_breakfast_hours text;
```

All nullable, no defaults (blank = not rendered on the kiosk). `kiosk_welcome_heading` falls back to `Welcome to {name}` in the kiosk render layer when null. Committed before applied; local-only, consistent with 0001–0006. RLS: these are read by the kiosk via service-role routes (kiosk has no direct DB access) and by the owner in Plan 7 — no new policy needed in 6a beyond existing `properties` read policies. Update `packages/shared` Supabase types.

---

## 9. Downstream sub-phases — recorded decisions (do not lose again)

### 9.1 Plan 6b — Playbook

- **Owner-uploaded** (owner portal, Plan 7 owns the *owner* upload UI; but the *display* + signed-URL issuance + storage wiring is **6b**). Storage bucket `playbooks/` (private, signed URLs only — already in the schema/architecture §7).
- `properties.playbook_pdf_url` + `playbook_version` already exist; 6b uses them. Versioning: bump `playbook_version` on re-upload.
- **Display**: PDF viewer in the agent connected view's **60% right panel** (replacing 6a's empty-state). Signed URL (1hr) minted by a portal route when the agent opens it during a call.
- For 6a/6b build/test, a test playbook is uploaded to Storage manually; owner self-service upload UI is Plan 7.

### 9.2 Plan 6c — Emergency call (must-have; full design deferred to 6c)

Reference UX (from an earlier brainstorm screenshot): a confirmation dialog **"Trigger emergency response?"** → Cancel / **Yes — trigger emergency**, listing the actions. On confirm, 6c must:

1. **Conference in emergency services** so the agent stays on with the guest (the screenshot says "Dial 911 via conference").
2. **Alert the property's on-call manager** via SMS + call.
3. **Log a high-priority incident.**

**Two safety/architecture caveats parked for 6c design (must be resolved there):**

- **Remote-agent geography**: a literal "911" from the agent's Twilio leg reaches the *agent's* PSAP, not the hotel's — wrong jurisdiction. 6c almost certainly needs a **per-property configured local emergency number** (new property field) so the correct dispatcher is reached. Generic 911 only works if the agent is co-located.
- **Kiosk guest has no PSTN leg**: a true three-way *audio merge* of guest (Agora) + emergency services (PSTN) + agent is non-trivial. Realistic v1 shape: the agent is conferenced with emergency services (Twilio) while the guest stays on the video call and the agent relays — versus building an Agora↔PSTN bridge. Decide in 6c.

6a renders the **Emergency button** but it opens only a "coming soon in 6c" notice — **no telephony in 6a**.

---

## 10. Forward-compat seams

| Future feature | Seam left in 6a |
|---|---|
| Playbook (6b) | 60% right panel is an empty-state component; PDF viewer drops in. No layout change. |
| Emergency (6c) | Button + confirm-dialog slot exist in the control bar; wire telephony behind them. |
| Hold / Swap (held-call slot) | Disabled buttons already positioned; add multi-call state + signaling later. |
| Owner config UI (Plan 7) | Schema (0007) + kiosk read path exist; Plan 7 adds owner-portal forms that write the same columns. |
| Tighter incoming-video latency | Poll-based now; add Agora `remote-user-joined` / Supabase subscription with no schema change. |
| Kiosk provisioning UI | `signKioskToken()` is a reusable pure helper; an admin "generate kiosk link" tool calls it later. |
| Kiosk liveness indicator | `/api/kiosk/heartbeat` exists; add a `kiosks.last_seen_at` write + status-page tile later. |
| Call recording | K-02 discloses it; `calls.recording_url`/`recording_sid` ready; wire Agora + Twilio recording in a dedicated slice. |
```
