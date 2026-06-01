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

## Next plan: 6 — Kiosk + Agent Video Split-Screen + Playbook

**Prereq:** Agora account + creds (`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`). Confirm at start of session.

**Why before owner portal (7):** call views show audio+video from day one (roadmap reordered 2026-05-31).

**Scope:**
- `apps/kiosk/` — Vite SPA, tablet-locked, Agora client, no auth
- Agent dashboard right panel — Agora video feed during a call
- Playbook — upload (admin) + display (agent) during calls
- `/api/agora/token` — Agora RTC token minting

**After 6:** Plan 7 — Owner portal (mobile-responsive).
