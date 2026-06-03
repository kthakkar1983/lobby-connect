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

## Post-6b bugs — ALL RESOLVED & COMMITTED (2026-06-02)

Four bugs surfaced after 6b shipped; all fixed and verified. Bug 1 (data/upload, no code change),
Bug 2 (`aed8447`), Bug 3 (`6de6520`), Bug 4 (`ad50882`). Details kept below for history.

### Bug 1: Playbook "unavailable" — PDF was never uploaded (FIXED + verified 2026-06-01)

**Symptom:** Agent's 60% panel showed "Playbook unavailable." after answering a video call.

**TRUE root cause (the earlier "path mismatch / file stored flat" diagnosis was WRONG):**
The `playbooks` bucket contained **no PDF at all** — only two zero-byte `.emptyFolderPlaceholder`
objects. The relevant one was at
`00000000-…a0/00000000-…c1/playbook.pdf/.emptyFolderPlaceholder` — i.e. a Studio session created a
**folder literally named `playbook.pdf`** (note the trailing `/`) and never uploaded a file into it.
So the key `…/playbook.pdf` had no object → `createSignedUrl` returned `"Object not found"`. The DB
path was fine; the file simply didn't exist. (Lesson: don't trust a prior "confirmed root cause" —
inspect `storage.objects` directly.)

**Fix applied & verified:** uploaded a real 1-page sample PDF (1204 B, `application/pdf`) to the exact
key `00000000-…a0/00000000-…c1/playbook.pdf` (so the existing `playbook_pdf_url` needs no change — the
`<operator_id>/<property_id>/playbook.pdf` convention is good), and deleted the bogus folder
placeholder. Verified end-to-end: `POST /storage/v1/object/sign/...` returns a signed URL and fetching
it returns `HTTP 200 application/pdf`. Debug code removed from the route (back to committed state); the
6 route tests still pass.

**⚠️ NOT durable across `supabase db reset`** — a reset wipes `storage.objects` and re-seeds
`properties` (seed.sql does not set `playbook_pdf_url`). After any reset, re-run:
```bash
# sample PDF + generator live in supabase/seed-assets/ (regenerate via: python3 supabase/seed-assets/gen-playbook.py out.pdf)
KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' apps/portal/.env.local | cut -d= -f2- | tr -d '"')
curl -X POST "http://127.0.0.1:54321/storage/v1/object/playbooks/00000000-0000-0000-0000-0000000000a0/00000000-0000-0000-0000-0000000000c1/playbook.pdf" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/pdf" \
  --data-binary @supabase/seed-assets/sample-playbook.pdf
```
…and re-set `playbook_pdf_url` if the property was reseeded. **Durable fix (not yet done):** commit a
sample PDF + a `seed-storage` script, and set `playbook_pdf_url` in `seed.sql`.

**Route also verified via the real authenticated path (2026-06-02):** logged in as `alex.agent` in a
browser, created a live RINGING video call, and `GET /api/calls/<id>/playbook` returned
`200 {hasPlaybook:true, signedUrl, version:1}`; the signed URL renders the PDF in the browser. This
testing surfaced Bug 3 (below).

---

### Bug 3: Playbook PDF blank in panel — iframe `sandbox` blocks Chrome's PDF viewer (FIXED `6de6520`, verified 2026-06-02)

**Symptom:** With Bug 1 fixed, the 60% panel still showed a broken-document icon instead of the PDF.

**Root cause:** `playbook-panel.tsx` rendered `<iframe sandbox="allow-same-origin">`. Chrome's built-in
PDF viewer is an out-of-process iframe that **will not load inside a sandboxed frame**. Tested in a real
browser against the live signed URL: `sandbox="allow-same-origin"` → broken icon;
`sandbox="allow-same-origin allow-scripts"` → still broken; **no `sandbox` → renders perfectly**. (So the
earlier "just add `allow-scripts`" guess was wrong — only removing `sandbox` works.)

