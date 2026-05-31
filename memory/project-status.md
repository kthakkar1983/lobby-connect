---
name: project-status
description: Current build phase, completed tasks, and what to do next
metadata:
  type: project
---

## Current plan: 5b — Agent/Admin Softphone + Presence

**Spec:** `docs/specs/2026-05-31-05b-agent-softphone-design.md`
**Plan:** `docs/plans/2026-05-31-05b-agent-softphone.md`
**Builds on tag:** `plan-05a-voice-backend-complete` (smoke-confirmed `t13-smoke-confirmed`)

### Tasks completed (committed to local main, NOT pushed)

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

### Tasks remaining

- **T10** — `/api/cron/mark-stale-offline` + Vercel cron schedule (`vercel.json` + `.env.example`)
- **T11** — Softphone client component (`components/softphone/softphone.tsx`); typecheck + lint only, no unit test
- **T12** — Mount softphone in agent layout + agent dashboard page + admin layout; typecheck + lint + `pnpm build`
- **T13** — Full suite (`pnpm test && pnpm lint && pnpm typecheck && pnpm build`) + live two-browser smoke (real call, Twilio webhook, CRON_SECRET check). Note: confirm `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` are set in `apps/portal/.env.local` before this task.
- **T14** — `git tag plan-05b-agent-softphone-complete` + update this memory file

### New files created so far (5b)

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
supabase/migrations/0006_status_away.sql
```

### Key implementation notes

- `@twilio/voice-sdk` added to `apps/portal/package.json` (browser-side, dynamic import only inside `useEffect` to avoid SSR crash)
- `getTwilioApiCredentials()` validates `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` separately from `getTwilioConfig()` (which only covers 5a webhooks)
- TwiML now uses `<Client><Identity>lc_x</Identity><Parameter name="callId" value="…"/></Client>` form; browser reads via `call.customParameters.get("callId")`
- Presence heartbeat: browser POSTs to `/api/presence` every 20s with `{ status }`. Cron sweeps stale rows to OFFLINE (STALE_AFTER_MS = 90_000ms)
- Answer race guard: `/api/twilio/voice/answered` checks `canAnswer(call.state)` then does a conditional `.eq("state","RINGING")` update — second answerer gets 409

### Next plan after 5b

**Plan 6 — Kiosk + agent video split-screen + playbook**
Prereq: Agora account + creds (`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`). Flag at start of that session.

**Why:** Roadmap reordered 2026-05-31 — kiosk (6) before owner portal (7) so call views show audio+video from day one.
