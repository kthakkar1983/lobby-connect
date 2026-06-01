---
name: project-status
description: Current build phase, completed tasks, and what to do next
metadata:
  type: project
---

## Last completed plan: 5b — Agent/Admin Softphone + Presence

**Tag:** `plan-05b-agent-softphone-complete`
**Smoke confirmed:** real call answered in browser, IN_PROGRESS → COMPLETED, room#/notes saved, presence sweep to OFFLINE working.

### All tasks complete

| Task | Commit subject | Status |
|---|---|---|
| T1 | feat(5b): browser voice SDK + twilio API-key credentials getter | done |
| T2 | feat(5b): migration 0006 — add AWAY to profiles.status | done |
| T3 | feat(5b): pure presence helpers (staleness, live-status guard, login default) | done |
| T4 | feat(5b): pure canAnswer guard | done |
| T5 | feat(5b): pass callId to the browser via TwiML `<Client><Parameter>` | done |
| T6 | feat(5b): /api/twilio/token — incoming-only voice access token | done |
| T7 | feat(5b): /api/presence — heartbeat + Ready/Away writes | done |
| T8 | feat(5b): /api/twilio/voice/answered — answer transition + ON_CALL | done |
| T9 | feat(5b): /api/calls/notes — save room# + notes | done |
| T10 | feat(5b): OFFLINE sweep cron + every-minute Vercel schedule | done |
| T11 | feat(5b): shared softphone client component | done |
| T12 | feat(5b): agent shell + dashboard + softphone mounted in both portals | done |
| T13 | Full suite (121 tests, 26 files) + live two-browser smoke | done |
| T14 | git tag plan-05b-agent-softphone-complete + memory update | done |

### Files created/modified in 5b

```
apps/portal/lib/twilio/config.ts          — extended: getTwilioApiCredentials()
apps/portal/lib/twilio/token.ts           — buildVoiceAccessToken()
apps/portal/lib/voice/presence.ts         — isStale, isLiveStatus, constants
apps/portal/lib/voice/call-state.ts       — canAnswer()
apps/portal/lib/voice/twiml.ts            — extended: callId in IncomingTwimlOpts
apps/portal/app/api/twilio/token/route.ts
apps/portal/app/api/twilio/voice/incoming/route.ts  — extended: .select("id").single() + callId
apps/portal/app/api/twilio/voice/answered/route.ts
apps/portal/app/api/presence/route.ts
apps/portal/app/api/calls/notes/route.ts
apps/portal/app/api/cron/mark-stale-offline/route.ts
apps/portal/components/softphone/softphone.tsx
apps/portal/app/(agent)/layout.tsx        — header shell + softphone sidebar
apps/portal/app/(agent)/agent/page.tsx    — two-region layout (video slot reserved)
apps/portal/app/(admin)/layout.tsx        — softphone panel added
apps/portal/vercel.json                   — crons: mark-stale-offline every minute
packages/shared/src/supabase-types.ts     — ProfileStatus: added AWAY
supabase/migrations/0006_status_away.sql
```

---

## Current: Plan 6 — decomposed into 6a / 6b / 6c (brainstorm complete 2026-06-01)

**Why before owner portal (7):** call views show audio+video from day one (roadmap reordered 2026-05-31).

**Prereq:** Agora account + creds (`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`). User has an Agora account; needs the setup guide (`docs/setup/2026-06-01-agora-video-setup.md`, a 6a deliverable) — create a **new dedicated "Lobby Connect" project in secured mode** (App ID + App Certificate / token auth).

| Sub-phase | Scope | Status |
|---|---|---|
| **6a** | Kiosk app (Vite, Agora client, info-card home + call flow K-01→K-08), kiosk config-token identity, `/api/agora/token` + `/api/kiosk/{call-started,call-ended,heartbeat}`, agent incoming-video (poll + first-wins) + 40/60 split-screen (Mute/Cam/End; Hold/Swap disabled placeholders; Emergency stub), migration 0007 (6 kiosk info cols). **Playbook panel = empty-state.** | **Spec written + awaiting user review:** `docs/specs/2026-06-01-06a-kiosk-video-design.md`. Plan not yet written. |
| **6b** | Playbook — display (PDF viewer in the 60% panel) + signed-URL route + Storage wiring. (Owner *upload UI* is Plan 7.) | not started |
| **6c** | Emergency call — confirm dialog → conference emergency services (agent stays on) + alert on-call manager (SMS+call) + log incident. **Two parked caveats:** remote-agent 911 geography → per-property local emergency number; Agora guest has no PSTN leg. | not started |

**Decisions recovered this session (were agreed verbally in old sessions, never written — now in the 6a spec §0/§3/§9):** kiosk owner info-card (8 fixed fields, blank=hidden, auto-sizing button), no on-screen timer, K-02 recording disclosure, 40/60 video-left/playbook-right split, full control set incl. Hold/Swap (deferred) + Emergency (6c, must-have), config is **owner-owned** (owner portal, Plan 7) — 6a seeds via SQL, no recording in v1 (disclosure only).

**After 6:** Plan 7 — Owner portal (mobile-responsive) — incl. owner editing of kiosk info fields + playbook upload.
