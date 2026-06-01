---
name: project-status
description: Current build phase, completed tasks, and what to do next
metadata:
  type: project
---

## Last completed plan: 6a — Kiosk + Live Video

**Tag:** `plan-06a-kiosk-video-complete`
**Smoke confirmed:** kiosk K-01→K-04 flow, agent 40/60 overlay, two-way video, Room#/notes saved, calls row RINGING→IN_PROGRESS→COMPLETED with answered_at/ended_at/duration_seconds. CORS fix applied (next.config.ts).

**Known follow-up bugs (not blocking 6b):**
- Agent-side Mute/Camera controls don't toggle correctly
- Guest camera-off button affects agent video instead of guest's own camera

### All tasks complete

| Task | Commit subject | Status |
|---|---|---|
| T1 | chore(6a): add agora deps + kiosk/agora env scaffolding | done |
| T2 | feat(6a): migration 0007 — kiosk info-card fields + shared types | done |
| T3 | feat(6a): kiosk config-token sign/verify (HMAC, pure) | done |
| T4 | feat(6a): agora RTC token builder + creds getter | done |
| T5 | feat(6a): GET /api/kiosk/config — kiosk info card data | done |
| T6 | feat(6a): POST /api/kiosk/call-started — insert VIDEO/RINGING call | done |
| T7 | feat(6a): POST /api/kiosk/call-ended — finalize video call | done |
| T8 | feat(6a): POST /api/kiosk/heartbeat — minimal liveness | done |
| T9 | feat(6a): GET /api/agora/token — dual-auth RTC token minting | done |
| T10 | feat(6a): GET /api/calls/incoming-video — dashboard poll source | done |
| T11 | feat(6a): POST /api/calls/[id]/answer-video — first-wins claim | done |
| T12 | feat(6a): kiosk call-state reducer (pure) | done |
| T13 | feat(6a): kiosk lib — config token, portal API, Agora client | done |
| T14 | feat(6a): kiosk screens (K-01..K-08) + App state wiring | done |
| T15 | feat(6a): agent incoming-video banner + 40/60 video-call overlay | done |
| T16 | feat(6a): mount VideoCallHost in agent + admin portals | done |
| T17 | docs(6a): Agora + kiosk setup guide | done |
| T18 | fix(6a): CORS headers + smoke confirmed + tag | done |

### Files created/modified in 6a

```
apps/portal/
  next.config.ts                          — CORS headers for kiosk routes
  package.json                            — + agora-token, agora-rtc-sdk-ng
  lib/kiosk/config-token.ts               — HMAC sign/verify + secret getter
  lib/agora/config.ts                     — getAgoraCredentials()
  lib/agora/token.ts                      — buildRtcPublisherToken()
  app/api/kiosk/config/route.ts
  app/api/kiosk/call-started/route.ts
  app/api/kiosk/call-ended/route.ts
  app/api/kiosk/heartbeat/route.ts
  app/api/agora/token/route.ts
  app/api/calls/incoming-video/route.ts
  app/api/calls/[id]/answer-video/route.ts
  app/(agent)/layout.tsx                  — + VideoCallHost
  app/(admin)/layout.tsx                  — + VideoCallHost
  components/video-call/
    incoming-video-banner.tsx
    video-call.tsx
    video-call-host.tsx
apps/kiosk/
  .env.example
  tsconfig.json                           — + vite/client types
  src/types.ts
  src/lib/config.ts
  src/lib/portal-api.ts
  src/lib/agora.ts
  src/state/call-machine.ts
  src/screens/{Home,RecordingNotice,Ringing,Connected,Apology}.tsx
  src/App.tsx                             — full rewrite
  src/index.css                           — + kiosk theme tokens
packages/shared/src/supabase-types.ts    — + 6 kiosk info columns
supabase/migrations/0007_kiosk_info_fields.sql
docs/setup/2026-06-01-agora-video-setup.md
docs/specs/2026-06-01-06a-kiosk-video-design.md
docs/plans/2026-06-01-06a-kiosk-video.md
```

---

## Current: Plan 6b — Playbook (PDF viewer)

**Why:** Kiosk + video path is live. 6b adds the playbook panel: PDF upload (owner portal, Plan 7 provides the UI — 6b wires the backend + display).

| Sub-phase | Scope | Status |
|---|---|---|
| **6a** | Kiosk app, video call path, agent overlay, migration 0007 | **complete** `plan-06a-kiosk-video-complete` |
| **6b** | Playbook — signed-URL route + PDF viewer in the 60% panel | not started |
| **6c** | Emergency call — conference + alert on-call manager + incident log | not started |

**Next:** Plan 6b spec + plan, then implement.
**After 6:** Plan 7 — Owner portal (mobile-responsive), incl. kiosk info field editing + playbook upload.
