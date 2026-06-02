---
name: project-status
description: Current build phase, completed tasks, and what to do next
metadata:
  type: project
---

## Last completed plan: 6a — Kiosk + Live Video

**Tag:** `plan-06a-kiosk-video-complete`
**Smoke confirmed:** kiosk K-01→K-04 flow, agent 40/60 overlay, two-way video, Room#/notes saved, calls row RINGING→IN_PROGRESS→COMPLETED with answered_at/ended_at/duration_seconds. CORS fix applied (next.config.ts).

**Follow-up bugs (both fixed, commit `4967f9a`):**
- ~~Agent-side Mute/Camera controls don't toggle correctly~~ — fixed
- ~~Guest camera-off button affects agent video instead of guest's own camera~~ — fixed
- Root cause: `setMuted()` triggers Agora `user-unpublished` → WebRTC renegotiation drops all streams. Fixed by using `MediaStreamTrack.enabled` directly (no signaling side effects).

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

## Last completed plan: 6b — Playbook (PDF viewer)

**Tag:** `plan-06b-playbook-complete`

**What was built:**
- `GET /api/calls/[id]/playbook` — session-auth, operator-scoped route that creates a 1-hour Supabase Storage signed URL for the property's playbook PDF. Returns `{ hasPlaybook: false }` when none set.
- `PlaybookPanel` component — replaces the 6a empty-state in the 60% right panel of the agent video-call overlay. Fetches the signed URL on mount, renders an `<iframe>` with `sandbox="allow-same-origin"`, stale-fetch guard, and "Open in new tab" fallback link.
- 6 tests (route TDD), monorepo typecheck clean.

**Files created/modified in 6b:**
```
apps/portal/
  app/api/calls/[id]/playbook/route.ts    ← signed URL route
  tests/app/calls/playbook.test.ts        ← 6 Vitest tests
  components/video-call/
    playbook-panel.tsx                    ← PDF viewer component
    video-call.tsx                        ← swapped empty-state for <PlaybookPanel>
docs/specs/2026-06-01-06b-playbook-design.md
docs/plans/2026-06-01-06b-playbook.md
```

**To smoke-test 6b:** Upload a PDF to the `playbooks/` bucket in Supabase Storage, then `UPDATE properties SET playbook_pdf_url = '<path>', playbook_version = 1 WHERE id = '<id>';`. Start a video call from the kiosk, answer in the portal — the 60% panel should load and render the PDF.

---

## Post-6b bugs (in progress — pick these up before moving to 6c)

### Bug 1: Playbook "unavailable" — path mismatch in local Storage

**Symptom:** Agent's 60% panel shows "Playbook unavailable." after answering a video call.

**Root cause confirmed:** `createSignedUrl` returns `"Object not found"` — the path stored in `properties.playbook_pdf_url` does not match the actual file path in local Supabase Storage.

**What's in the DB:**
```sql
playbook_pdf_url = '00000000-0000-0000-0000-0000000000a0/00000000-0000-0000-0000-0000000000c1/playbook.pdf'
```

**What's needed:** Check the real path by going to `http://127.0.0.1:54323/project/default/storage/buckets/playbooks` — the local Studio upload likely stored the file flat (e.g., just `playbook.pdf` at the bucket root, not inside subfolders). Then run:

```sql
UPDATE properties
SET playbook_pdf_url = '<exact-path-shown-in-storage-browser>'
WHERE id = '00000000-0000-0000-0000-0000000000c1';
```

**This is a data issue, not a code bug.** No code changes needed once the path is corrected.

**Temporary debug code still in route:** `apps/portal/app/api/calls/[id]/playbook/route.ts` line 59 has `detail: error?.message` added to the 500 response for debugging. **Remove the `, detail: error?.message` part once the bug is confirmed fixed** and restore to just `{ error: "Could not generate playbook URL" }`.

---

### Bug 2: Agent-side audio mute broken

**Symptom:** Clicking Mute on the agent side changes the button label (UI responds correctly) but the microphone indicator stays on — Agora continues capturing and sending audio.

**Root cause confirmed:** `MediaStreamTrack.enabled = false` (the 6a fix) works for VIDEO (Agora sends black frames) but not for AUDIO. Agora's audio processing pipeline is independent of the underlying `MediaStreamTrack.enabled` state, so setting it to `false` silences the raw track but Agora's audio graph still captures and sends audio.

**Fix already applied and committed (`aed8447`):**
```ts
// Before (broken for audio):
function toggleMute() { const n = !muted; const t = audioRef.current?.getMediaStreamTrack(); if (t) t.enabled = !n; setMuted(n); }

// After (correct — uses Agora's own mute API):
function toggleMute() { const n = !muted; void audioRef.current?.setMuted(n); setMuted(n); }
```

`setMuted(n)` sends silence without releasing the mic or triggering `user-unpublished`. Camera toggle is unchanged (still uses `MediaStreamTrack.enabled` which works correctly for video).

**Status:** Fix committed, NOT yet smoke-tested (session ended before testing could happen). Verify mute actually silences audio in the next session.

---

## Current: Plan 6c — Emergency call

| Sub-phase | Scope | Status |
|---|---|---|
| **6a** | Kiosk app, video call path, agent overlay, migration 0007 | **complete** `plan-06a-kiosk-video-complete` |
| **6b** | Playbook — signed-URL route + PDF viewer in the 60% panel | **complete** `plan-06b-playbook-complete` |
| **6c** | Emergency call — conference + alert on-call manager + incident log | not started |

**Next:** Plan 6c — spec + plan, then implement.
**After 6:** Plan 7 — Owner portal (mobile-responsive), incl. kiosk info field editing + playbook upload.