**Fix:** removed the `sandbox` attribute from the iframe (with an inline comment warning not to re-add it).
Safe because the PDF is a short-lived signed URL from our own **cross-origin** Storage — the same-origin
policy already prevents the framed PDF from scripting the portal. Typecheck + 6 route tests + lint green.
Not unit-testable (jsdom doesn't render PDFs); guarded by the code comment.

**Verified in the real overlay (2026-06-02):** drove the actual agent overlay via Playwright with a
synthetic camera/mic — the real `PlaybookPanel` rendered the PDF in the 60% panel with `sandbox` absent
(screenshot confirmed). Bugs 1 + 3 fully closed.

---

### Bug 2: Agent-side audio mute broken (fix `aed8447`, VERIFIED 2026-06-02)

**Symptom:** Clicking Mute changed the button label but Agora kept capturing/sending audio.

**Root cause:** `MediaStreamTrack.enabled = false` (the 6a fix) works for VIDEO (black frames) but not
AUDIO — Agora's audio graph (AEC/ANS/AGC WebAudio pipeline) keeps sending data regardless of the raw
track's `enabled` flag. Fix uses Agora's own API: `audioRef.current.setMuted(n)`. (The 6a note's claim
that `setMuted()` triggers `user-unpublished`/"drops all streams" was a **misdiagnosis** — `setMuted()`
only pauses sending; `setEnabled()` is what unpublishes. Camera toggle stays on `MediaStreamTrack.enabled`.)

**Verified by instrumenting WebRTC** (Playwright + synthetic mic, agent's RTCPeerConnection `getStats`):
outbound audio `bytesSent` over a 3s window = **12231 unmuted → 0 muted**, and the sender track flips
`enabled:true → false`. Muting also did **not** drop either video stream (refutes the 6a stream-drop
fear). A subscribed guest receives zero audio bytes → hears silence.

**⚠️ Testing nuance:** `setMuted(true)` does **not** release the mic device, so the OS/browser mic
indicator stays ON by design — judge mute by whether the guest hears silence, not the local indicator.

---

### Bug 4: VideoCall effect leaked a second Agora publisher (FIXED `ad50882`, verified 2026-06-02)

**How it surfaced:** while WebRTC-instrumenting the mute test, the agent had **two** live audio
publishers — one obeyed mute (`bytesSent→0`), one ignored it (constant, track stayed `enabled`).

**Root cause:** `reactStrictMode: true` → dev mounts effects twice. `VideoCall`'s join `useEffect`
cleanup was only `return () => { cancelled = true; }` — it never closed tracks or left the channel, and
the async body had no `cancelled` check before `publish()`. So the first (throwaway) StrictMode mount
still joined + published, then was abandoned → a leaked publisher the app's `setMuted` ref no longer
pointed at. Latent in prod too: any unmount that doesn't go through the End button left mic/cam
publishing.

**Fix (`video-call.tsx`):** bail on `cancelled` after each await (especially before `publish`), and tear
down in cleanup using local (not ref) vars — `audio?.close(); video?.close(); client?.leave()`. Re-verified
with the same harness: now **exactly 1** audio publisher, `bytesSent` 12231 unmuted → **0** muted.
Typecheck + lint + full suite (159 tests) green.

**Note:** because this leak is dev-only (StrictMode), a manual two-device mute test in `pnpm dev` could
*still* have shown the guest hearing the leaked stream pre-fix — test mute in a production build, or rely
on the instrumented result above.

---

## Plan 6c — Emergency call — COMPLETE (`plan-06c-emergency-complete`)

| Sub-phase | Scope | Status |
|---|---|---|
| **6a** | Kiosk app, video call path, agent overlay, migration 0007 | **complete** `plan-06a-kiosk-video-complete` |
| **6b** | Playbook — signed-URL route + PDF viewer in the 60% panel | **complete** `plan-06b-playbook-complete` |
| **6c** | Emergency call — **911 Twilio conference (guest + agent + 911) + incident log** | **complete** `plan-06c-emergency-complete` |

**Re-scoped during the 2026-06-02 brainstorm** (vs the 6a §9.2 placeholder): emergency targets the **inbound phone call** (5a/5b), not the kiosk video. **No SMS, no on-call-manager alert** — 911 is the only escalation, plus a high-priority `incidents` row. Topology = 3-way relay (agent stays).

**What shipped:**
- `POST /api/calls/[id]/emergency` — stamps `calls.emergency_conference_name`, redirects the agent's live leg into a Twilio Conference, the guest follows via the existing `<Dial action>`→`dial-result` branch, then adds a 911 leg (`participants.create`) with the registered-address caller ID. Fallback redirects the guest parent directly if the agent leg can't be found.
- `POST /api/calls/[id]/emergency/control` (`mute`/`unmute`/`leave`) — **the agent's in-call controls during an emergency go through the Conference Participant API**, because a leg redirected via REST is no longer controllable by the browser Voice SDK (the smoke-test bug — agent leg orphaned, mute/hangup were no-ops). `softphone.tsx` routes Mute/Hang-up to this endpoint only when `emergencyActive`; normal calls still use the SDK.
- `incidents` table (migration 0008, RLS) + `calls.emergency_conference_name`/`emergency_agent_call_sid` (0008/0009). Audit row `trigger_emergency`.
- `EMERGENCY_DIAL_NUMBER` env (default `911`; **set to `933` for all dev/test**).
- Removed the out-of-scope Emergency button from the video overlay.

**Verified end-to-end (2026-06-02, `EMERGENCY_DIAL_NUMBER=933`):** real inbound call → agent answered → Emergency → guest + agent + 933 conferenced, OKC address read back; `incidents` row written; **after the Fix**, agent Mute mutes the conference participant and Hang-up removes the agent leg cleanly (agent leg `completed`, conference ended, **no orphan** — confirmed via Twilio). 196 tests / typecheck / lint green. Full detail: spec §10, `docs/specs/2026-06-02-06c-emergency-call-design.md`.

## ⚠️ Before pilot go-live — flip emergency dialing to real 911
- Set `EMERGENCY_DIAL_NUMBER=911` in the **production** environment (Vercel env) only. Leave local/dev `.env.local` at `933`.
- Re-confirm the Twilio number still shows **"Emergency Address is registered"** for the pilot property (OKC).
- Never test by dialing real 911 — use 933 (address read-back, no PSAP, no dispatch).

## Plan 7 — Owner portal — SPLIT into 7a (read) + 7b (writes); 7a SPEC + PLAN WRITTEN, not yet built

Brainstormed 2026-06-02. Plan 7 (mobile-first owner portal) is split on a single seam — **does it write?**

- **7a — read views (NEXT TO BUILD):** owner shell (slim header + **bottom tab bar**, mobile-first) + **Home** (per-property glance cards: assigned agent + presence dot, today's call count, open-incident badge) + **property detail** (read; routing DID hidden) + **call history** (audio+video, filter + load-more) + **call detail** (+ a *recording seam* that renders only when `recording_url` is non-null — dark today, auto-on when recording ships) + **incident list/detail** (read). **Zero migrations, zero new API routes, zero service-role** — all reads go through the user-scoped client; existing owner RLS (`0002`/`0004`/`0008`) scopes them. `<AutoRefresh>` island does the 20s-poll via `router.refresh()`.
- **7b — self-service writes (LATER):** kiosk info-field editing + playbook upload (+ owner-scoped signed-URL view route) + incident resolve. Needs a new owner `UPDATE` RLS policy + storage upload.

**Key decisions (locked in the 7a spec):** defer call recording to v1.1/v1.2 but keep the call-detail recording seam so it drops in without rework; nav = bottom tab bar (mobile) → top nav (`md+`); IA = Home + Calls + Incidents with property detail as a Home drill-down; hide routing DID from owners; show assigned-agent presence (`AVAILABLE/ON_CALL/AWAY/OFFLINE`) on Home.

**Recording reality (why the seam):** Twilio call recording was **never enabled** — `calls.recording_url`/`recording_sid` are never written (no `record` attr, no recording-status webhook, disclosure audio still unrecorded — Open Item #3). So "recording playback" is a stub today; 7a renders the seam dark.

**Artifacts (committed):**
- Spec: `docs/specs/2026-06-02-07a-owner-portal-design.md` (commit `4bcc141`)
- Plan: `docs/plans/2026-06-02-07a-owner-portal.md` (commit `b4d07a9`) — 13 TDD-ordered tasks (T1–T3 `lib/owner/` helpers → T4–T5 AutoRefresh + nav islands → T6 shell → T7–T12 pages → T13 verify+tag `plan-07a-owner-portal-complete`).

**Smoke note:** seed OWNER `owner@lobbyconnect.local` / `localdev123` (Olivia) already owns "The Sample Hotel" (`owner_user_id = …b2`) — no seed tweak needed.

**COMPLETE — tag: `plan-07a-owner-portal-complete`**

## Plan 7a — Owner portal (read views) — COMPLETE

**Tag:** `plan-07a-owner-portal-complete`

**What shipped (all read-only, zero migrations, zero new API routes, zero service-role):**
- `lib/owner/format.ts` — display mappers + tz-aware call-time formatter (TDD)
- `lib/owner/summary.ts` — tz-aware today-call count + open-incident count (TDD)
- `lib/owner/nav.ts` — activeOwnerTab resolver (TDD)
- `components/owner/auto-refresh.tsx` — `<AutoRefresh>` island (router.refresh on 20s interval + window focus)
- `components/owner/owner-nav.tsx` — `<OwnerTopNav>` (md+ header) + `<OwnerBottomNav>` (mobile fixed)
- `app/(owner)/layout.tsx` — full owner shell (sticky header + logo + nav + UserMenu + bottom nav; no Softphone)
- `app/(owner)/owner/page.tsx` + `loading.tsx` — Home overview (per-property glance cards: agent presence dot, today-count, open-incident badge)
- `app/(owner)/owner/properties/[id]/page.tsx` — property detail read (basics + kiosk content display-only + recent calls; routing DID hidden)
- `app/(owner)/owner/calls/page.tsx` + `loading.tsx` — call history (reverse-chron, ?property filter, ?limit load-more, AutoRefresh)
- `app/(owner)/owner/calls/[id]/page.tsx` — call detail (all fields + incident link + dark recording seam)
- `app/(owner)/owner/incidents/page.tsx` + `loading.tsx` — incident list (read, AutoRefresh)
- `app/(owner)/owner/incidents/[id]/page.tsx` — incident detail (read; no resolve control — that's 7b)

**Architecture:** pure RSC reads via user-scoped Supabase client; RLS does owner scoping; `<AutoRefresh>` satisfies locked-decision-4 (20s poll + refocus). 45 test files / 210 tests green, typecheck + lint clean.

**Next up:** 7b — owner self-service writes (kiosk-field editing + playbook upload + incident resolve). Needs owner `UPDATE` RLS + storage route.

**Smoke note:** sign in as `owner@lobbyconnect.local` / `localdev123` (Olivia) to test. She owns "The Sample Hotel" with Alex Agent assigned.

## Plan 7b — Owner self-service writes — COMPLETE (`plan-07b-owner-writes-complete`)

**Tag:** `plan-07b-owner-writes-complete`

**What shipped:**
- `lib/owner/kiosk.ts` — `validateKioskFields` + `KIOSK_FIELDS` + `KioskContentInput` (TDD, 5 tests)
- `lib/owner/playbook.ts` — `validatePlaybookFile` + `playbookStorageKey` + `MAX_PLAYBOOK_BYTES` (TDD, 5 tests)
- `lib/owner/incidents.ts` — `validateResolutionNote` + `MAX_RESOLUTION_NOTE` (TDD, 3 tests)
- `supabase/migrations/0010_owner_writes.sql` — `incidents.resolution_note` column + `properties_owner_update` + `incidents_owner_update` RLS policies + `enforce_owner_property_columns()` + `enforce_owner_incident_columns()` BEFORE UPDATE triggers (SECURITY DEFINER; `updated_at` excluded from property guard to avoid clash with the `properties_set_updated_at` auto-stamp trigger)
- `packages/shared/src/supabase-types.ts` — added `resolution_note` to incidents Row/Insert/Update
- `app/(owner)/owner/properties/[id]/actions.ts` — `updateKioskContentAction` (requireRole → validate → RLS-scoped diff → user-scoped UPDATE → per-field audit)
- `app/(owner)/owner/properties/[id]/kiosk-content-card.tsx` — inline Edit/Save/Cancel client card (useTransition, sonner, router.refresh)
- `app/(owner)/owner/properties/[id]/playbook-card.tsx` — View (signed URL → new tab) + Upload/Replace (file input, POST, router.refresh) client card
- `app/api/owner/properties/[id]/playbook/route.ts` — service-role POST upload + GET signed URL (1h TTL); TDD'd (8 tests)
- `app/(owner)/owner/incidents/[id]/actions.ts` — `resolveIncidentAction` (requireRole → validate → idempotent RLS-scoped update → audit → revalidate /owner)
- `app/(owner)/owner/incidents/[id]/resolve-incident.tsx` — optional-note expand/confirm client control (returns null when not OPEN)
- Property detail page.tsx: replaced static kiosk section with `<KioskContentCard>`, added `<PlaybookCard>` between basics and kiosk card, removed Playbook Field from basics grid
- Incident detail page.tsx: added `resolution_note` to select, rendered `<ResolveIncident>` after heading, rendered resolution note section after notes

**Architecture:** kiosk + incident writes use the user-scoped client (RLS + column-guard triggers enforce scope); playbook is the lone service-role surface (private bucket binary upload). Column guards are forward-compatible — new columns are protected by default.

**Test count:** 231 tests green (49 test files), typecheck + lint clean.

**Smoke confirmed (2026-06-03):** kiosk inline edit saves + persists after refresh; playbook upload bumps version + View opens signed URL in new tab; incident resolve flips status to RESOLVED with optional note, Resolve control disappears after resolve.

## Plan 8 — Observability — COMPLETE (`plan-08-observability-complete`)

**Tag:** `plan-08-observability-complete`

**What shipped:**
- `lib/sentry/scrub.ts` — PII scrubber (`scrubEvent`/`scrubPii`): drops `caller_number`/`recording_url` keys + redacts phone-shaped substrings. Wired as `beforeSend` in all 3 portal Sentry configs + kiosk.
- `lib/sentry/errors.ts` — `getRecentErrorCount()`: Sentry API probe, null-safe fallback.
- `lib/health/heartbeat.ts` — `recordHeartbeat()`: best-effort service-role upsert into `health_signals`.
- `lib/status/signals.ts` — `SIGNAL_SPECS` + `classifyHeartbeat`/`classifyProbe`/`classifyErrorCount` pure classifiers.
- `lib/audit/query.ts` — `validateAuditFilter` + `mergeActorNames` pure helpers.
- Sentry wired into portal (`@sentry/nextjs`, `instrumentation*.ts`, `withSentryConfig`) + kiosk (`@sentry/react`, `src/lib/sentry.ts`). `@vercel/analytics` added to portal root layout.
- Heartbeats: `twilio_webhook` (incoming route) + `cron_mark_stale_offline` (mark-stale-offline cron), per-operator loop.
- `components/auto-refresh.tsx` — promoted from `components/owner/` (shared by admin + owner).
- `/admin/audit` — RSC + client table, action filter, load-more, 2-query actor-name merge.
- `/admin/status` — RSC with Supabase probe + Sentry error count + push-signal heartbeat cards, `<AutoRefresh>`.
- Sidebar: Audit log (ScrollText) + Status (Activity) nav items.
- Migration 0011: `health_signals` table + admin-select RLS.
- 252 tests passing (55 test files), portal + kiosk typecheck + lint clean.

**Next up:** Plan 8 was the final v1 build plan — v1 is feature-complete. Remaining work is pilot launch: set production env (Sentry DSN + auth token, Twilio), deploy portal + kiosk to Vercel, and run end-to-end smoke with the pilot hotel. Cut-from-v1 features (voicemail, ops dashboard, MFA, etc.) remain schema-ready for later — see `CLAUDE.md` v1 scope.
