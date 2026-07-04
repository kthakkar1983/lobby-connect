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

Plan 8 was the final v1 build plan — **v1 is feature-complete.** Remaining work is the pilot launch (below). Cut-from-v1 features (voicemail, ops dashboard, MFA, etc.) remain schema-ready for later — see `CLAUDE.md` v1 scope.

---

## PILOT LAUNCH — IN PROGRESS (resume here)

**Runbook:** `docs/setup/2026-06-03-launch-checklist.md`. **Prod DB bootstrap:** `supabase/bootstrap-prod.sql`.

**Live URLs:** portal `https://lobby-connect-portal.vercel.app` · kiosk `https://lobby-connect-kiosk.vercel.app`.

**Done (2026-06-04):**
- Prod Supabase created; migrations `0001`–`0011` + bootstrap (operator + admin + `twilio_identity`) applied; Auth Site URL + redirect URLs set.
- Both apps deployed green on Vercel; **all prod env vars set** (Supabase prod keys, Twilio, Agora, `CRON_SECRET`, `KIOSK_CONFIG_SECRET`, `EMERGENCY_DIAL_NUMBER=911`, Sentry, cross-ref URLs). `NEXT_PUBLIC_APP_URL`/`VITE_PORTAL_API_URL` = canonical portal URL; `KIOSK_ORIGIN` = kiosk URL.
- Twilio voice webhook repointed to `…/api/twilio/voice/incoming`. Admin sign-in confirmed in prod.
- Fixes shipped during launch: removed dangling `/admin/assignments` + `/admin/settings` nav links; **added "Generate kiosk link" button** on property detail (mints `?t=` token via `KIOSK_CONFIG_SECRET`, audited `property.kiosk_link_generated`); corrected `/audit` action catalog.

**NEXT STEP: end-to-end smoke test** → `docs/setup/2026-06-04-smoke-test-checklist.md` (complete, self-contained). Nothing in it has been run yet; no pilot property exists in prod yet (step 1 of the smoke creates it).

**Active caveats:**
- **Cron is daily** (`0 8 * * *`) for the Hobby pilot — `/status` presence card may read amber (expected). **Before public launch:** Vercel Pro + restore `* * * * *` in `apps/portal/vercel.json` and `CRON_SWEEP_INTERVAL_MS=60_000` in `apps/portal/lib/status/signals.ts` (two-line flip).
- **Emergency smoke uses 933 only** (prod is set to real `911`); flip env to 933 + redeploy to test, then restore 911. See smoke §5.
- Kiosk pairing is via the generated `?t=` link (token is per-property, long-lived, reusable across devices; no per-device revocation yet — device-registry system is a post-pilot item).

---

### 2026-06-04 (session 2) — smoke blocked on auth; invite/sign-in bug FIXED in code, custom SMTP pending

**Status:** smoke test still NOT started (no pilot property in prod yet). Hit a hard blocker — **invited users could not sign in** — now root-caused and fixed in code; final enablement (email templates) needs **custom SMTP**, which Kumar is setting up before next session.

**Fixed + deployed this session:**
- **Supabase MCP works for prod now** (the connector was on an empty org; reconnected). Prod ref `ztunzdpmazwwwkxcpyfp` (org `qrpnbimuziaoekoznfxm`). Claude can `execute_sql` against prod to verify smoke steps + read GoTrue logs (`get_logs service=auth`). Vercel CLI is authed (`kumar-8015`); portal `prj_SwRzM2yQQ58iCqj0Js9HZ5XTpBAJ`, kiosk `prj_pw6EUnewpAG6yOxJxpQoJMWasmyv`, team `team_SS9GSqbP7VOjZRPyQK6vCATN`.
- **`NEXT_PUBLIC_APP_URL` was a *protected* Vercel alias** → invite links hit the Vercel deployment-protection wall ("Vercel sign-up page"). Fixed env to clean alias `https://lobby-connect-portal.vercel.app` + rebuilt. Supabase Auth **Site URL + redirect allow-list** (`https://lobby-connect-portal.vercel.app/**`) set to clean alias. Vercel Deployment Protection left **ON** (only the bare alias is public — all generated links MUST use it; kiosk + Twilio webhook already do).
- **Middleware `/_vercel` exclusion** — commit `930a5dc`.
- **THE BIG FIX — invite/onboarding/sign-in — commit `24fd100`, deployed green.** Supabase email links return the session in the URL **fragment**, which the server-side `/auth/callback` (PKCE `exchangeCodeForSession`) can't read → no session → users bounced to `/sign-in`, never reached `/onboarding`, never set a password → every sign-in returned `invalid_credentials`. (Manually-created dashboard users worked because they skip this flow — that was the historical "only manual users work" workaround.) Confirmed via GoTrue logs (`user_signedup` at /verify, no PKCE exchange, then `password → 400 invalid_credentials`). **Fix:** new **`/auth/confirm`** route using `verifyOtp({token_hash,type})` with request→response cookie pairing; **`/auth/signout`** fixed the same way (it was a silent no-op = the "can't sign out" symptom). 252 tests green, typecheck+lint clean.

**PICK UP HERE — to make the auth fix live end-to-end:**
1. **Custom SMTP (REQUIRED).** Supabase now gates email-template editing behind custom SMTP, AND the built-in email is rate-limited (resets weren't delivering). Kumar is setting up **Brevo or SendGrid single-sender** (verify his Gmail, *no domain needed*). NOTE: Resend without a domain only sends to your own signup email — not usable for inviting others. Fields/steps in `docs/setup/2026-06-04-auth-email-templates.md`.
2. **Edit the 2 email templates** → point at `/auth/confirm` (exact strings in that doc): Invite → `…?token_hash={{ .TokenHash }}&type=invite&next=/onboarding`; Reset Password → `…&type=recovery&next=/auth/update-password`.
3. **Test the fixed flow:** invite a fresh email → should now reach `/onboarding` → set password → sign in. Claude verifies live via GoTrue logs (`verifyOtp` ok, `password` grant → 200) + DB (`has_password`).
4. **Recreate the broken test users:** `bovarovadilnoza0@gmail.com` (the real pilot AGENT) and `kumar@unbrandt.com` (throwaway) currently can't sign in (never set a password). After templates are fixed: **hard-delete + re-invite** through the fixed flow (re-inviting an existing email is blocked in-app — `lib/users/invite.ts`).
5. **THEN run the smoke** — `docs/setup/2026-06-04-smoke-test-checklist.md` §1 onward. §3 voice + §4 kiosk can run with the **admin** account as the agent (don't strictly need Dilnoza); §2 RBAC + §6 owner need a second working user.

**Open caveats (2026-06-04):**
- **Analytics SyntaxError ("Unexpected token '<'") — cosmetic, NOT fixed.** Kumar enabled Web Analytics but `/_vercel/insights/script.js` still 404s (HTML). The actually-injected path is `/<hash>/script.js` at root, which the `_vercel` middleware exclusion doesn't cover. Sentry noise only — revisit later, or just remove `<Analytics/>` from the portal root layout.
- **Custom SMTP + a real domain are launch prerequisites** for deliverability (gmail-from via 3rd-party SMTP may spam-folder). SMTP also gates template editing.
- Daily-cron / emergency-933 / kiosk-token caveats unchanged (above).

---

## Plan 9 — Email-free admin provisioning — COMPLETE (`plan-09-admin-provisioning-complete`)

**Status: MERGED + SHIPPED TO PROD (2026-06-05).** Merged to `main` (fast-forward, tip `24a8dcb`), feature branch deleted, tag `plan-09-admin-provisioning-complete` pushed to origin.
**Spec:** `docs/specs/2026-06-04-09-admin-provisioning-design.md` · **Plan:** `docs/plans/2026-06-04-09-admin-provisioning.md`.

**This resolves the login blocker WITHOUT custom SMTP.** Instead of email invites, an admin now creates a
user with a typed **temporary password** (no email sent), and the user is forced to set their own password
at first sign-in. SMTP / email templates are no longer a pilot prerequisite — they become a *post-pilot*
re-enable (the `/auth/confirm` route + `docs/setup/2026-06-04-auth-email-templates.md` are the dormant seam).

**What shipped (10 TDD tasks, 257 tests, typecheck + lint green):**
- `provisionUser` (`lib/users/provision.ts`, replaces `invite.ts`) → `admin.auth.admin.createUser({ email_confirm:true, user_metadata })` + profile insert with `must_change_password:true`; rollback on insert failure.
- Migration **0012**: `profiles.must_change_password boolean not null default false` + **column-guard trigger** `enforce_profile_self_columns` (closes a real privilege-escalation hole — `profiles_update_self` was row-level only, so a non-admin could PATCH their own `role`/`active`; now only `full_name` is self-editable). **Verified locally via simulated-JWT SQL**: AGENT self-promote/self-flag/self-deactivate all blocked; `full_name` + service-role writes allowed.
- `requireRole` gate: `must_change_password` users are redirected to `/onboarding` (after the active check, before the role check); onboarding clears the flag via the admin client.
- `createUserAction` + `resetPasswordAction` (admin "Reset password" → new temp password + re-flags). Audit `user.created` / `user.password_reset_by_admin` (added to `/admin/audit` catalog).
- Sign-in specific errors (`lib/auth/sign-in-errors.ts` `mapSignInError`) + **deactivated-user block** (post-auth `profiles.active` check → signOut + specific message; closes the old silent bounce).
- Reusable `PasswordInput` show/hide on every password field (sign-in, onboarding, update-password, admin create + reset).
- "Pending setup" badge on `/admin/users` when `must_change_password`. "Forgot password?" link replaced with "Contact your administrator." (email reset dormant).

**Known/by-design behavior:** an admin can reset their OWN password (it's the only self-service password-change path in v1 since update-password is dormant) — doing so flags them and sends them through onboarding next sign-in. Intentional, not a lockout.

**ALREADY DONE this session (2026-06-05) — do NOT redo:**
- Merged to main + tagged + pushed (above).
- **Migration 0012 APPLIED to prod** (`lobby-connect-prod`, ref `ztunzdpmazwwwkxcpyfp`) via MCP `apply_migration` — recorded in prod migration history as `admin_provisioning` (timestamp version `20260605044500`). Column + guard live on prod.
- **Production deploy LIVE + verified** — Vercel Git auto-deploy on push to main built green (`next build` passed); deployment `dpl_J3CxSw6z1fqzTj5SMabQhmS9FvtL` (commit `24a8dcb`) serving the canonical `https://lobby-connect-portal.vercel.app`. Confirmed: `/sign-in` → 200 and serves the NEW build (the dormant "Contact your administrator" copy is present).

**PICK UP HERE — run the smoke (no SMTP needed; everything is deployed):**
1. **(Optional, 30s)** Supabase dashboard → Auth → Providers → Email → **Min password length = 8** (UI already enforces 8; this just aligns the server). Not a blocker.
2. **Recover the two stuck prod users — also smoke check #1:** sign in to prod as admin → **/admin/users** → **Reset password** on `bovarovadilnoza0@gmail.com` (pilot AGENT) and `kumar@unbrandt.com` (throwaway) → set a temp password → share it → they sign in → forced through `/onboarding` to set their own. Watch the **"Pending setup"** badge clear after they finish. (Claude can watch this live: Supabase MCP is on prod — read GoTrue logs `get_logs service=auth` to confirm the `password` grant → 200 + the flag clearing, and `execute_sql` to confirm `must_change_password` flips.)
3. **THEN run the full smoke** — `docs/setup/2026-06-04-smoke-test-checklist.md` §1 onward. §3 voice + §4 kiosk can use the admin as the agent; §2 RBAC + §6 owner need a second working user. Emergency §5 is 933-only (prod env is real 911 — flip to 933 + redeploy to test, then restore). The SMTP/email-template steps (`docs/setup/2026-06-04-auth-email-templates.md`) are now OPTIONAL (defer to post-pilot).

**Superseded / no longer required for the pilot:** custom SMTP, editing the 2 email templates, hard-delete+re-invite — admin-provisioned temp passwords replace the email flow. Keep those docs only for the future email re-enable.

---

## 2026-06-05 (session 3) — SMOKE STARTED: voice + sign-out fixed, Plan 9 recovery validated in prod

**Smoke is now IN PROGRESS** (`docs/setup/2026-06-04-smoke-test-checklist.md`). Confirmed working this session: **§1 seed**, **§2 RBAC**, **§4 kiosk video** (a COMPLETED VIDEO call row handled by Dilnoza). Plan 9's **stuck-user recovery flow validated end-to-end in prod** — both `bovarovadilnoza0@gmail.com` and `kumar@unbrandt.com` were reset → forced `/onboarding` → set own password → signed in. So admin-provisioned temp passwords + forced first-login change work on prod.

**Two bugs found + fixed:**

1. **Voice (§3) — `routing_did` mismatch (the "No one is available" cause). FIXED (data).** Inbound calls hit the not-in-service apology because `properties.routing_did` was `+14058610196` but the actual (and ONLY) Twilio number on the account is `+14058750410` (mistyped at property-create; audit showed one `property.created`, no later edit). Triangulated three ways: Twilio call `To`, the account's sole number, and the app's `TWILIO_PHONE_NUMBER` env all = `+14058750410`. Corrected on prod → `routing_did = +14058750410` (via MCP `execute_sql`; **no audit row** — a panel save would log one). Webhook lookup now matches.
   - **The earlier Twilio error 11200 was a RED HERRING / already resolved.** It came from Twilio POSTing to a *deployment-protected* alias (`lobby-connect-portal-kumar-thakkars-projects.vercel.app`) → 401 + Vercel SSO wall → Twilio can't parse TwiML. But the **live** Twilio config (verified via Twilio REST API) already points `voice_url` + `status_callback` at the clean `https://lobby-connect-portal.vercel.app`, no fallback URL, one number. Reproduced the wall (clean URL → our `403 Invalid signature`; protected URL → `401` SSO). The old URL is **not hardcoded anywhere** in the repo. So nothing to change for the URL — it was historical.

2. **Sign-out broken from the user-menu dropdown (admin/owner). FIXED + DEPLOYED (`d52f6be`).** The Sign-out `<form>` was nested inside `<DropdownMenuItem asChild>`; Radix's item pointer-event handling swallowed the inner submit, so `POST /auth/signout` never fired (verified: zero such requests in Vercel logs). Fix: render the POST form **outside** the menu, trigger via `formRef.requestSubmit()` in the item's `onSelect` (with `preventDefault` so Radix doesn't unmount the menu before navigation). `apps/portal/components/user-menu.tsx`, now `"use client"`. Agent layout was never affected (bare form, no menu). Deployed: prod `dpl_A5dnvjx2QfuYGrKPXXgi72Sma9QX` READY on the clean alias.

**PICK UP HERE — finish the smoke:**
1. **Retest §3 voice connect:** with Dilnoza or an admin signed into the portal (dashboard open → softphone registered), call `+14058750410` → softphone should ring → Answer → two-way audio; `calls` row `RINGING → IN_PROGRESS → COMPLETED`. Also do the no-answer case (apology + `NO_ANSWER`).
2. **Retest sign-out** from the admin user menu (hard-refresh once to drop the stale client bundle).
3. **§5 emergency (933-only)**, **§6 owner** (needs the 2nd recovered user), **§7 observability**. Emergency: flip `EMERGENCY_DIAL_NUMBER` to `933` + redeploy, test, then restore `911`.

**Minor cleanups (non-blocking):** property **timezone** is `America/New_York` but Oklahoma City is Central → set `America/Chicago`. The `routing_did` fix was SQL-direct so it has no audit row (cosmetic) — re-saving the property in the panel would record one.

---

## 2026-06-06 (session 4) — §7 observability PASS (Sentry probe fixed); §5 emergency deferred

**Smoke status now:** §1, §2, §3 (voice), §4 (kiosk video), §6 (owner), sign-out, and **§7 (observability)** all PASS/green. **Only §5 emergency (933) remains.** Kumar confirmed §3/§6/sign-out were re-run green *before* this session. He also flagged **other bugs/issues (unspecified)** to triage in a fresh chat — ASK him what they are first thing.

**§7 observability — results:**
- `/admin/status`: **Supabase / Twilio webhook / Presence sweep all green.** (Predicted from backend: `twilio_webhook` is `info` mode → always green once seen — last beat was the §3 no-answer call; presence cron last ran ~18h ago, under the 36h warn threshold → green, *not* the amber the smoke top-note warns about.) **Recent errors (24h) was "Sentry unavailable"** → diagnosed + FIXED below.
- `/admin/audit`: 35 rows across 12 action types, list + action filter **PASS**. ("Load more" correctly hidden — only 35 rows < 50 page size; `validateAuditFilter` clamps min limit to 50 so it can't be forced via URL. Not a bug.)
- Sentry scrub: **PASS (lightweight)** — ingestion confirmed (issues API → 200, events visible on dashboard), redaction covered by `lib/sentry/scrub.ts` unit tests. The only live events are infra/client noise (`SyntaxError: Unexpected token '<'` from the analytics 404, "connection closed") from non-call code paths → no phone/recording PII by construction, so they can't exercise live redaction (accepted limit of the lightweight check).

**Sentry "Recent errors" probe — root-caused + FIXED in prod:**
- Symptom: `getRecentErrorCount()` returned `null` → card "Sentry unavailable".
- **Misstep to remember:** first concluded "prod Sentry vars are empty strings" from `vercel env pull` — WRONG. `vercel env pull` returns **blank for every Sensitive var** (all ~40 custom prod vars pulled `len=0`; only Vercel system vars like `VERCEL_OIDC_TOKEN`/`TURBO_*` survive). You cannot read prod env values via CLI. (Saved to build-quirks memory, along with: `grep` here is **ugrep** so `^`-anchored extraction misbehaves; and each Bash tool call gets a fresh `/tmp`.)
- **True root cause:** the prod `SENTRY_AUTH_TOKEN` lacked **`event:read`** scope. The issues endpoint (`GET /projects/{org}/{project}/issues/`) requires `event:read`, **not** the `project:read` the observability plan/spec docs specify. Proven by curl: old token → **403** `{"detail":"You do not have permission"}`; new token w/ `event:read` → **200**, count 1. (403 — not 404 — also confirmed the slugs `lobby-connect`/`portal` were already correct in prod.)
- **Fix applied to prod (DONE this session):** Kumar created a **User Auth Token** with all scopes; verified 200 via curl; then via Vercel CLI (`env rm`+`env add`, Production) set `SENTRY_ORG=lobby-connect`, `SENTRY_PROJECT=portal`, `SENTRY_AUTH_TOKEN=<new token>`; **redeployed** (`vercel redeploy` of the 7h prod deploy → new deployment `lobby-connect-portal-giuenczr9…` → **aliased to `lobby-connect-portal.vercel.app`**, build green).
- **Follow-ups:** (1) **Visual confirm DONE (2026-06-06)** — `/admin/status` "Recent errors (24h)" now reads **amber / 2 unresolved** (correct — the cosmetic noise issues). Probe fix verified end-to-end. (2) **Rotate the Sentry token** — filed as a post-launch reminder in `docs/v2-backlog.md` → "Observability / security" (pasted in plaintext in the session-4 chat; not in any file/commit). (3) Optionally correct the observability plan/spec docs: issues endpoint needs `event:read`, not `project:read`.

**Prod safety note:** `EMERGENCY_DIAL_NUMBER` was **NOT touched** — still **`911`** (real PSAP). The §5 933-flip was never started. Prod emergency dialing is safe/live.

**PICK UP HERE (fresh chat):**
1. **ASK Kumar to describe the other bugs/issues he noticed** — triage those first.
2. Run **§5 emergency (933)** — the last smoke item. Sequence (only flip when kiosk+agent are ready to call immediately, to minimize the 933 window): set `EMERGENCY_DIAL_NUMBER=933` in Vercel prod + redeploy → kiosk→agent video call → trigger **Emergency** → expect Twilio conference (guest+agent+933) + OKC address read-back + `incidents` row + `calls.emergency_conference_name` set → confirm agent mute/leave → then set `EMERGENCY_DIAL_NUMBER=911` back + redeploy + **verify 911** (overwrite explicitly since the value isn't readable). See smoke §5.

---

## 2026-06-06 (session 5) — triaged Kumar's bug list: 3 fixed + shipped (softphone reconnect, voice property name, video ringtone), 1 non-bug

The "fresh chat" session 4 asked for. Kumar reported 4 issues from smoke testing; emergency §5 stays parked for the very end. All work is TDD'd, committed to `main`, and **deployed to prod**: commits `f0055fb` (voice) + `928eddc` (video), deploy `dpl_6KeMuCrea1Q4hbSut7fy5fZVmHUd` READY on `lobby-connect-portal.vercel.app`. 267 tests, typecheck + lint, and `next build` all green.

**1) Incoming VOICE calls didn't show the property — FIXED + VERIFIED LIVE.** The dial TwiML only forwarded `callId` to the agent's Client; the property is known at routing time but was never passed. Now `incoming/route.ts` selects `properties.name` and `buildIncomingTwiml` emits a second `<Client>` `<Parameter name="propertyName">` (XML-escaped); the softphone reads `call.customParameters` and shows **"Incoming call · {hotel}"** (mirrors the video banner). Especially helps admins covering multiple hotels. Files: `lib/voice/twiml.ts`, `app/api/twilio/voice/incoming/route.ts`, `components/softphone/softphone.tsx`. (Sharp edge noted: `escapeXml(undefined)` would throw → apology TwiML, but `properties.name` is NOT NULL so it can't happen; left escapeXml strict, made the route test schema-accurate.)

**2) Softphone "disconnected — reload to reconnect" — FIXED (unit-tested; live soak deferred by choice).** Root cause: the Twilio access token has a 1h TTL with **no refresh** → the Device deregistered at expiry, no recovery. New `lib/voice/device-resilience.ts` `attachTokenAutoRefresh` wires `tokenWillExpire` → refetch `/api/twilio/token` → `device.updateToken`; pre-expiry lead widened to 30s (`tokenRefreshMs`; SDK default 10s too tight). Event name/method/option all verified against the installed `@twilio/voice-sdk@2.18.3` bundle. **Not live-verified** (needs a >1h session); Kumar will confirm in normal use. Fast check if ever wanted: temp-lower `TOKEN_TTL_SECONDS` (token route) to ~70s + redeploy, watch the refetch at ~40s, then revert.

**3) Owner portal "logs each action twice" — INVESTIGATED, NOT A BUG.** One audit writer only (`logAuditEvent`); **no DB trigger writes audit rows** (the 0010/0012 column-guards only raise/return); the `/audit` actor-merge is 1-in/1-out. The "double" is the **intended one-row-per-changed-field** behavior of the kiosk-content edit (up to 8 fields → N rows, same action+time, different `details.field`) — identical to the admin edit path; a single-field edit writes exactly 1 row. No code change. (Optional future polish: group same-action/same-second rows in the viewer.)

**4) No ringtone for incoming VIDEO calls — FIXED + VERIFIED LIVE.** Audio rings via the Twilio SDK; video was a silent polled banner. New `lib/video/ringtone.ts` (idempotent start/stop over an HTMLAudioElement) loops **`apps/portal/public/sounds/ring.mp3`** (Kumar supplied; 320kbps/681KB — works, could shrink to ~50KB later) while a video call is RINGING, stops on accept/decline/disappear. **Incoming-video poll tightened 20s → 3s** (`components/video-call/incoming-video-banner.tsx`) so the ring is prompt — lightly bends the 20s-polling locked decision for this one view only, no subscriptions. Autoplay caveat: needs one prior page interaction to unlock — non-issue since the same-page audio ring already proves activation.

**Also:** new `~/.claude` memory `deploy-and-smoke-workflow` — voice/video can only be smoke-tested on prod (Twilio webhook + kiosk config point at the prod portal URL), so any voice/video change implies a prod deploy in the smoke loop.

**PICK UP HERE (fresh chat, per Kumar):**
1. **More testing** — Kumar will run further smoke and surface any new issues; triage those first.
2. **§5 emergency (933)** — still parked; run when ready. Sequence unchanged (smoke §5 / session-4 entry): only flip `EMERGENCY_DIAL_NUMBER=911→933` + redeploy when kiosk+agent are ready to call immediately, test the conference (guest+agent+933 + OKC address read-back + `incidents` row + `calls.emergency_conference_name`), confirm agent mute/leave, then restore **`911`** + redeploy + explicitly verify (value isn't readable via CLI).
3. (Optional) long-soak confirm #2; downsize `ring.mp3`; group multi-field audit rows in the viewer.

---

## 2026-06-06 (session 6) — root-caused the kiosk "stuck connected" crashes + shipped full video-call resilience

Kumar reported: during testing, a couple of random crashes left the **kiosk stuck on the Connected screen with no one there**, while the **agent returned to home/ready**. Also a pop-up blocker caused "unexpected behavior" once. He asked whether the crashes registered server-side or were just a bug — and (separately) whether call waiting was in v1 (answer: **cut** — held-call slot / second-call queuing is deferred; Hold/Swap render disabled). Then: **fix everything, production-grade, before go-to-market.**

**Forensic verdict: a design-gap bug, INVISIBLE to all three monitoring surfaces.**
- **DB (prod):** found exactly one dangling row — `bfe29f15`, VIDEO, **`IN_PROGRESS`, `ended_at` NULL, 4.3h old**. Video-call finalization is **kiosk-owned** (`/api/kiosk/call-ended` is the only finalizer); when the kiosk browser dies it never fires, so the row leaks forever, masquerading as an active call. AUDIO never leaks (Twilio status webhooks finalize server-side — zero dangling audio rows).
- **Audit:** calls aren't audited at all (13 action types, all `user.*`/`property.*`/`assignment.*`) → zero footprint.
- **Sentry:** a renderer hard-crash/freeze kills the JS context (uncatchable + can't flush); the kiosk also had **no ErrorBoundary**. DSN *is* set in both apps' prod env (verified) — so the blind spot was structural, not config.
- **Asymmetry explained:** the kiosk died (renderer) → frozen screen + leaked row; the agent received the guest's Agora `user-left` → reset to ready, but `handleEnd` **never finalized the row** either.

**Shipped (all TDD'd where logic exists, merged to `main`, deployed):**
1. **Reaper cron** `/api/cron/reap-stale-calls` (+ `lib/calls/reaper.ts`) — closes stale VIDEO `IN_PROGRESS` (keyed on `created_at`, >30m) as `FAILED`+`flagged_for_review`, and stale `RINGING` (>10m) as `NO_ANSWER`; self-reports to `health_signals`. **Daily `0 20 * * *`** (see Hobby note).
2. **Agent-side finalizer** `/api/calls/[id]/end-video` (operator-scoped, idempotent on `IN_PROGRESS`), wired into `video-call.tsx` `handleEnd` → a kiosk crash now closes the row in ~real time via the agent's `user-left`. The reaper is the both-sides-gone backstop.
3. **Kiosk connection resilience** — Agora `connection-state-change` via pure `interpretConnectionState`: `RECONNECTING` shows a "Reconnecting…" overlay; terminal `DISCONNECTED` finalizes (`failed`) + falls to the apology screen → home. (`reason==="LEAVE"` ignored.) Fixes the frozen-screen-on-network-drop case.
4. **Kiosk `ErrorBoundary`** — catches render errors → Sentry + auto-reload to the welcome screen (unattended tablet self-heals). Renderer hard-crash stays uncatchable in-page; reaper+finalizer keep server state correct there.
5. **Owner playbook pop-up** — `playbook-card.tsx` opened `window.open` **after** an `await` → silently blocked. Now opens the tab synchronously on click; clear toast if blocked.
6. **Portal `app/global-error.tsx`** — render errors in the agent/admin/owner dashboards were hitting a blank screen + never reaching Sentry (the portal analog of #4). Also cleared the Sentry build warning.
   Plus two review findings: **`call-ended` idempotency guard** (`.in("state",["RINGING","IN_PROGRESS"])`) so the agent-vs-kiosk finalize race can't clobber a COMPLETED row back to FAILED; and **`onAgentJoined` fires once on video** (was per published track).

**Commits** (branch `fix/video-call-resilience` → `--no-ff` merge `3293c14`): `84ec104` reaper · `369a62f` agent finalizer · `b031f78` kiosk resilience · `0ae4d95` owner popup · `f34b80c` review fixes + global-error · hotfix `b646e04` cron schedule. **Tests: portal 281, kiosk 16; typecheck + lint + both builds green.** Independent code-review pass done (feature-dev:code-reviewer) before merge.

**Vercel Hobby cron gotcha (re-confirmed the hard way):** Hobby **ERRORS the deploy** on a sub-daily cron (not silent-cap) — same failure as the historical `dpl_2HthWVCc`/`e197c0a` presence-sweep incident. My initial `*/15 * * * *` reaper was caught from the deploy history and hotfixed to daily `0 20 * * *` **before** it shipped. **Tighten to `*/15` if/when the project moves to Vercel Pro** (one-line in `apps/portal/vercel.json`).

**Open item — the one stuck prod row (`bfe29f15`):** a manual `UPDATE` to close it was **denied by the prod-data safety classifier** (out of scope for "push to prod"). It will be **auto-closed by the reaper on its next 20:00 UTC run** (the cron is now deployed). If Kumar wants it gone sooner, run the reaper manually (`GET /api/cron/reap-stale-calls` with the `CRON_SECRET` bearer) or close the row by hand.

**PICK UP HERE (fresh chat):**
1. **Prod smoke the resilience fixes** (deploy `dccqvap7f`, b646e04): (a) kiosk video call → agent answers → **kill the kiosk tab** mid-call → agent returns to ready AND the `calls` row finalizes (no longer leaks; verify in DB / owner call history); (b) mid-call, drop the kiosk's WiFi briefly → "Reconnecting…" overlay → restore → call continues; drop it hard → apology → home; (c) owner portal → property → **View** playbook → opens (no silent block); (d) confirm the reaper closed `bfe29f15` after 20:00 UTC.
2. **§5 emergency (933)** — still the last original smoke item; sequence unchanged (flip `EMERGENCY_DIAL_NUMBER=911→933` + redeploy only when kiosk+agent are ready, test the conference, restore `911` + verify). Prod emergency is still **`911`** (untouched).

---

## 2026-06-07 (session 7) — readiness-audit remediation SHIPPED (10 PRs merged) + emergency flipped to 933 for testing

The fix phase for the 2026-06-06 pre-launch readiness audit (`docs/audits/2026-06-06-readiness-audit.md` + `…-triage.md`). Worked the triage **BUG bucket + cheap freebies**, batched as PRs (HIGH isolated, MED/LOW themed), each TDD'd and verified `lint + typecheck + test + build`. **All 10 PRs merged to `main` (squash) + prod auto-deployed green** (final commit `21bfc3a`, prod `dpl_3m11ZZxkmz6…` READY on `lobby-connect-portal.vercel.app`).

**Merged (GitHub #):**
- **#1** atomic 911 trigger + dispatch-failure handling + REST timeouts (audit HIGH #2/#3/#8) — `lib/util/timeout.ts`.
- **#2** retry the 911 re-join read so a transient blip can't strand the guest (HIGH #1) — `lib/db/read-with-retry.ts`.
- **#3** reject OWNER on the 4 live-video routes + time-bound the incoming-video RINGING query (HIGH #4-A, MED #14-query). (Agent-scope tightening #4-B deferred to v2.)
- **#4** write the `user.deleted` audit row only AFTER a successful delete + graceful "deactivate instead" (HIGH #5-A). FK block stays (5-B intentional).
- **#5** call-finalization correctness: status webhook (#19/#20/#21), reaper duration + answered_at?:created_at staleness (#22/#23), cron **fail-closed** (#9-routes), kiosk one-call dedup (#12).
- **#6** presence: don't downgrade `ON_CALL`→`AVAILABLE` during a live video call (MED #15), server-side.
- **#7** low-risk cleanup: emergency/control state guard (#16), owner call-list order-by created_at (#28), AutoRefresh focus debounce (#30), bundle hygiene + drop `next-themes` (#31), broaden Sentry scrub regex both apps (#27).
- **#8** voice-webhook timeout via opt-in `createAdminClient({timeoutMs})` + `timeoutFetch` (#7), boot config validation in `instrumentation.ts` (#10). (Extracted `lib/kiosk/config-secret.ts` so instrumentation avoids a `node:crypto` webpack error.)
- **#9** migrations **0013 + 0014** (security/perf advisor hardening) — **APPLIED to prod + verified** (see below).
- **#10** dropped the cosmetic Added/Created columns from admin users + properties tables (Kumar's UI nit; `created_at` kept for ORDER BY).

**DB migrations 0013/0014 — applied to prod (`ztunzdpmazwwwkxcpyfp`) + verified via `get_advisors`:**
- 0013: 5 covering indexes for unindexed FKs; pinned `set_updated_at` search_path.
- 0014: revoked helper-function `EXECUTE` from PUBLIC/anon, re-granted to `authenticated` + `service_role` (0013's revoke-from-anon was a no-op — the vars were `sensitive` type / PUBLIC-granted). Verified anon=false, authenticated/service_role=true on all 7 SECURITY DEFINER helpers. No RLS policy targets anon.
- **Deferred to v2** (broad, forward-scale): `auth_rls_initplan` `(select auth.uid())` rewrite, multiple-permissive-policy consolidation, unused-index drops.

**Deferred per triage (NOT done):** INTENTIONAL-TRADEOFF (#5-B, #14-cron), DEFER-V2 (#4-B, #17, #18, #25, tails of #6/#11/#13), expensive ACCEPT-RISK (#6 E911 auto-validate, #11 kiosk-token revocation, #13 server uid, #24 terminal-state trigger, #32 SDK types).

**⚠️ EMERGENCY IS CURRENTLY 933 (NOT 911) — see [[TEMP-emergency-933]] (~/.claude memory).** Kumar asked to flip prod `EMERGENCY_DIAL_NUMBER`→`933` to test the emergency flow live. The original prod var was `sensitive` (value masks as '' on read); replaced with a `plain` var `933` + redeployed (`dpl_…itxdm4r7v`, aliased to the prod domain). **MUST be reverted to `911` before the pilot fields real calls** — set via Vercel REST API (the v52 CLI `env add` stdin pipe does NOT capture the value), then redeploy + verify. (How: token at `~/Library/Application Support/com.vercel.cli/auth.json`; `DELETE` then `POST /v10/projects/prj_SwRzM2yQQ58iCqj0Js9HZ5XTpBAJ/env?teamId=team_SS9GSqbP7VOjZRPyQK6vCATN` `{key,value:"911",type:"plain",target:["production"]}`.)

**Preview builds — FIXED (later in session 7).** Vercel Preview builds were red (portal env vars were Production-scoped only → previews died at `lib/env.ts`'s eager `required()`; not a regression). Resolved by adding all 18 portal env vars to the **Preview** scope (mirrored from `apps/portal/.env.local` via the Vercel REST API; `EMERGENCY_DIAL_NUMBER`=`933` in Preview so a preview can never dial real 911). Verified by redeploying a previously-failed preview → READY. Previews now build green + give clickable per-PR URLs. Tradeoff: Preview now shares **prod** Supabase/Twilio/Agora creds — the v1.2 sandbox isolates this by repointing the Preview vars at separate resources (overwrites, no conflict). Details in [[prod-infra-access]].

**NEXT MAJOR PHASE — UI/UX polish (do in a FRESH chat):** the app is still the barebones shadcn skeleton. Staged plan written: **`docs/plans/2026-06-07-ui-ux-polish-stages.md`** — Stage 0 = lock design direction (brainstorm first), Stage 1 = tokens + shadcn primitives (parallel-safe), Stage 2 = per-surface polish prioritized **Kiosk > Owner portal > Agent/Admin**, Stage 3 = states/motion/a11y/copy. Don't gate the pilot on it; don't start painting before the direction is locked.

**PICK UP HERE (fresh chat):**
1. **Revert emergency to 911** once Kumar finishes the 933 testing (see the TEMP memory) — and ASK him whether testing is done before assuming.
2. **Continue smoke / triage** any new issues Kumar surfaces from testing.
3. **When ready, start UI/UX polish in a fresh chat** per `docs/plans/2026-06-07-ui-ux-polish-stages.md` (Stage 0 brainstorm first).

---

## 2026-06-07 (session 8) — UI/UX Stage 0 design direction LOCKED (brainstorm only, no code)

Ran the Stage 0 brainstorm from `docs/plans/2026-06-07-ui-ux-polish-stages.md` using the visual companion
(mockups in `.superpowers/brainstorm/`, gitignored). **Output committed:**
`docs/specs/2026-06-07-ui-ux-stage0-design-direction.md` on branch **`docs/ui-ux-stage0-design`** (off `main`).

**Locked decisions:**
- **Brand thesis:** "a real person reached through a screen" — warm hospitality ⇄ cool automation, joined at *the seam*. Tone stays calm/trustworthy/professional.
- **Signature motif — the seam:** navy→mint→coral gradient used as line/ring work only (hairline under wordmark, ring around a connected caller, active-call edge). = the "Connected" shorthand.
- **Color:** ink `#2C425C` · coral `#F0795B` base / `#E05A39` deep-for-fills / `#BE4B2F` coral-text (AA) · mint live `#06D6A0` (`#048765` text) · emergency `#C81E1E` · cool neutrals (`#F6F8FA` page / `#EAEEF2` muted fill / `#E1E7EC` divider / `#919598` input border / `#5E6E85` muted text). (Started from Kumar's "B+" trio; vermilion → coral; kept ink+mint. **Stage 3 WCAG audit** darkened muted-text/live-text/input-border + added the coral-text token — `docs/audits/2026-06-08-wcag-2.1-aa-audit.md`.)
- **Type:** **Solitude** display serif (Envato, self-host, display-only) · **Outfit** sans for all UI/body (≈ Google Sans) · **JetBrains Mono** for data · **Vonique 43** all-caps labels. Rule: section headers ≤~20px use Outfit semibold, not Solitude (its hairlines break small).
- **Shape:** "Balanced" — card 12 / btn 9 / input 8 (kiosk softer); navy-tinted shadows. Motion: restrained, 150–250ms, transform/opacity, reduced-motion honored; mint pulse + seam drift only.
- **Per-surface:** Kiosk (warm/large-touch) > Owner (premium/mobile) > Agent-Admin (dense/operational). UX voice: calm, warm, plain-spoken.

**Open items carried into Stage 1 (in the spec §8):**
1. **Envato license check** — confirm Solitude + Vonique 43 permit web embedding / self-hosting BEFORE shipping them (proxies otherwise: Playfair Display / Jost).
2. Decide if Vonique 43 label tier is worth a 3rd self-hosted font for v1, or defer labels to Outfit all-caps.
3. Final token names to match shadcn's CSS-var contract during the primitive re-skin.

**Stage 1 prep notes (in spec §7):** Tailwind v4 CSS-first `@theme`; mirror tokens in `apps/portal/app/globals.css` + `apps/kiosk/src/index.css`; **delete the stray `--kiosk-navy: #0f1f3d` / `--kiosk-cream` "Jazz Club" hex** in kiosk `index.css` (leftover from the *Back of House* project); replace the generic shadcn-blue `--color-primary` + unused `--sidebar-*`/`.dark` block; re-skin shadcn primitives at the token layer, don't fork.

**PICK UP HERE (fresh chat):**
1. **Review/approve the Stage 0 spec** if not already, then run the **writing-plans** skill to produce the Stage 1 (Foundation) implementation plan off `docs/ui-ux-stage0-design`.
2. **Resolve open item #1 (Envato license)** before Stage 1 wires the real fonts.
3. Emergency is still **933** (TEMP) — unrelated to this branch, but revert to 911 before pilot calls (see [[TEMP-emergency-933]]).

---

## 2026-06-07 (session 9) — UI/UX Stage 1 (Foundation) SHIPPED + merged to main + prod

Executed Stage 1 of the UI/UX polish via **subagent-driven development** (fresh implementer per task +
two-stage spec/quality review). Branch `feat/ui-ux-stage1-foundation` → **PR [#13](https://github.com/kthakkar1983/lobby-connect/pull/13)
merged to `main` + prod auto-deployed**. The locked Stage 0 design-direction doc rode along in the same PR.
**326 tests green**, typecheck + lint + both builds clean.

**Open item #1 (Envato license) RESOLVED:** Kumar confirmed the license → Stage 1 **self-hosts the real
Solitude + Vonique 43** (no proxies). Solitude shipped only `.ttf` → converted to `.woff2` via `fonttools`.

**What shipped (7 commits + 1 review-fix commit):**
- **Brand token layer** (Tailwind v4 `@theme`) in `apps/portal/app/globals.css` + mirrored in
  `apps/kiosk/src/index.css`: navy/coral/mint palette + cool neutrals (exact hex from the Stage 0 spec §2),
  navy-tinted shadow scale, radius scale (kiosk one step softer), coral focus ring, `--gradient-seam`,
  and `--font-sans/mono/display/label` slots. Removed the generic shadcn oklch palette + dead `.dark` block
  + `--sidebar-*` + `@custom-variant dark` (light mode only).
- **Fonts self-hosted:** portal via `next/font` (`app/fonts.ts` — Outfit + JetBrains Mono google; Solitude +
  Vonique 43 local woff2 in `app/fonts/`), attached to `<html>` via `fontVars`. Kiosk via `@font-face`
  (`public/fonts/`, all four). Dropped the transient `@fontsource` kiosk deps after copying the woff2 out.
- **shadcn primitive re-skin** (token layer, NOT forked): button, input, textarea, badge, table, dialog,
  alert-dialog, dropdown-menu, select, sheet, tooltip, sonner, skeleton, switch, separator — radius/shadow/
  color/focus-ring. New **`card.tsx`** primitive. New `accent` (deep-coral CTA) + `live` (mint) variants.
  Brand 2px+offset focus ring + tactile `active:translate-y-[1px]`.
- **Shared `Wordmark`/`LogoMark`** (`components/brand/wordmark.tsx`) with the navy→mint→coral seam hairline;
  wired into admin sidebar, owner + agent headers, sign-in, onboarding. Logo = home preserved everywhere.
- **Removed Back-of-House "Jazz Club" `--kiosk-*` hex** from kiosk index.css; repointed the 4 affected
  kiosk screens' inline styles to brand tokens.

**Final cross-cutting review caught a real regression (fixed before merge):** Task 2 deleted the
`--sidebar-*` tokens as "cruft," but `sidebar.tsx` actually uses ~20 `bg-sidebar*`/`border-sidebar*`
classes → admin sidebar rendered with no background/highlight (build still passed — classes resolved to
transparent). **Fix:** restored `--color-sidebar-*` aliased to brand tokens in globals.css. Also fixed a
coral flash on the dialog close button (`bg-accent`→`bg-muted`) + added a sidebar home-link `aria-label`.

**Deliberately DEFERRED to Stage 2** (background-task chip filed): kiosk **video screens**
`Connected.tsx` + `Ringing.tsx` still carry hardcoded hex (dark video letterbox backdrops `#000`/`#27272a`,
glassy `rgba(...)` controls, old Jazz Club navy `#0f1f3d`, red `#b91c1c`). They are the most repaint-heavy
screens; half-tokenizing them now would be worse than the clean Stage 2 kiosk repaint. The named `--kiosk-*`
index.css vars the Stage 0 spec §7 called out ARE gone.

**Visual verification note:** authed surfaces (admin sidebar, owner/agent) weren't eyeballed locally —
confirm fonts/wordmark-seam/sidebar render on the prod deploy. Foundation is token-level so risk is low and
all gates passed.

**Stage 1 PICK UP HERE (now superseded — Stage 2 kiosk done below):**
1. ~~Visually confirm Stage 1 on prod.~~ 2. ~~Start Stage 2 kiosk.~~ — both addressed in session 9.

---

## UI/UX Stage 2 — Kiosk (surface 1 of 3) — DONE, PR open (session 9)

**Branch `feat/ui-ux-stage2-kiosk` → PR #14 (open, NOT merged to main).** Spec:
`docs/specs/2026-06-07-stage2-kiosk-repaint-design.md` · Plan: `docs/plans/2026-06-07-stage2-kiosk-repaint.md`.
Built subagent-driven (5 implementer units, each spec+quality reviewed; final whole-branch review =
READY TO MERGE). Full gate green (350 tests), zero stray hex in `apps/kiosk/src`, all nine states
eyeballed via a throwaway harness.

**What shipped:**
- Every kiosk screen repainted: Home (concierge split 55/45, static "Good evening." display greeting +
  hotel name as the small Vonique label), recording notice (coral Continue + top-right X), Ringing/
  Connected (seam **ring→frame** motif, shared `CallControls`, coral End/Cancel — **no red on kiosk**),
  Apology (apology-only copy, no phone, visible mono countdown), repainted Loading + Reconnecting.
- New `--color-call: #14202F` deep-navy video token; `CLOSE_DISCLOSURE` state transition; the deferred
  `Connected`/`Ringing` hardcoded hex (the §7 cleanup) is now GONE.
- **Owner-selectable Home style `kiosk_cta_style`** (`warm` default / `accent` / `classic`) end-to-end:
  migration **0015** (column text+CHECK+default + extends the 0010 owner column-guard whitelist) +
  owner-portal Appearance picker (in the existing kiosk-content card, same Edit/Save txn, audited) +
  config API (`ctaStyle`) + kiosk `Home` rendering. Enum identical across all 10 layers.

**⚠️ Prod state asymmetry (important):**
- **Migration 0015 IS APPLIED + verified on prod** (`ztunzdpmazwwwkxcpyfp`; existing property defaulted to
  `warm`). Safe ahead of code — additive, old app ignores the column.
- **App code is NOT live on prod** — it's on PR #14, not merged. Vercel prod deploys from `main` only.

**Intentional deviations (documented in spec):** Connected shows "Front desk" (kiosk has no agent name);
`accent` preset uses base coral (`text-accent`) for AA on navy.

**PICK UP HERE (fresh chat):**
1. **Merge PR #14** to `main` (Vercel auto-deploys kiosk+portal prod) once reviewed. Migration already live.
2. **Stage 2 surface 2 — Owner portal repaint** (mobile-first; the Appearance picker control already landed
   in this PR and will slot in). Then surface 3 — Agent/Admin. Parent plan:
   `docs/plans/2026-06-07-ui-ux-polish-stages.md`. Each its own fresh-chat PR.
3. Then **Stage 3** — states/motion/a11y/copy pass.
4. Emergency is still **933** (TEMP, unrelated) — revert to 911 before pilot calls (see [[TEMP-emergency-933]]).

---

## UI/UX Stage 2 — Kiosk MERGED + Owner portal (surface 2 of 3) DONE, PR open (session 10)

**Kiosk surface:** **PR #14 merged to `main`** (squash `73bb722`) — Vercel auto-deploys kiosk+portal prod. Migration 0015 was already live. Stage 2 surface 1 complete + shipped.

**Owner portal surface:** **Branch `feat/ui-ux-stage2-owner` → PR [#15](https://github.com/kthakkar1983/lobby-connect/pull/15) (open, NOT merged).** Spec `docs/specs/2026-06-07-stage2-owner-portal-repaint-design.md` · Plan `docs/plans/2026-06-07-stage2-owner-portal-repaint.md`. Brainstormed via the visual companion (mockups in `.superpowers/brainstorm/`, gitignored): chose Home layout **C** (rich cards only), list rows **A** (card rows), detail header **A** (identity header). Built **subagent-driven** (17 tasks, fresh implementer per task + per-task spec+quality review + a final whole-branch review). Full gate green: portal 337 + kiosk 21 + shared 6 tests, lint + typecheck + both builds.

**What shipped (token/composition layer only — ZERO route/data-fetching/RLS/API/migration changes):**
- **Shared `greetingForHour`** (`packages/shared`) — time-of-day greeting from viewer-local hour (boundaries 0–10 morning / 11–16 afternoon / 17–23 evening). Wired into a hydration-safe owner `Greeting` island AND the **kiosk Home** (replaced the hardcoded "Good evening.").
- **New owner components:** `StatTile`, `StatusPill` (+ pure `lib/owner/status-pill.ts` mapping), `SectionCard`, `CallRow`, `IncidentRow`, `Greeting`.
- **`lib/owner` helpers:** brand-token presence dots + `isLivePresence` + `formatTimeOnly` (format.ts); `dayGroupLabel` + `latestCallTime` (summary.ts). Removed now-dead `BadgeVariant`/`callStateBadgeVariant`/`incidentStatusBadgeVariant`.
- **Screens repainted:** shell (seam hairline under header + coral active nav), Home (rich property cards: greeting + agent presence dot + Calls-today/Open/Last-call StatTiles + **mint** live-edge / **red** open-incident edge), Calls list (day-grouped card rows + filter chips), Call detail (identity header + SectionCards), Incidents list (card rows, "911 Emergency"), Incident detail (status-colored header), Property detail (identity header + agent presence + SectionCards + CallRow recent), kiosk-content + playbook cards (SectionCard chrome), on-brand loading skeletons.
- **Brand semantics enforced:** incidents/911 → `destructive` (red); coral (`accent`/`accent-strong`) = brand accent only (active nav, links, StatTile alert); mint (`live`) = live presence / completed calls.

**Final whole-branch review found + FIXED 3 (commit `1a4c4c5`):** StatTile alert was red → changed to coral per spec §3.2; removed dead `*BadgeVariant` helpers + their tests; IncidentRow siren chip now neutral when resolved (was always red).

**PICK UP HERE (fresh chat):**
1. **Review/merge PR #15** to `main` (Vercel auto-deploys portal+kiosk prod; **zero migrations** — nothing to apply). Optional: visually eyeball owner screens on the deploy (mobile + md+) + the kiosk time-aware greeting, per plan Task 17 §2.
2. **Stage 2 surface 3 — Agent/Admin repaint** (operational, desktop; function over flair). Then **Stage 3** — states/motion/a11y/copy. Parent plan `docs/plans/2026-06-07-ui-ux-polish-stages.md`; each its own fresh-chat PR.
3. Emergency is still **933** (TEMP, unrelated) — revert to 911 before pilot calls (see [[TEMP-emergency-933]]).

---

## 2026-06-08 (session 11) — UI/UX Stage 2 surface 3 (Agent/Admin repaint) DONE → merged to main + prod-deployed

Brainstormed (visual companion) → spec → plan → **subagent-driven build (12 tasks, fresh implementer + spec-review + quality-review each, final whole-branch review)** → merged to `main` (`--no-ff` merge `a0f7cf6`) → **Vercel prod deploy `dpl_74ACE5…` READY** on `lobby-connect-portal.vercel.app`. Tag `plan-stage2-agent-admin-complete`. Branch deleted. **All three Stage-2 surfaces (kiosk, owner, agent/admin) now shipped.** 347 portal tests green; typecheck + lint + build clean. **Zero migrations, zero new API routes, zero call/Agora/softphone-logic changes.**
Spec: `docs/specs/2026-06-08-stage2-agent-admin-repaint-design.md` · Plan: `docs/plans/2026-06-08-stage2-agent-admin-repaint.md`.

**Scope decided in brainstorm:** repaint **+ light read-only data** (unlike owner's pure-composition rule) so the agent dashboard + admin overview are genuinely useful. Reads go through the existing user-scoped RLS client.

**What shipped:**
- **New `lib/dashboard/` pure helpers (TDD):** `countToday` + `avgPickupSeconds` + `sumTodayDurationSeconds` (per-call property-tz "today"), `countOnlineAgents` (reuses `isStale` 90s + `isLivePresence`), `lineStatusFromPhase` + a no-op-default React **`LineStatusContext`**.
- **New `components/dashboard/`:** `GreetingLine` (hydration-safe serif greeting), `LineBeacon` (mint solid up / red flashing down, reduced-motion → solid), `LineStatusProvider`.
- **Agent dashboard** (`(agent)/agent/page.tsx` + `layout.tsx`): greeting hero + top-right line beacon, **Today / Avg pickup / Talk time** stat strip, recent-calls list, right rail = softphone (decorative **rotating seam-glow ring**) + coverage list; header gains the shared **UserMenu** + seam hairline; wrapped in `LineStatusProvider` so the softphone reports `phase` → the beacon reads it.
- **Admin overview** (`(admin)/admin/page.tsx`): **operations board** — Agents-online / Calls-today / Open-incidents (glance, no drill-down) / Accepting stat strip + **properties ops table** (property · primary agent **+ stale-aware presence dot** · calls-today · inline **Covering** toggle = the one existing `accepting_calls` write, extracted to `AvailabilityToggle`). **No Kiosk column** (kiosk `/api/kiosk/heartbeat` is a **no-op** → kiosk-online not readable without a write; dropped).
- **Softphone** (`components/softphone/softphone.tsx`): chrome-only — mint **Accept**, **coral Hang up**, connection dot → mint/grey, in-call **seam edge**; **Emergency relocated** out of the action row to a divided full-width **solid-red "Call 911"** below the notes; reworded confirm dialog ("Call emergency services (911)?" + non-emergency-number warning + a **forward-compat seam comment** for the cut admin/owner/GM notify); banners tokenized to `destructive`; idle **seam glow ring**. **All call handlers/effects/refs unchanged** (verified) — only added one beacon `useEffect`.
- **Video overlay** (`components/video-call/*`): chrome-only — header (mint dot + "On video · {hotel}"), **40/60** split on deep-navy **`--color-call`** (new @theme token), **seam-framed** self-view PiP, branded **playbook loading skeleton**, **coral End**, greyed Hold/Swap. **No red anywhere in video.** Incoming banner → mint pulse + mint Accept. Agora/fetch logic untouched; playbook iframe stays **sandbox-less** (Chrome PDF).
- **Tables/status/detail:** **zebra** on the dense audit table (hairline elsewhere), filled **status pills** (role/user-status/property-active), status-card dots → **mint healthy / coral degraded / red down** (no new amber token — coral serves degraded), **SectionCard** chrome on assignment + kiosk-link cards, property-form already on primitives, **loading.tsx** for users/properties/audit + agent + admin, tokenized empty states.
- **Shared chrome:** sidebar active item = **coral** (`accent-strong`), admin header seam hairline (mirrors agent/owner), user-menu already on-brand.

**Brand semantics enforced:** **red = 911 / destructive only** (End/Hang up are coral); mint = live/Accept/healthy; coral = accent **and** degraded status. No hardcoded hex outside the globals `@theme` token layer (mint-glow extracted to `--color-live-glow`).

**Notable decisions/finds during the build (reflected in spec/plan):**
- **"Missed" → "Talk time":** agent `calls_select` RLS only exposes `handled_by_user_id = auth.uid()`, so unanswered (NO_ANSWER, no handler) calls aren't agent-readable → can't do "Missed" read-only. Replaced with **Talk time today** (sum `duration_seconds` over handled calls), fully readable. (Caught by the quality review; spec/plan updated.)
- **Nested PostgREST selects type as `never`** here (generated types lack Relationships) → used the project's **2-query pattern** everywhere (assignments→property/agent names via `.in()` + Map merge). `requireRole` returns no `full_name`/`email` → separate `profiles` query.
- Final review verdict: ready to merge; applied a polish pass (tokenized mint glow, **stale-aware admin presence dot**, hotel name in video header, coverage list keyed by id).

**Deferred (intentional):** video **elapsed timer** (v1 omit per plan); `StatusPill` reuse vs inline table pills (cosmetic). **Solitude capital-W** font fix filed as its own task chip (crossed-W reads "V"; no OpenType alternate — decide swap-font vs accept; cross-cutting across all 3 surfaces).

**PICK UP HERE (fresh session):**
1. (Optional) eyeball the agent/admin surfaces on prod (`lobby-connect-portal.vercel.app`) — authed screens weren't browser-verified locally (token-level + all gates passed, risk low). Check: agent dashboard idle (beacon mint→red when line drops), audio in-call (mint Accept → coral Hang up → divided red 911 + dialog), incoming/active **video** (deep-navy stage, seam PiP, playbook skeleton→PDF, coral End), admin ops board + Covering toggle, audit zebra, status dots, property detail SectionCards, coral active nav; toggle OS reduce-motion to confirm glow/flash/pulse/shimmer stop.
2. **UI/UX Stage 3** — states/motion/a11y/copy pass (the last UI/UX phase; all 3 surface repaints now done). Fresh chat; parent plan `docs/plans/2026-06-07-ui-ux-polish-stages.md`.
3. **Solitude-W** font decision (own task) — swap the display serif or accept.
4. Emergency is still **933** (TEMP, unrelated) — revert to **911** before pilot calls (see [[TEMP-emergency-933]]).

---

## 2026-06-08 (session 12) — UI/UX Stage 3 (states/motion/a11y/copy) DONE → merged to main. **All UI/UX phases complete.**

The final UI/UX phase. **Logic-orthogonal** (no migrations/routes/RLS/API/call-logic). Merged via
PR [#16](https://github.com/kthakkar1983/lobby-connect/pull/16) (`21906d0`), tag
`plan-stage3-states-motion-a11y-copy-complete`. Spec/plan/audit:
`docs/specs/2026-06-08-stage3-states-motion-a11y-copy-design.md` ·
`docs/plans/2026-06-08-stage3-states-motion-a11y-copy.md` ·
`docs/audits/2026-06-08-wcag-2.1-aa-audit.md`.

**What shipped (4 tracks):**
- **Motion:** `--ease-out`/`--ease-in-out`/`--duration-fast|standard|slow` tokens mirrored portal⇄kiosk;
  the Stage 0 **seam drift** finally built (`@property --seam-angle`, 8s, **active-call surfaces only** —
  kiosk Connected ring, softphone in-call edge + idle ring); brand `Skeleton` shimmer (`.lc-skeleton`);
  `Button` `transition-all`→explicit props + token timing; **universal `prefers-reduced-motion` net** in
  both apps' CSS.
- **States:** new `EmptyState` + `ErrorState` primitives (`components/ui/`) wired into all **9** zero-item
  sites; on-brand `global-error` + new segment `error.tsx` (agent/admin/owner); kiosk first-load +
  reconnecting given `role=status aria-live`.
- **A11y — formal WCAG 2.1 AA audit + remediation.** Structural layer already mostly passed. Fixes:
  contrast `muted-foreground #64748B→#5E6E85`, `live-foreground #048A67→#048765`, **new
  `--color-accent-text #BE4B2F`** for coral text/links (7 sites), mint **Accept**→navy text;
  **D1** (locked) keep coral `#E05A39`, white-on-coral CTA labels bumped to WCAG **large text**
  (≥18.66px bold: Hang up/End/Continue); **D2** (locked) `--color-input→#919598` (form controls only,
  `--color-border` unchanged); **skip-to-content** links + `<main id="main">` (2.4.1) in all 3 authed
  layouts; `sr-only` h1 on agent/owner home (2.4.6).
- **Copy:** light shared `lib/copy.ts` (+ kiosk `src/lib/copy.ts`); sign-in errors migrated (strings
  unchanged, test still asserts); Stage 0 voice pass. **No i18n framework.** 911 confirm stays inline
  (safety-critical, more thorough than the module draft).

**Process:** spec+plan → formal WCAG audit (paused for Kumar's D1/D2 calls) → build → whole-branch review
(2 important + 5 minor; both important — portal seam-drift was dead code, 6 coral-text sites missed via a
bad grep — fixed; minors addressed/documented). 347 tests green; portal typecheck+lint+build + kiosk
typecheck+build green.

**Repo hygiene:** caught + removed an accidental 15M-line `graphify-out/` commit (over-broad `git add -A`);
`graphify-out/` + `supabase/snippets/` now gitignored.

**Open follow-ups (non-blocking):**
1. **Live in-browser pass** (do during smoke): visual confirm of empty/error/loading states, the seam-drift,
   skeleton shimmer; screen-reader run on the kiosk flow + a portal form; focus-order; reduced-motion
   emulation. Stage 3 **contrast is math-verified, not eyeballed** — eyeball the enlarged coral
   Hang up/End buttons + seam drift in particular.
2. Kiosk CTA-picker `radiogroup` upgrade (current `aria-pressed` buttons are a valid pattern; deferred).
3. **Solitude capital-W** font fix (own task, unchanged).
4. Emergency still **933** (TEMP) — revert to **911** before pilot calls ([[TEMP-emergency-933]]).

**Bigger picture — all four UI/UX phases now shipped** (Stage 1 foundation + 3 Stage 2 repaints + Stage 3).
The remaining product work is the **pilot launch**: finish the §5 emergency (933) smoke item, the live
UI/UX visual pass above, flip emergency to 911, then go-live. See the PILOT LAUNCH section above + the smoke
checklist.

### NEXT (fresh chat) — page-by-page final-polish pass (requested 2026-06-08, session 12)

Kumar's call after reviewing Stage 3: the staged work is done, but he wants a **manual, page-by-page
walkthrough of the whole app to add a final layer of polish** — this is hands-on/iterative, not another
staged plan. Specifically requested:
- **Subtle shadows** and **bounce animations**, **at least on the kiosk** (guest-facing, warm/friendly —
  the right surface for a little delight; keep the operational agent/admin dashboards crisp, no bounce).
- Go **one page/screen at a time**, eyeball it, polish.

Craft notes for that pass (Emil lens): bounce stays **subtle** (`spring` bounce ~0.1–0.3, or a small
overshoot) and only on **occasional/playful** interactions — the kiosk CTA tap, the "Connected" moment,
screen entrances — never on things seen 100×/day. Shadows use the existing navy-tinted
`--shadow-sm/md/lg` tokens (don't invent black shadows). Honor `prefers-reduced-motion` (the global net is
already in place — bounce/spring must be gated). Kiosk already has `lc-pulse`/`lc-spin`/`lc-seam-drift`
keyframes to build on. No `framer-motion` dep yet — decide CSS spring/`@keyframes` vs adding Motion if a
real spring is wanted (CSS keyframes can't truly spring; a small `cubic-bezier` overshoot can fake it).
Best paired with the live in-browser visual pass (run the kiosk + portal, polish what you see).

---

## 2026-06-08 (session 13) — emergency reverted to 911 + kiosk ~120s video disconnect FIXED; v1 reported working

Two pilot-blocking items closed this session. Kumar reports **every v1 feature working from his testing**, and
the **§5 emergency 933 smoke is DONE/cleared** — the last original smoke item is no longer outstanding.

**1) Prod emergency dialing REVERTED `933` → `911` (DONE + verified).** The TEMP testing override is undone —
prod emergency now dials real 911, safe for the pilot. Did it via the **Vercel CLI** (the cached REST token in
`auth.json` returned `invalidToken` even though `vercel whoami` worked — these `vca_` OAuth tokens are
refreshed per-CLI-call, so prefer the CLI over hand-rolled curl). **Gotcha hit + recorded:** `vercel env add`
over a stdin pipe **silently stores an empty string** (CLI 52.2.1) — first attempt left `EMERGENCY_DIAL_NUMBER=""`
(caught on the decrypted pull). Correct path: `vercel env rm … production -y` then
`vercel env add … production --value 911 --no-sensitive --yes` (the `--no-sensitive` keeps it decryptable so
`vercel env pull --environment=production` can verify it = `911`), then `vercel redeploy <prod-url> --target production`
(env binds at deploy). Verified decrypted `911` **post-deploy**. `TEMP-emergency-933.md` memory **deleted**;
the env-management lesson is in `~/.claude` `build-quirks`. (Kumar's call: no more live 911 testing — he'll be
on-property during the pilot and can dial 911 by hand if needed.)

**2) Kiosk video calls dropped at ~120s — root-caused + FIXED + confirmed in prod (commit `f26488a`).**
Symptom (seen before, intermittently): a connected video call abruptly disconnects ~2min in; the **agent
returns home** but the **kiosk freezes on the Connected screen** — no apology, no reconnect, no home.
- **Not** instability and **not** a backend dial cap. **Root cause:** `apps/kiosk/src/App.tsx` arms a 120s
  no-answer ring timer when ringing starts (`onAccept`), and the only thing that cleared it was `teardown()` —
  which *connecting* never calls (`onAgentJoined` only dispatched `AGENT_JOINED`). So it ran through the live
  call and fired at ~120s: `teardown()` left the Agora channel (→ agent saw `user-left` → `/end-video`
  finalized **COMPLETED** → agent home), while `dispatch(RING_TIMEOUT)` was a **no-op** on the `connected`
  screen → kiosk stranded.
- **Evidence (decisive):** prod `calls` rows — the two stuck calls ended at **123s and 121s** ring-to-end
  (≈120s timer + a few s for the agent to react) vs **<85s** for every clean hang-up. (Token TTL is 3600s and
  the reaper is 30min, so both were ruled out.)
- **Fix (TDD, two layers):** `onAgentJoined` now **clears the ring timer** on connect (primary); the timer
  callback bails via a new tested pure guard **`shouldFireRingTimeout(screen)`** (true only when `"ringing"`)
  using a live `screenRef` (defense-in-depth). Legit no-answer path unchanged (no agent in 120s → apology).
  24/24 kiosk tests, typecheck, lint green. Pushed straight to `main` (Kumar's call), kiosk deploy
  `il35eji3l` READY, **confirmed by a clean 4-minute prod call.** Bug+fix detail also in `~/.claude` `build-quirks`.
- **Deferred follow-up (noted, NOT built):** the kiosk has **no self-recovery watchdog** — if Agora events
  (`user-left`/`connection-state-change`) never fire, nothing else moves it off `connected` (it does NOT poll
  call state; heartbeat is one-way fire-and-forget). A belt-and-suspenders watchdog (poll `/api/kiosk` call
  state, or detect remote-gone independently) was scoped but deferred. This fix removes the known cause.

**PICK UP HERE (fresh chat) — the Solitude capital-W font fix:**
1. **Solitude-W font decision** — the display serif's capital **W** has a crossed center stroke that reads as
   **"V"** (e.g. "Welcome" → "Velcome"); there is **no OpenType stylistic-alternate** in the shipped face.
   Decide: **swap the display serif** (find a comparable warm display serif whose W is clean — Stage 0 proxy
   was Playfair Display) **vs accept** it. Cross-cutting: Solitude is used display-only across kiosk + owner +
   agent/admin headings (`--font-display`, self-hosted woff2 in `apps/portal/app/fonts/` + `apps/kiosk/public/fonts/`).
   If swapping, replace the font files + `--font-display`/`@font-face` wiring in both apps; re-verify headings.
2. (Optional, after fonts) the **page-by-page final-polish pass** (kiosk shadows/bounce, §ABOVE) + the
   **live in-browser visual/a11y pass** (Stage 3 contrast is math-verified, not eyeballed; confirm empty/error/
   loading states, seam-drift, skeleton shimmer, reduced-motion, screen-reader on kiosk flow).
3. Prod emergency is now **911** (reverted + verified this session) — no longer a pre-pilot action item.

---

## 2026-06-09 (session 14) — display + label fonts SWAPPED (Solitude→Atelier, Vonique→Radon); crossed-W fixed

The session-13 "PICK UP HERE" font task — **done.** The crossed-W wasn't only Solitude (display); **Vonique 43
(the all-caps label font) has the same crossed-W** ("WI-FI"→"VI-FI", "WESTIN"→"VESTIN"), surfaced while
mocking. So the fix is a **two-slot swap**, both apps:
- **`--font-display`: Solitude → Atelier** (an Envato *modern serif* — keeps the warm-serif brand voice, clean W). Headings everywhere (kiosk + owner + agent/admin), CTA, greeting. Single weight (400), like Solitude.
- **`--font-label`: Vonique 43 → Radon** (Envato "classy elegant display"). All UPPERCASE labels both apps. Radon ships ONE outline; declared across `400 700` (next/font/local `weight:"400 700"` + kiosk `@font-face{font-weight:400 700}`) so the 33 `font-semibold` labels use the real outline, **no faux-bold**. Radon's **capital** W verified clean in-browser (the label slot is uppercase, so its lowercase ligatures don't show there — an earlier "Radon for the CTA, Outfit for utility labels" idea was floated then dropped; Kumar's final call = Radon for labels, Atelier for everything else).

**Decision process:** built faithful side-by-side kiosk mockups (exact brand tokens, real woff2) via a throwaway
HTML harness + Playwright screenshots, comparing Solitude vs Atelier vs Radon, the W stress-test (hotel brands:
Westin/Wyndham/Waldorf/WI-FI), and Radon's caps-W at label sizes. Mockups were in `/tmp` (not committed).

**Pure font-definition + token-layer change — NO component edits** (every surface uses the `font-display`/
`font-label` Tailwind classes, which resolve through the CSS vars). Files: `apps/portal/app/fonts.ts`,
`apps/portal/app/globals.css`, `apps/kiosk/src/index.css`; added `Atelier-Regular.woff2` + `Radon.woff2` to
`apps/portal/app/fonts/` + `apps/kiosk/public/fonts/`, removed `Solitude.woff2` + `Vonique43.woff2` from both.
Net font count flat (−2/+2). Envato license already confirmed in Stage 1.

**Verified:** monorepo typecheck + both `build`s green; no stale Solitude/Vonique refs; live kiosk dev runtime —
`--font-display`→Atelier, `--font-label`→Radon, both faces `document.fonts` loaded (Radon as `400 700`). The
kiosk **Home** screen itself needs a `?t=` config link so it wasn't screenshotted in-app; fonts proven via the
identical-asset mockups + the runtime font-load probe. **Committed straight to `main`** (Kumar's call) → Vercel
auto-deploys both apps.

**PICK UP HERE (fresh chat):**
1. **(Optional) eyeball the real kiosk Home** on the deploy via a `?t=` link — confirm Atelier headings + Radon
   kicker/labels render (esp. a W-bearing hotel name + "WI-FI").
2. **Page-by-page final-polish pass** (NOT started — Kumar deferred it this session): kiosk **subtle shadows +
   bounce** on playful moments (CTA tap, "Connected", screen entrances; gate on `prefers-reduced-motion`; keep
   ops dashboards crisp/no bounce), one screen at a time, plus the live in-browser visual/a11y pass. Craft notes
   in the session-12 "NEXT" block above.
3. Prod emergency is **911** (safe). v1 reported working; pilot launch is the remaining product work.

---

## 2026-06-10 (session 15) — comprehensive architecture audit (48 findings) + P0-1, H2, H3 fixed

Kumar ran a 54-agent comprehensive architecture audit (5 dimensions: architecture, duplication, performance, scalability, maintainability). **48 confirmed findings, 1 refuted.** Full report was presented in the session. Audit doc to be written to `docs/audits/2026-06-10-architecture-audit.md` (not yet done — flagged in TASKS.md).

**Work done this session (3 commits to `main`):**

1. **P0-1 (process):** Merged `docs/readiness-audit-2026-06-06` branch → `main`. The readiness-audit + triage docs (`docs/audits/2026-06-06-readiness-audit.md` + `…-triage.md`) are now on `main` and accessible to every future session. This was the M5 finding: institutional memory of 14 ACCEPT-RISK + 4 DEFER-V2 decisions was only on an unmerged branch.

2. **H3 (video answer race — HIGH):** `apps/portal/app/api/calls/[id]/answer-video/route.ts` — the guarded UPDATE now uses `.select("id")`. Zero rows returned = the concurrent accept won; we return 409. The ON_CALL presence write is gated to the winner only. Previously both concurrent acceptors got `200 + channelName` and both stamped ON_CALL. New test in `tests/app/calls/answer-video.test.ts` covers the race scenario.

3. **H2 (owner stale presence — HIGH):** Added `effectivePresence(status, lastSeenAt, nowMs): PresenceStatus` to `apps/portal/lib/voice/presence.ts` — the single derivation of agent reachability. Owner home (`app/(owner)/owner/page.tsx`) now fetches `last_seen_at` and bakes effective presence into cards at read time. Previously the page showed raw `status` with no `last_seen_at`, so a crashed agent showed mint "Available" for up to 24h. 3 new tests in `tests/lib/voice/presence.test.ts`.

**Test count: 351 (up from 347).**

**Also shipped this session:** `TASKS.md` + `dashboard.html` (productivity system) — tracks all 48 audit findings across 4 phases.

**PICK UP HERE (fresh chat):**
1. **H1 (stale-closure notes loss — HIGH, the live bug):** softphone.tsx + video-call.tsx silently drop agent notes when the guest hangs up first. Root cause: `call.on("disconnect", ...)` is wired inside a mount effect but `endCall` captures the first-render closure (roomNumber + notes both `""`). Fix requires ref-mirroring roomNumber/notes (kiosk's own documented pattern) + a jsdom+testing-library test lane (portal has no jsdom/RTL today). This is the most impactful remaining Phase 1 fix.
2. **Phase 2 seam extractions** (after H1): `requireApiActor()` in `lib/auth/api-actor.ts` is the highest-leverage single change — dedupes 7+ hand-rolled API preambles AND is the v2 multi-tenancy seam.
3. **Page-by-page final-polish pass** (kiosk shadows/bounce + live in-browser visual/a11y pass) — still not started; not blocking.
4. **Save audit to repo:** `docs/audits/2026-06-10-architecture-audit.md` — should be written before next session so future sessions can reference the findings.
5. Prod emergency is **911** (safe, unchanged this session).

---

## 2026-06-10 (session 16) — H1 fixed (stale-closure notes loss)

**H1 is DONE.** Commit `df1d38f`, pushed to `origin/main`, Vercel auto-deploys portal.

**Root cause (confirmed):** `endCall()` in `softphone.tsx` used `useCallback([roomNumber, notes])`, but `call.on("disconnect", () => void endCall())` was registered inside a `useEffect([], [])` — it captured the *initial* `endCall` with `roomNumber=""` / `notes=""`. Identical issue in `video-call.tsx`: `handleEnd()` is a plain render-body function closing over state; `c.on("user-left", () => void handleEnd())` captured it at mount. When the guest/SDK hung up, notes were silently dropped every time.

**Fix:** ref-mirror both values in both components (`roomNumberRef.current = roomNumber` in render body); `endCall`/`handleEnd` read `roomNumberRef.current` / `notesRef.current`. `endCall` deps reduced to `[]`. Stale closures now reach mutable refs.

**Data flow (for reference):** room number + notes are POSTed to `POST /api/calls/notes` → saved to `calls.room_number` + `calls.notes` columns in Supabase, scoped to the agent who handled the call (`handled_by_user_id = user.id`).

**jsdom + testing-library lane added (first component tests in the portal):**
- `vitest.jsdom.config.ts` — separate Vitest config with `@vitejs/plugin-react` + jsdom, covers `tests/components/**`
- `vitest.config.ts` — excludes `tests/components/**` from node run
- `package.json` test script runs both configs
- `tests/components/softphone.test.tsx` — mounts real Softphone, fires SDK disconnect, asserts notes API received typed values
- `tests/components/video-call.test.tsx` — same via Agora user-left

**Test count: 353 (351 node + 2 jsdom). Typecheck clean.**

**PICK UP HERE (fresh chat):**
1. **Phase 2 seam extractions** — `requireApiActor()` in `lib/auth/api-actor.ts` is the highest-leverage change (dedupes 7+ hand-rolled API preambles, adds missing `profiles.active` check + OWNER reject on audio claim, is the v2 multi-tenancy seam). See TASKS.md Phase 2 for full list (P2-1 through P2-5).
2. **Save audit to repo:** `docs/audits/2026-06-10-architecture-audit.md` — still not done; write before continuing audit work.
3. **Page-by-page final-polish pass** (kiosk shadows/bounce + live in-browser visual/a11y pass) — still not started; not blocking.
4. Prod emergency is **911** (safe, unchanged).

---

## 2026-06-10 (session 17) — Notes durability + error surfacing + owner Calls tab

**DONE on branch `feat/notes-and-errors`** — 7 commits, **360 tests** green, lint + typecheck clean. Flow: brainstorm → spec → plan → subagent-driven execution (per-task spec+quality review + an opus whole-branch final review). Spec: `docs/specs/2026-06-10-notes-and-errors-design.md` · Plan: `docs/plans/2026-06-10-notes-and-errors.md`.

**Why:** H1 (session 16) patched the stale-closure *symptom*; this fixed the *shape* — a single unretried, silently-swallowed notes save. The same `.catch(()=>{})` pattern hid every other call-surface failure.

**Thread A — agent reliability:**
- New `apps/portal/lib/http/reliable-fetch.ts` — `reliableFetch(input, init, { label, retries?, backoffMs? }): Promise<Response|null>`: retries network/5xx (default 2), `Sentry.captureException` on exhaustion. 6 unit tests. **Contract:** only a real 5xx is retryable (`!(res.status>=500)`) — a missing-status mock returns as-is (this kept the H1 component tests green).
- Notes save **decoupled from call phase**: softphone shows a phase-independent "Couldn't save notes — Retry/Discard" banner with the typed text preserved (`notesSave`/`pendingNotes`); video-call keeps the overlay mounted on failure with the same affordance (`finalizingRef` now guards only the one-time teardown, so Retry won't re-tear-down). Notes are never silently lost. `endCall` stays referentially stable (the H1 fix is intact).
- `answered`, `emergency/control` (leave **and** the live-911 mute/unmute — now reverts the optimistic toggle if the server didn't take it), `end-video` routed through the helper (Sentry). Emergency **trigger** stays bespoke (NOT auto-retried — life-safety) + Sentry. **20s presence heartbeat stays best-effort by design.**

**Thread B — owner Calls tab:**
- Note icon (`StickyNote`, `role="img"`) on rows with notes; rows **expand inline** (accessible accordion) instead of navigating; shared **`CallDetailBody`** used by both the inline panel and the kept standalone detail page (the incident deep-link still points there).
- List query enriched (`caller_number, notes, recording_url`) + one batched incidents map → instant expand, no extra round-trip. **All/Phone/Video** channel filter (`?channel=`, `CallChannel`-typed, composes with `?property=` + load-more via `buildHref`).
- **Cascade:** the property-detail "Recent calls" panel shares `CallRow`, so it also expands inline now — handler names + incidents resolved there for parity (was navigate→full-detail before).

**Constraints honored:** zero migrations / RLS / new API routes; `POST /api/calls/notes` untouched; no routing/Twilio/Agora/presence/finalization/emergency-state-machine changes.

**PICK UP HERE (fresh chat):**
1. **Merge/PR `feat/notes-and-errors`** (if not already) → push `main` → Vercel auto-deploys → smoke the notes failure-banner (force `/api/calls/notes` to fail) + owner Calls expand/filter on prod.
2. **Phase 2 — P2-1** `requireApiActor()` in `lib/auth/api-actor.ts` (dedupes 7+ API preambles, adds `profiles.active` check + OWNER reject on audio claim, v2 multi-tenancy seam). Then P2-2..P2-5 (TASKS.md Phase 2). *This is what the session started toward before the notes/errors detour.*
3. **Save audit to repo:** `docs/audits/2026-06-10-architecture-audit.md` — still not done.
4. Prod emergency is **911** (unchanged).

---

## 2026-06-10 (session 18) — Phase 2 seam extractions DONE + merged (PR #18)

**All of audit Phase 2 (P2-1…P2-5) complete and merged to `main`** (merge `7c553e8`, PR [#18](https://github.com/kthakkar1983/lobby-connect/pull/18)). Vercel auto-deploys prod; **prod smoke still pending** (only the voice/video gate left). Started from the session-17 hand-off (Phase 2 was next).

**Validation first (per Kumar's request):** before touching code, cross-checked the 48-finding audit's Phase 2 items against `CLAUDE.md` locked decisions + the committed 2026-06-06 triage — confirmed none were intended features / accepted-risks mis-marked as bugs. (Kumar had committed the audit + triage + methodology docs in `8cd551f`.)

**Flow:** brainstorm → spec (`docs/specs/2026-06-11-phase2-seam-extractions-design.md`) → plan (`docs/plans/2026-06-11-phase2-seam-extractions.md`) → subagent-driven execution (10 tasks; per-task spec + code review; **opus** implementer+reviews on the 911 routes; **opus whole-branch final review → GO, no Critical/Important**). 411 tests (395 portal + 16 `@lc/shared`), lint + typecheck clean.

**Shipped (Pass 1 — behavior-identical extractions):** `requireApiActor()`/`fetchOperatorCall()` (`lib/auth/api-actor.ts`) across all 12 session API routes (the **v2 multi-tenancy seam**); `parseVerifiedTwilioWebhook()` + `APOLOGY_MESSAGE`/`twimlResponse`; `claimCall()`/`finalizeCallPayload()`/`ACTIVE_CALL_STATES` (`lib/voice/call-state.ts`) + `computeDurationSeconds()` (`lib/calls/duration.ts`); PII scrubber + kiosk↔portal DTOs → `@lc/shared`; `diffFields()`/`emptyToNull()` (`lib/audit/diff.ts`).

**Two behavior changes (Pass 2 — the only observable ones, A1/H3):** (1) deactivated users (`active=false`) → **403 on all API routes** (one `=== false` gate inside `requireApiActor`); (2) `/api/twilio/voice/answered` now **rejects OWNER + routes its claim through `claimCall`** (loser→409, winner-only `ON_CALL` — mirrors the shipped H3 fix onto the audio path); (3) agent `calls/[id]/playbook` rejects OWNER (owners have their own route). **911 path verified byte-identical** (opus, line-by-line vs main). Zero DB/RLS/migration changes; no premature assignment scoping (DEFER-V2).

**The subagent loop caught real issues:** a route that looked like it rejected OWNER but didn't (would've been a silent behavior change), a too-narrow `git add` that left test fixtures uncommitted, and two reviewer suggestions that would have broken the behavior-neutral guarantee (pushed back, deferred to Pass 2).

**PICK UP HERE (fresh chat):**
1. **Phase 2 prod smoke** (after Vercel deploys `main`): audio answer (claim→IN_PROGRESS+ON_CALL), video answer+end (finalize+duration), deactivated-user→403, OWNER→403 on `/answered`.
2. **Audit Phase 3** (perf/caching/parallelization) — mostly forward-scale (the 2026-06-06 readiness audit bucketed perf as ACCEPT-RISK); P3-2 (Twilio webhook hops = guest-audible latency) + P6 (silent 1000-row count truncation) are the pilot-relevant ones. Then **Phase 4** (scale invariants). Re-validate against triage before each (note: TASKS.md P4-7's "21 `href as never`" is stale — only 3 remain, all intentional nav forward-refs; P4-1/S2 + P4-10/S7 are triage-marked ACCEPT-RISK/DEFER-V2).
3. **Deferred Phase-2 follow-ups:** `claimCall` throw-on-DB-error (task chip filed); `emptyToNull` dup in owner-properties actions; reaper finalize payload via `finalizeCallPayload`.
4. Prod emergency is **911** (unchanged, safe).

---

## 2026-06-12 (session 19) — Phase 2 prod smoke CONFIRMED; Phase 3 re-validated (scope decision pending)

**Phase 2 prod smoke = PASS** (Kumar, this session): audio answer, video answer+end, deactivated-user→403, OWNER→403 on `/answered` all working in prod "so far." PR #18 fully closed out — the last Phase-2 gate (voice/video) is cleared.

**Phase 3 re-validated against the 2026-06-10 triage + CLAUDE.md locked decisions** (the documented pre-phase step). All 6 tasks (P3-1…P3-6) are genuine BUG-bucket findings — **none mis-marked** as intended features or locked-decision violations. But Phase 3 is **mostly forward-scale** (the 2026-06-06 readiness audit already bucketed perf as ACCEPT-RISK):
- **Pilot-relevant — P3-2** (P4/S5: Twilio incoming webhook 8→4 hops + detach heartbeat): guest hears dead air today (250–650ms typical, 20s worst-case → Twilio ~15s webhook timeout = failed call). **Touches the live voice critical path → must be behavior-identical + prod voice smoke** (voice only testable on prod). The standout.
- **Correctness-at-scale — P3-6**'s P6 count-query part (silent 1000-row JS count): real, but "breaks at ~25+ properties" = v2 scale, not pilot.
- **Correctness-neutral RTT polish:** P3-1 (React `cache()` session), P3-3 (owner home `Promise.all`), P3-4 (agent layout `Promise.all`) — behavior-identical latency wins, low pilot impact.
- **Triage ACCEPT-RISK polish (optional):** P3-5 (`unstable_cache` Sentry count), P3-6's keyset pagination (P7/S10). S4 = DEFER-V2.

**Scope decision (Kumar): FULL Phase 3** — all 6 tasks P3-1…P3-6 via the usual brainstorm→spec→plan→subagent flow (declined the pilot-slice / reprioritize alternatives; doing the whole phase now).

**Spec + plan committed** (`5c2f5ae` spec, `222c20e` plan) on branch `feat/phase3-perf-parallelization`; full superpowers chain (brainstorm → writing-plans → subagent-driven).

**PR-A (safe batch: P3-1, P3-3, P3-4, P3-5, P3-6) — BUILT + opus whole-branch review = GO.** Commits `2b1b52c…af5423e`, each task TDD'd + spec-reviewed + quality-reviewed (subagent-driven, ~sonnet impl + reviews). Gate: **407 tests** (404 node + 3 jsdom) + lint + typecheck + `next build` all green. New pure helpers + tests: `lib/auth/session.ts` (`getSessionProfile` React `cache()`), `lib/auth/agent-coverage.ts` (`getAgentCoverage` cache), `lib/calls/today-window.ts` (`startOfTodayUtc`, shared by owner home + admin), `lib/owner/calls-cursor.ts` (keyset encode/decode/`.or()`). `requireRole` now returns `full_name`/`email` → all 3 role layouts + agent page + admin overview dropped their 2nd profiles read. Admin/owner-home counts → `{count, head:true}` (no row-ship, no 1000-cap). **One user-visible change:** owner Calls → 50-row cursor pages (← Newest / Older →). Reviews caught + fixed: the admin **layout** dedup (plan listed 2 of 3 role layouts); cursor `?before=` hardening (uuid + structural-char guard, also kills a multi-`~` edge); a `<nav aria-label>` landmark. **Non-blocking minors left:** 2 now-orphaned `summary.ts` helpers (`countTodayCalls`/`latestCallTime`, still tested); local `.next/types` stale-duplicate-file tsc quirk (gitignored — `rm -rf .next` clears it; CI/Vercel unaffected).

**SHIPPED TO PROD (2026-06-12).** Kumar reviewed PR-A locally (fine) → directed: put PR-A **and** P3-2 on `main` together, smoke everything at once on prod. So **P3-2 (voice restage) was built on the same branch** — opus impl + opus review = **GO**, byte-identical across all 5 routing cases, +1 test pinning the new `Promise.all`-rejection path (9 webhook tests). Whole Phase 3 **merged to `main` `37ff689` (`--no-ff`) + pushed**; **prod deploy `dpl_FNU5isf3MQFhHJXF6uFCQQ4FuYzd` READY** (37ff689). `/sign-in`→200; `/api/twilio/voice/incoming` GET→405 (route live). 412 tests + lint + typecheck + build green; **zero migrations**. Local merged branch `feat/phase3-perf-parallelization` deleted (all on `main`).

**PICK UP HERE (fresh chat) — Phase 3 prod smoke is the only thing left:**
1. **Run the smoke (Kumar):** (a) **perf sanity** — agent/admin/owner dashboards + stats read unchanged; owner **Calls** now pages **← Newest / Older →** (the one visible change; a property with <50 calls shows no "Older" button — expected); `/admin/status` error card renders (now 60s-cached). (b) **Voice (live call):** agent/admin softphone registered → call **+14058750410** → ring → Answer → two-way audio → `calls` row RINGING→IN_PROGRESS→COMPLETED; **no-answer** → apology + `NO_ANSWER`. Optional: `/admin/status` `twilio_webhook` heartbeat still fresh (detached heartbeat lands).
2. **After smoke passes:** tag `plan-phase3-perf-parallelization-complete`.
3. **If the voice smoke regresses:** the restage is byte-identical to the old routing, so suspect deploy/env — old behavior is recoverable by reverting just `632d7e2` (P3-2).
4. Prod emergency is **911** (untouched by Phase 3). **Audit Phase 4** (scale invariants: P4-1…P4-10) is the next remediation phase after the Phase-3 smoke — re-validate against the triage first.

---

## 2026-06-13 (session 20) — Phase 3 prod smoke PASS → tagged; playbook-on-audio gap surfaced

**Phase 3 prod smoke = PASS** (Kumar: "everything working as it should"). Phase 3 (perf/caching/parallelization) fully closed: CLAUDE.md + this file flipped "smoke pending" → **confirmed 2026-06-13**; tag **`plan-phase3-perf-parallelization-complete`** created on the docs commit + pushed to origin. (Note: Phase 2 + the notes-and-errors interlude were never tagged — only Phase 3 was requested.)

**Newly-noticed gap — the playbook is never shown on AUDIO (Twilio phone) calls.** The playbook PDF appears only in the video-call overlay (`components/video-call/playbook-panel.tsx`, Plan 6b). The agent softphone (audio path, Plan 5b) never got it — historical sequencing: 5b shipped *before* the playbook (6b), and 6b was built into the video overlay, which audio calls don't render. **Not in v2-backlog; this is a v1 want.**

**Scoped this session (Explore agent) — plumbing is ~95% there:**
- `calls.property_id` is NOT NULL and populated on AUDIO rows at the Twilio incoming webhook.
- `GET /api/calls/[id]/playbook` is **call-type-agnostic** — needs only a callId + operator scope; uses `requireApiActor`, already rejects OWNER (AGENT|ADMIN only).
- `PlaybookPanel` takes just `{ callId }` — zero video deps, self-contained.
- The softphone already holds the live call's DB id in `callIdRef.current` (from the Twilio `callId` custom param at incoming ring).
- **The only real work is a UX decision:** an audio call has no overlay, and the softphone sits in a fixed **320px** right-sidebar (agent `layout.tsx`) — too narrow for an 8.5×11 PDF. Options: modal/slide-over, expand the sidebar while in-call, or a collapsible in-widget panel. Zero migrations, zero new routes, UI-layer only.

**DECISION (Kumar): BUILD NOW** — before Phase 4. Kumar then added a requirement during the brainstorm: the **admin in-call screen must MATCH the agent's**. They were completely different — same shared `Softphone` widget, but the agent mounts it in a **320px right rail** (`app/(agent)/layout.tsx`) while admin uses a **full-width top strip** (`app/(admin)/layout.tsx`), and the softphone card has no max-width so it stretched. Key insight: **video already matched** across portals (it uses a full-screen `VideoCallHost` overlay); only **audio** diverged (inline controls in differently-shaped containers). Chosen fix: a **unified in-call overlay** (option "exactly like video"), **~25% call-info rail / ~75% playbook** (wider than video's 40/60 — audio has no video to fill the left).

### BUILT + SHIPPED (2026-06-13) — merged to `main` + prod voice smoke PASS

Full superpowers chain: brainstorm → spec → plan → subagent-driven (per-task spec+quality review, **opus whole-branch = GO**). Spec `docs/specs/2026-06-13-audio-incall-overlay-playbook-design.md` · plan `docs/plans/2026-06-13-audio-incall-overlay-playbook.md`.

- **New `AudioCallOverlay`** (`components/softphone/audio-call-overlay.tsx`) — presentational `fixed inset-0 z-50` overlay rendered by the shared `Softphone` on `phase==="in-call"` (replacing the inline in-call card). Identical in agent + admin by construction. Mirrors the video overlay chrome (header strip + deep-navy `--color-call` stage + control bar); coral Hang up, red 911, mint live dot. Body = `basis-1/4` call-info rail + `<PlaybookPanel basis="basis-3/4">`.
- **`PlaybookPanel` moved** `components/video-call/` → `components/call/` + gained a `basis` prop (default `basis-3/5` → **video output unchanged**). `GET /api/calls/[id]/playbook` reused as-is.
- **All state/handlers stay in `Softphone`** → the 6c emergency-conference control routing (`toggleMute`/`endCall`/`triggerEmergency` branch on `emergencyActive`) and the `pendingNotes` notes-durability banner are **preserved** (opus-verified byte-identical handlers; notes-fail regression test green). Incoming/ring stays the inline Accept/Decline.
- Commits: `0de6f19` (move+prop), `11a95ea` (overlay+tests), `a0be40e` (wire into Softphone+tests), `9983ca9` (final-review polish: CallShell seam comments in both files, re-added 911 notify forward-compat seam, empty-propertyName guard). **414 tests + typecheck + lint + `next build` all green. Zero migrations / new routes / RLS.** Merged `--no-ff` to `main` **`edef163`** + pushed (prod auto-deployed); feature branch deleted.
- Non-goals (explicit): idle-state parity (admin has no Ready/Away — intentional), overlay minimize, refactoring the video overlay, recording. `CallShell` shared-chrome extraction left as a noted seam in both overlays.

**STATUS: DONE + SHIPPED.** Merged `edef163` → prod auto-deployed; **prod voice smoke PASS** (Kumar, 2026-06-13: "everything seems to be working"). Agent + admin in-call overlays confirmed working with the playbook.

**Deferred — minor UI tweaks:** Kumar noted a couple of small UI changes on the audio in-call overlay (specifics not captured this session) to fold into the **page-by-page UI/UX final-polish pass** (the standing follow-up first requested in session 12) rather than a one-off fix now.

---

## Phase 4 — Invariants, indexes & CI — COMPLETE + MERGED + PROD (2026-06-14)

**The final 2026-06-10 architecture-audit tranche.** Full superpowers chain: brainstorm → spec → plan → subagent-driven (15 tasks, per-task spec+quality review + **opus whole-branch = GO**). Spec `docs/specs/2026-06-14-phase4-invariants-ci-design.md` · plan `docs/plans/2026-06-14-phase4-invariants-ci.md`.

**Shipped (15 findings, 470 tests):**
- **Single-sources:** `@lc/shared/protocol.ts` (all cross-app timing constants + reaper>ring module-load guard) (M7/A8); single `CallState` re-exported from `@lc/shared` (M3); **generated-base DB types** (`database.generated.ts` via `supabase gen types` + curated `MergeDeep` overlay in `supabase-types.ts`) with `gen:types`/`gen:types:check` drift check (M6); typed `AuditEvent.details` (M8); `lib/audit/actions.ts` constants (D10); `lib/storage/playbook.ts` signed-URL helper (D9).
- **Correctness (tested):** time-bound ON_CALL presence inference (S3); kiosk one-active-call **DB partial-unique-index** + 23505→409 (S8, mig 0016); parallel-dial cap 10 + Sentry warn (S2).
- **Cleanups:** password reset → `/auth/confirm`, dead `/auth/callback` deleted (M4); dead browser supabase client deleted (A7); parallelized reaper/sweep crons (S7); `audit_logs(operator_id,action,created_at)` index (S11, mig 0017); 22 `as never` route casts removed (→`as Route`) + `scripts/check-routes.mjs` guard (M2).
- **CI:** first GitHub Actions workflow (`.github/workflows/ci.yml`). 911 path byte-identical except one value-identical constant swap. A1/A2/A4 left as-is per triage.

**DONE this session — do NOT redo:**
- Merged PR [#19](https://github.com/kthakkar1983/lobby-connect/pull/19) to `main` (merge commit `d17a146`); **CI green** on the PR before merge.
- **Migrations 0016 + 0017 APPLIED to prod** (`ztunzdpmazwwwkxcpyfp`) via MCP — pre-checked no active-VIDEO dup before 0016; both indexes verified present in prod.
- CLAUDE.md build-status + key-patterns updated; this file updated. Tag `plan-phase4-invariants-ci-complete` (push if not already).

**CI gotcha (recorded):** `pnpm gen:types` / the drift check need Supabase **CLI 2.101.0** + a running local stack. Newer CLIs demand an access token even for `gen types --local`; CI's `supabase/setup-cli@v1` is pinned to `2.101.0` for this reason. Bump that pin in lockstep with any future `pnpm gen:types`. Per-package `lint` skips `tests/`; only root `eslint .` (in `pnpm lint`/CI) catches test-file lint.

**Optional follow-up:** light prod smoke (kiosk→agent video happy-path confirms the 0016 index doesn't block; `/admin/audit` action filter; a no-answer audio call). Non-blocking — all changes are behavior-preserving or additive + CI-validated.

**Process note:** mid-run a subagent left the worktree on `main` once → a false "typecheck passed"; the two-stage review caught the real build-breaker (a `readonly`/mutable prop mismatch). No work lost (commits were on the branch); a branch-guard was added to every later dispatch.

**PICK UP HERE (new chat):**
1. **Page-by-page UI/UX final-polish pass** (session-12 follow-up) — include the audio in-call overlay minor tweaks Kumar flagged. **This is now the main open work item** (all audit phases 0–4 done).
2. *(optional)* Phase 4 prod smoke (above).
3. Audit DEFER-V2 items remain parked (S4/S6/P3/etc. — real scale work, not pilot-blocking).

> **Superseded by the Brand Revision (below).** The "page-by-page UI/UX final-polish pass" above is
> now folded into the brand revision's **Layout phase** — same comprehensive per-page UI redo, under
> the new locked brand.

---

## Brand Revision — design LOCKED + FOUNDATION SHIPPED (on branch), layout phase NEXT (2026-06-14 → 2026-06-15)

A system-wide rebrand. **Canonical brand spec: `docs/brand/brand-guidelines.md`** (living doc;
logo/color/type/shape ✅ Locked). Impeccable design context now lives at **`docs/PRODUCT.md` +
`docs/DESIGN.md`** (the loader auto-discovers them in `docs/`). Memory pointer: [[brand-revision]].

### Design (2026-06-14) — locked
Retired coral. Four anchors: **navy `#0F2D4B` / teal `#2EA6AA` / mint `#06D6A0` / blaze `#FD6734`**
over cool neutrals + reserved red `#C81E1E`. Roles: mint = connect/live + **primary buttons** (ink
`#14202F` text); teal = links/nav/secondary; blaze = needs-attention; navy = text/nav; red =
911/destructive only. Type = **Raleway** (display + labels) / Outfit (body) / JetBrains Mono (data).
Real **logo** (mark = doorway + figure; wordmark = LOBBY/connect) — portal only, never kiosk.

### Foundation IMPLEMENTATION — DONE on branch `brand-revision` (2026-06-15), NOT merged, NOT deployed
Done via the `impeccable` skill. Two commits on `brand-revision` (a `feat` + a `docs` handoff commit):
- **Color tokens swapped** in `apps/portal/app/globals.css` + `apps/kiosk/src/index.css` (mirrored):
  coral retired; `--color-accent` = teal, new **`--color-attention`** = blaze, `--color-ink`, deep
  variants, cool neutrals; `--color-ring` = deep mint; seam = navy→teal→mint (blaze excluded). The
  coral→3-way split was applied to every call site (missed/degraded/pending-setup → **blaze**;
  links/active-nav/hover/filters → **teal**; primary actions → **mint**; end/hang-up → navy on light,
  neutral-white on the dark video stage; 911 stays red).
- **Three fonts wired** — Raleway (variable, verified) via `next/font` (`app/fonts.ts`) + kiosk
  `@font-face`; Atelier + Radon removed (files deleted).
- **Shared `LogoMark`/`Wordmark`** (`components/brand/wordmark.tsx`) render the real assets via `<img>`;
  sidebar swaps wordmark↔mark on collapse. **SVGO** added (`apps/portal/svgo.config.mjs` +
  `pnpm -F @lc/portal optimize:svg`): mark **106 KB → 0.66 KB**, wordmark **109 KB → 2.1 KB** (Adobe
  PGF metadata stripped; viewBoxes tightened). Partner's preferred **mint-connector** wordmark swapped
  in (resolves the doc's teal-vs-mint open confirm → mint; mark figure is mint, right jamb teal).
- **`Button` default = mint** (+ navy `neutral`, teal `accent`); `Badge` gained `attention`; auth-form
  primary CTAs → mint. **Middleware bug fixed** — it was redirecting `/brand/*` static assets to
  `/sign-in` (broken logo); now excludes file-extension paths.
- **Verified:** portal typecheck + lint + **428 tests** + `next build`; kiosk build; live `/sign-in`
  render (logo loads, Raleway confirmed, mint CTA, new tokens). Zero migrations / new routes / RLS.

### Layout phase — Sign-in / auth DONE (2026-06-15)
First Layout-phase surface, built via `impeccable` (shape → explore both directions → build → verify
in-browser). **Sign-in redesigned as a split** (the brand thesis made physical): a **navy brand
panel** (drifting **connection-lines** + "The front desk, after hours." headline + a 3px vertical
seam down the join) beside an **elevated form card** (radius 16, two-layer `--shadow-xl`, the **seam
gradient across its top**, the **wordmark centered** as the home link `h-12`, a divider, then the form).
- `apps/portal/app/(auth)/layout.tsx` is the split shell → inherited by sign-in / forgot-password /
  onboarding; mobile collapses to the card alone.
- New `apps/portal/components/brand/floating-paths.tsx` — efferd's "Background Paths" reworked: brand
  colour via `currentColor` (teal + mint layers on navy), `useReducedMotion()` guard (the global CSS
  reduced-motion net can't stop motion's JS animation), deterministic durations (no SSR hydration
  drift), `aria-hidden`. Uses the new **`motion`** dep (the one JS-animation pkg; in `package.json`).
- New `globals.css` tokens: `--gradient-seam-vertical` + `--shadow-xl`. Email/password **placeholders**
  added on the sign-in form.
- typecheck + lint + 420 portal tests green. **Zero migrations / new routes / RLS.** Committed on
  `brand-revision` (not merged, not deployed).
- **Provenance note:** Kumar pointed at the efferd `@efferd/auth-5` shadcn block for its floating-paths
  animation; we inspected the registry manifest, took **only** that one component (no social-login
  cascade, no registry entry), and reworked it on-brand.
- **Deferred to the final copy pass:** navy headline/subline copy is placeholder; the forgot-password /
  onboarding headings can be centered to match sign-in.

### Layout phase — Unified agent/admin shell DONE (2026-06-16)
Second Layout-phase surface, via `impeccable`. One shared `apps/portal/components/app-shell.tsx`
(role-param) now backs both `(agent)`/`(admin)` layouts (thin auth-and-delegate wrappers). **Navy
rail** (recoloured `--color-sidebar-*` tokens, not a shadcn fork) + a 2px vertical **seam** on the
`SidebarInset` left edge; **reversed logo** on the rail (`LogoMark`/`Wordmark`/new `LogoLockup` gained
an `onDark` prop + new on-dark SVGs, the lockup SVGO'd 244KB→2.8KB); **hover-expand** (220ms intent
delay + keyboard focus; header toggle removed); role-aware nav (`NavItem` `exact` fix for index routes,
teal-wash active); **3-col** with a persistent 320px right call-rail (admin's softphone strip retired
into it); **account menu** = avatar → "boarding pass" dropdown (`components/account-menu.tsx`,
`.lc-avatar-halo`) for agent/admin only (owner keeps its `UserMenu`). 428 tests + typecheck + lint;
verified in-browser. Rejected the rail-footer placement (fought hover-expand). Zero migrations/routes/
RLS. Full detail: CLAUDE.md build-status row + brand doc §5.2. Committed on `brand-revision`.

### Layout phase — Sign-in error states DONE (2026-06-16)
Small polish on the sign-in form, via `impeccable`. **Field shake + red invalid outline on every
failed attempt:**
- New reusable `.lc-shake` keyframe in `globals.css` — a short decaying `translate3d` (360ms,
  `--ease-out`), replays per-submit via a class-toggle reset on `onAnimationEnd` (robust: the submit
  button is disabled during the request, far longer than the animation); the universal reduced-motion
  net neutralises the movement while the red border still carries the meaning.
- Red outline via `aria-invalid` → the shared `Input`'s existing `border-destructive`. The email field
  was a hand-rolled `<input>`; **routed it through the shared `Input`** so both boxes share one
  vocabulary and both get the red state.
- **Native HTML5 validation retired** (`<form noValidate>`) — it was firing the browser's own bubble
  (with the warning icon) and **blocking submit before the action ran**, so empty/format errors never
  reached the shake/red/custom-message path (only wrong-creds did). Now every error takes one path: a
  plain custom message + shake, no browser bubbles/icons.
- New tested `validateSignInInput` (`lib/auth/sign-in-errors.ts`, reuses the now-exported `EMAIL_RE`
  from `lib/users/validate.ts`); copy `auth.required` ("Email and password are required.") +
  `auth.invalidEmail` ("Enter a valid email address.") in `lib/copy.ts`; `invalidCredentials`
  ("Invalid email or password.") unchanged. Kept "email" (not "user ID") to match the field label.
- 423 portal tests; verified in-browser (empty / bad-format / wrong-creds all shake + red + plain
  message). Zero migrations/routes/RLS. Committed on `brand-revision`.

### Layout phase — Dashboards (agent/admin) + shared header — DESIGN LOCKED (2026-06-16) → BUILT + SHIPPED to main + prod (2026-06-17; see session 21 at end)
Full design, data spec, helper list, build order: **`docs/specs/2026-06-16-stage5.3-dashboards-shared-header-design.md`**
(+ brand doc §5.3). Locked via `impeccable` (shape → many in-chat visual iterations → lock). **No code
written yet** — this session produced the locked *design*; the implementation is the next focused build.

**What's locked:**
- **Shared gradient header (all 3 portals):** navy→teal band (`linear-gradient(112deg,#0E2A45,#13495E,#237E84)`)
  + a **static** (no-motion) staggered **connection-lines** field (the sign-in `floating-paths` rendered
  static) in the centre-right; Raleway greeting (cream, **no subtitle**) left; account menu right; a 2px
  seam hairline on the bottom edge (continuous with the rail seam → "L" frame). Owner inherits it
  (mobile, keeps `UserMenu`).
- **Call-rail (320px) REMOVED.** Softphone → a **card**: center-right in the agent bento; a home card on
  admin (Device mounted in the admin **layout** + incoming-call **toast** so admins stay reachable on
  other tabs). **All call/notes/emergency logic + the full-screen `AudioCallOverlay` preserved verbatim**
  — composition only. Idle restyle: `Line ready` pill + seam ring + agent-only `Accepting calls` toggle.
- **Agent dashboard (pod-scoped bento):** header · 4 stats (Answered / Missed / Avg pickup / **Avg call
  length**) · `Hourly Call Volume` chart (+ Total call duration) + Recent calls (channel icon + outcome
  + duration) · softphone card · full-width **`Your pod`** (≤5 properties, **phone/video volume bars**).
- **Admin command center (operator-wide, level bentos):** header · pulse row (Live calls / Agents online
  / Open incidents / **Phone health**) · a Tonight card (operator-wide `Hourly Call Volume` +
  Answered/Missed/Failed/Avg pickup/Avg call) over the Properties board · softphone card + Team-on-now +
  operator-wide **Recent calls** feed (fills the bottom-right, columns bottom-align). **Phone health =
  scale-aware rollup** ("48/50 · 2 need attention" blaze / "lines OK" mint / "phone path down" red) —
  answers Kumar's "1 of 50 hotels down?" (the single `health_signals` heartbeat only proves the whole
  Twilio path is up; per-hotel issues derive from FAILED-calls/coverage gaps + flag the board rows).
- **Channel colours:** teal = phone/AUDIO, navy = video (categorical, legended). Outcomes: mint =
  answered, blaze = missed, muted = failed (**red stays 911-only**).

**Data:** everything is real (`calls.channel` AUDIO/VIDEO is the spine). **Agent = pod-scoped; admin =
operator-wide aggregate** (explicit Kumar correction — the hourly chart is all agents, not the viewer).
**No migrations / new routes / RLS / call-logic changes** — new work = read queries + ~7 TDD'd pure
helpers (`avgCallLengthSeconds`, `countByOutcome`, `splitByChannel`, `hourlyVolume`, `countLiveCalls`,
`phoneHealthRollup`, + per-property channel counts). Spec §6.

**Rejected along the way:** light `#F4F7F7` mixed into the header gradient (reverted to navy→teal);
floating softphone dock + header-anchored softphone (→ a card instead); stretching the softphone/team
cards or moving a pulse tile to kill the admin bottom-right dead space (→ filled it with the Recent
calls feed instead).

**NEXT (fresh chats):** (1) **DONE 2026-06-17** — agent + admin dashboards + shared header **BUILT +
SHIPPED** (merged `60911a7` → prod; see session 21 at end). (2) **Owner portal LAYOUT redesign** — its
own fresh chat (owner inherits the shared gradient header, keeps its own `UserMenu`, mobile-first).
(3) **Kiosk LAYOUT** + **audio in-call** overlay — later. The brand foundation + sign-in (§5.1) + shell
(§5.2) + dashboards (§5.3) are **shipped, locked inputs**.

### Deferred decisions / follow-ups (flagged, NOT done)
- **Open decision:** brand §3.2 lists "open incident" under **blaze**, but incidents still render
  **red** everywhere (prior stages chose red). Decide when incident screens come up.
- Full **kiosk repaint** + the **no-logo-on-kiosk** rule (kiosk still shows an "LC" mark; CTA styles
  got a coherent interim only). Per-surface **logo sizing** (sign-in wordmark is now `h-12` in the new card).
  Final **end/hang-up** treatment. A real **favicon** from `mark.svg` (live 404 today).
- **RESOLVED 2026-06-17:** `brand-revision` is **merged to `main` + deployed to prod** — the whole
  layout phase (foundation + sign-in + shell + error-states + dashboards) is live. Owner + kiosk inherit
  the new brand tokens but NOT yet the layout treatment. Continue owner/kiosk from `main` (branch per surface).

## 2026-06-17 (session 21) — Dashboards (agent/admin) + shared header BUILT + SHIPPED → merged to `main` + prod

Implemented the locked Stage 5.3 design via `impeccable` craft (browser-verified, agent + admin).
**Merged `60911a7` (`--no-ff`) → `main`; tag `brand-stage5.3-dashboards-complete`; Vercel prod deploy
`dpl_8jqbN8dj…` state READY; CI green.** This merge ships the whole brand-revision layout phase to prod
(owner + kiosk get the new tokens but keep their old layouts until their redesigns).

**Built:** shared gradient `DashboardHeader` — tall, **top-aligned**, **teal→navy** left→right (gradient
flipped 112°→248°; static connection-lines flipped to match; cream time-aware greeting; **light avatar +
`.lc-avatar-halo`**; bottom seam). The taller top-aligned layout lets the account dropdown open *into the
header*, not onto a card. Shell: **320px call-rail removed** → softphone stays **mounted in the shared
layout for BOTH roles** (the line persists on every route; per Kumar), shown as a card on the dashboard
home + hidden (display:none, still mounted) + `IncomingCallToast` off-home (new `dashboard-workspace.tsx`);
**all call/notes/911 logic untouched** (idle restyle only: Line-ready pill, seam ring, Accepting toggle).
Agent bento (4 stats incl Avg-call-length, hourly phone/video chart + talk time, recent, pod bars) +
admin command center (pulse [Live/Online/Incidents/Phone-health], Tonight card + outcomes, properties
board, team-on-now, recent). New TDD'd helpers in `lib/dashboard/calls.ts` (+ `splitTodayByChannel`) +
`phone-health.ts`; shared `channel-viz`/`DashTile`; bento `shadow-md` lift; rail hover-intent 220→450ms.
448 portal tests (490 repo-wide); typecheck + lint + check:routes + gen:types:check all green.

**Two implementation resolutions (deviations from the spec — also recorded in the §5.3 spec):**
1. **Agent dashboard is agent-scoped, not pod-wide.** RLS `calls_select` (0004) only exposes the agent's
   own `handled_by` calls and the spec barred RLS changes; pilot-equivalent (the primary agent handles
   the calls). True pod-scope = a v2 RLS branch. **Admin IS operator-wide** (RLS allows ADMIN).
2. **Phone-health "needs attention" = recent FAILED calls only.** Flags a property only on a concrete
   failure (>= 1 `FAILED` call today). The presence-based **coverage-gap** was removed (it false-alarmed
   on a covered property whose primary agent was offline — the normal after-hours setup); coverage-gap +
   the global "path down" (twilio_webhook info-mode) are v2 seams. (Corrected post-merge 2026-06-17 on
   prod-test feedback.)

**NEXT:** **owner portal LAYOUT redesign** (fresh chat — inherits the shared gradient header, keeps its
own `UserMenu`, mobile-first; its dashboard content is a fresh `impeccable` effort), then **kiosk
LAYOUT** + **audio in-call** overlay polish. Minor cosmetics noted in the browser pass: empty states on
a quiet night; admin right-column whitespace below the softphone; seed admin is named "Local Admin".

## 2026-06-17 (session 22) — Dashboard polish (post-Stage-5.3) + new admin Phone-health page

Follow-up on the just-shipped agent/admin dashboards, from Kumar's prod live-testing. All on `main`, all
prod-deployed (5 `--no-ff` merges: `8460a5f` → `0ab2104` → `47aad68` → `29cbbbe` → `45d3a63`; final
deploy `pbo0jgdxz…` READY). **Zero migrations / RLS / new deps.** 458 tests + typecheck + lint +
check:routes + `next build` green each merge. Browser verification was **on prod** — the local Next dev
server can't run under the harness sandbox (see the `dev-server-sandbox-hazard` auto-memory: do NOT
`xargs kill -9` by port — it revoked project FS access for the whole session this time).

**1) New admin Phone-health detail page (`/admin/phone-health`).** The command-center "Phone health"
`DashTile` is now a link (teal hover + chevron) → a read-only, operator-wide page listing active
properties: per-property **mint "Lines OK" / blaze "Needs attention"** status (reuses `phoneHealthRollup`
so it matches the tile), the **routing DID** (+ muted front-desk / after-hours sublines — admins may see
the DID, owners can't), and for a flagged row a derived reason ("N failed call(s) today · last at HH:MM").
New TDD'd helper `failureSummaryToday` in `lib/dashboard/phone-health.ts` (5 tests). `DashTile` gained an
optional `href`. Attention rows float to top + `bg-attention/5` tint; `EmptyState` for no properties.
LEAN v1 — the **real Twilio failure reason** is a v2 seam (needs a `calls.failure_reason` column written
from the status webhook). Files: `app/(admin)/admin/phone-health/{page,loading}.tsx`, `phone-health.ts`,
`dash-tile.tsx`, admin `page.tsx`.

**2) Recent-calls rows are now expandable (agent + admin).** New client
`components/dashboard/recent-call-row.tsx` (`RecentCallRow`): collapsed shows **hotel name only**
(room/Lobby removed from the title per Kumar — it read as part of the name), a channel icon + outcome
dot, and a **note icon (StickyNote) in its own fixed-width column at the far right after the time** so
every row stays column-aligned; clicking expands to started/duration/room/caller (+ **handled-by** on the
operator-wide admin view) and the **notes text**. Agent + admin queries now also select `caller_number`,
`notes` (admin also `handled_by_user_id` + resolves handler names via the 2-query merge). 4 component
tests. Parity with the owner portal's `CallRow`/`CallDetailBody` but dashboard-scoped (no incident link —
agent/admin have no incident detail route; v2 seam). Replaces the old plain non-expandable list (which
never surfaced notes — that affordance had only ever existed in the owner portal).

**3) Incoming-call placement (Kumar's call: in the softphone column, never center-screen).** Video now
has its **own persistent "Video" card directly under the softphone** in the right column — `VideoCallHost`
moved inside the aside (`dashboard-workspace.tsx`); `IncomingVideoBanner` rebuilt as a persistent card
(idle "Video / Ready · Video calls ring here" seam-ring moment → mint "Accept video call" when a kiosk
call rings). Audio incoming stays **in-card** in the softphone; off-home admin nudge is the bottom-right
`IncomingCallToast`. (A first attempt this session wrongly made the **audio** softphone incoming a fixed
top-center overlay — wrong component; reverted. The video path is separate: polled `IncomingVideoBanner`
+ ringtone, NOT the Twilio softphone. Recorded in the `voice-vs-video-incoming` auto-memory.)

**4) Video reliability (two real bugs).** (a) **Ringtone "stopped ringing"** = browser autoplay policy
blocks `audio.play()` before any user gesture → the ring is silently swallowed. Added **autoplay priming**
on the first pointer/key interaction (guarded so it never cuts an active ring); the prominent visual card
is the reliable signal regardless. (b) **Busy webcam dropped the call → logged missed** (Kumar: "thought
we fixed this"): `createCameraVideoTrack()` threw (NotReadableError, another app holding the camera) →
the old `catch` called `onClose()`, abandoning an already-answered call while the guest kept ringing.
`video-call.tsx` now acquires mic + camera **independently** and joins with whatever's available
(**audio-only** if the camera is busy; shows an "audio-only" notice), so the guest always connects.
**Regression test added** (camera-track creation rejects → still joins + publishes audio, `onClose` NOT
called).

**5) Hourly-volume chart showed no bars (agent + admin).** Root cause: the bar columns sat in a flex row
with `items-end`, so each column was content-sized (indefinite height); the inner bar's `height: N%` had
no definite parent to resolve against and computed to 0 → empty chart even with calls today. Fixed by
giving each column a definite height (`items-stretch` + `h-full`); `justify-end` keeps bars bottom-aligned
(`components/dashboard/channel-viz.tsx`). Latent since Stage 5.3 (verified then with no data → EmptyState,
so it was missed). Resolves the session-21 "admin right-column whitespace" + empty-chart cosmetics.

**Deferred (future "maybe", Kumar OK'd as-is for now) — admin off-tab video nudge.** Because the video
card lives in the softphone column, an **admin who has navigated off the dashboard** doesn't see it there
(it still **rings** to pull them back, mirroring the audio off-home toast). The always-home agent is
unaffected. If wanted later: a fixed off-home video nudge (like `IncomingCallToast`) or lift the video
state so a fallback can render off-home. Logged in `docs/v2-backlog.md` → "UI/UX".

---

## 2026-06-17 (session 23) — Owner portal LAYOUT redesign — SHIPPED to `main` + prod

Merged `c1638cc` (`--no-ff`) → prod deploy `lhquew8bs…` **READY**. The final brand-revision **portal**
surface (kiosk remains). Built brainstorm (visual-companion) → spec → plan → **subagent-driven** (12 tasks;
per-task spec + code-quality review; Opus whole-branch review = GO). 465 tests + typecheck + lint +
`next build` + check:routes green. **Zero migrations / RLS / call-logic / service-role.**

**What shipped:**
- **Adaptive owner Home (direction C):** 1 hotel → full single-hotel overview (`components/owner/property-overview.tsx`:
  coverage strip · drill-through `DashTile`s · tonight `HourlyVolumeChart` + quiet-night state · recent /
  incidents / manage); N hotels → rich per-hotel cards (the prior count-query grid, preserved). Gradient
  `DashboardHeader` greeting on **Home only** (chrome **direction A** — owner keeps its own `UserMenu` in the
  slim white bar; inner pages stay calm + a seam hairline).
- **Metrics drill through:** Answered/Missed tiles → `/owner/calls?outcome=…`.
- **New shared call layer:** `lib/calls/filters.ts` (`parseOutcome`/`statesForOutcome`/`buildCallsHref`, TDD) +
  promoted `components/call/{call-row,call-detail-body}` (incident link now **injected** + blaze; owner passes a
  link, admin none) + `components/call/call-filters.tsx`. Orphaned owner `greeting.tsx` removed.
- **Owner Calls** gained an **outcome filter** (Answered/Missed/Failed) atop the existing channel filter; both
  Calls pages share the keyset cursor + filters.
- **Incidents → blaze** (`incidentPill` + incident-row + detail) with a factual **red `911`** tag — resolves
  the long-open brand §3.2 red-vs-blaze decision (→ blaze). **FAILED call pill → muted** per brand §7 (missed
  stays blaze).
- **New admin route `/admin/calls`** (operator-wide history; same shared filters + a Hotel filter; sidebar
  `Calls` entry) + admin dashboard tiles/recent feed **deep-link** into it (`StatTile` gained an optional `href`).

**Decisions to remember:** single-hotel Home "Recent calls"/"Last call" are **today-bounded** (vs
property-detail's last-5-ever) — intentional "tonight" framing. The `/admin/calls` rows omit any incident link
(agent/admin have no incident route — a v2 seam). `incidentByCall` is last-write-wins if a call ever had >1
incident (the 6c flow makes exactly one — informational).

**Gate CLEARED — live browser pass VERIFIED on prod (Kumar, 2026-06-18, session 25).** Owner portal redesign is
done + verified: single-hotel overview, tile drill-throughs → pre-filtered Calls, blaze incidents + red 911 tag,
gradient-on-Home-only chrome, and `/admin/calls` all confirmed working.

Spec: `docs/specs/2026-06-17-owner-portal-redesign-design.md` · Plan: `docs/plans/2026-06-17-owner-portal-redesign.md`.

---

## Kiosk LAYOUT redesign — SHIPPED 2026-06-18 (session 24)

Merged `--no-ff` `bd15103` → `main`. The kiosk redesign (the brand layout phase's **final surface**) is done:
- **Home = "tap anywhere to connect":** the whole screen is one `<button>`; 50/50 login-style split — animated
  navy invitation (new pure-CSS `ConnectionLines` + pulsing connect beacon + the line) │ seam │ light greeting
  over a small "Good to know" card (per-field). **Hotel name only — no logo** (resolves the brand §2 no-logo
  rule; `LogoMark` deleted from the kiosk).
- **Recording-consent screen removed** (no recording in v1) → folded into Ringing as a quiet line; the
  `disclosure` state was collapsed out of the call-machine (`TAP_CALL`→ringing; new screen-guarded
  `CALL_STARTED`). **All Agora/call logic byte-identical** (opus line-verified).
- **Ringing** rebranded (connecting field + spinning seam ring + recording line); **self-view PiP top-right in
  every call stage** (Connected PiP moved up); **Apology** restyled; **Loading drops the LC logo**.
- **Connection-lines are pure CSS** — no `motion` dep added to the kiosk. New tokens
  `--gradient-brand-panel`/`--gradient-call-stage` + `lc-cl-*`/`lc-beacon` keyframes (reduced-motion net extended).
- Owner **CTA-style picker hidden** (`kiosk_cta_style` column/action/API left dormant as the re-enable seam) —
  the per-CTA-style art direction is superseded by the single fixed Home.
- **Zero migrations / RLS / new routes / new deps.** kiosk 24 + portal 465 tests + typecheck + lint + build +
  check:routes green; opus whole-branch review = GO.
- Spec/plan: `docs/specs/2026-06-18-kiosk-redesign-design.md` · `docs/plans/2026-06-18-kiosk-redesign.md`.

**The brand-revision LAYOUT phase is now COMPLETE** across every surface (sign-in, agent/admin shell +
dashboards, owner portal, kiosk).

### Prod smoke — CONFIRMED 2026-06-18 (Kumar, on the kiosk prod deploy)
Tap-anywhere → connect, the matched login-style FloatingPaths lines, Cancel, and a real video call all verified
working. **Post-smoke fixes** (3 merges to `main`: `443bfc6` / `c62cd47` / `8cf85eb`):
- **Lines now use the login's `motion` `FloatingPaths`** (the lean CSS stand-in didn't match) + slowed ~2x +
  beacon-ripple / seam-drift slowed — `motion` added to the kiosk.
- **End/Cancel tear down locally + go home first, then notify the server in the background** (a slow/cold
  `call-ended` route was making End look unresponsive).
- **Abortable in-flight call setup** — a generation token bumped by `teardown()`; a Cancel during a cold first
  call now leaves the just-joined channel + closes the just-created call instead of orphaning a ringing call.
- **THE Cancel bug** — the Ringing spinner/text overlay was `absolute inset-0 z-[1]` with **no
  `pointer-events-none`**, sitting over `CallControls` (no z-index), so taps never reached the Cancel button and
  `onCancel` never fired (guest stuck ringing to the 120s timeout). Fixed: `pointer-events-none` on the overlay +
  `z-20` on `CallControls`. **Lesson: jsdom has no layout, so CSS-stacking / pointer-events bugs are invisible to
  unit tests — full-screen decorative overlays MUST be `pointer-events-none`, and only real-browser smoke catches
  this class of bug.** (See [[build-quirks]].)
- **Issue 2 — first-call ring latency = serverless cold-start** (confirmed: 1st call slow, 2nd+ fast). Not a bug
  (the incoming-video poll is already 3s); deferred to the Pro keep-warm upgrade ([[launch-pro-tier-deferrals]]).

## Session 25 — Brand polish: favicon + audio in-call overlay — SHIPPED 2026-06-18

The optional brand-polish items are done. **The brand revision is now fully complete across every surface.**
Built brainstorm(visual-companion)→spec→plan→**subagent-driven** (3 build tasks + whole-branch verification;
per-task spec+quality review + opus final = GO). Merged `--no-ff` `5c83840` → prod `dpl_FSoA9MZ…` **READY**
(`lobby-connect-portal.vercel.app`). Spec/plan: `docs/specs/2026-06-18-brand-polish-favicon-audio-incall-design.md`
· `docs/plans/2026-06-18-brand-polish-favicon-audio-incall.md`.

- **(1) Logo/wordmark refresh** — Kumar re-exported the 6 brand SVGs (better spacing/minor adjustments) under the
  same names; re-ran `pnpm -F @lc/portal optimize:svg` (~240KB raw Illustrator → <3KB each; `-on-dark` variants
  correctly reverse navy→near-white `#f4f7f7`, mint connector survives only on the zero-area connector line) +
  synced `components/brand/wordmark.tsx` intrinsic `width`/`height` to the new viewBoxes (LogoMark 771×970,
  Wordmark 938×395, LogoLockup 965×350) so layout reservation stays shift-free. Verified all 6 light+dark.
- **(2) Favicon** (first one — none existed): `app/icon.svg` = navy `#0F2D4B` rounded tile + the **reversed** mark
  (chosen over transparent — the navy door fades on dark tabs); `app/apple-icon.tsx` = `next/og` `ImageResponse`
  180×180 (full navy square, mark as a **base64** SVG data-URI — base64 not `;utf8,` so Satori reliably
  rasterizes; defaults to the Node runtime so `Buffer` is safe) + navy `viewport.themeColor` in `layout.tsx`.
  Visually verified legible at 16/32/64px and on a dark tab.
- **(3) Audio in-call overlay redesign** (`components/softphone/audio-call-overlay.tsx`) — brought to the brand bar:
  **911 → header top-right alone** (red `destructive`, max-separated from Hang up; keeps the AlertDialog confirm);
  navy `--color-call` **call card** = small self-tracked duration · hotel name · mint **presence pulse**
  (`lc-seam-drift`, reduced-motion-safe) · **bold HOTEL LOCAL TIME** (the new anchor); Room#/Notes + Mute/Hang up
  **de-crammed control bar**; **press-Enter-to-save** notes — an in-field icon (`CornerDownLeft` idle →
  `Loader2` saving → `Check` saved → `AlertTriangle` failed) + an `sr-only role=status aria-live` region for SR
  parity; reuses the existing `saveNotes`/`pendingNotes` durability banner as the post-call backstop.
- **Hotel local time wiring (the interesting bit — NO voice/TwiML/dial change):** the property `timezone` (NOT NULL)
  now rides the existing `/api/twilio/voice/answered` response — that route returns `{ timeZone }` (was 204) via a
  `properties(timezone)` embedded select; the softphone (`acceptCall`) reads it post-accept (the overlay only mounts
  then), `saveNotes` now returns a bool, new `saveNotesNow` exposes the explicit save. The overlay ticks local time
  via `Intl.DateTimeFormat` (invalid-tz guarded → hidden) + a self-tracked `mm:ss` duration.
- **Safety + scope:** **all call/Twilio/emergency logic byte-identical** (opus line-verified — `endCall`/`toggleMute`
  incl. the live-911 server-side mute / `triggerEmergency` / Device registration / `incoming` handlers untouched;
  **`video-call.tsx` NOT in the diff**). **Audio-only scope** — the video overlay is left as a noted shared-`CallShell`
  seam. **Zero migrations / RLS / new routes / service-role.**
- **The whole-branch verification gate earned its keep:** the per-task overlay test (run filtered) was green, but the
  full suite caught a real regression — `tests/components/softphone.test.tsx`'s catch-all fetch mocks returned
  `{ ok: true }` **without `.json()`**, which the new `acceptCall` body read threw on. Fixed the 3 mocks to honor the
  `Response` contract (production `reliableFetch` always returns a real `Response`). **Lesson: filtered per-task test
  runs miss integration regressions in sibling tests — the full-suite gate is non-optional.**
- **PENDING: prod audio voice smoke** (only exercisable on prod — Twilio points there). Confirm on a real audio call:
  the navy call card shows, **hotel local time renders + ticks** (matches the property's configured tz), the call
  **duration** ticks, typing a note + **Enter** shows `✓ Saved` and the row lands in the DB, **Mute/Unmute** works,
  **Hang up** ends the call, and the **Call 911** confirm dialog opens (don't complete unless using the 933 test #).

## Session 26 (2026-06-19) — v1 punch-list + call-reliability fix (presence-gate)

**The brand revision is done; we're now closing v1.** Created **`docs/v1-punchlist.md`** as the canonical
remaining-work tracker (read it first when picking up v1 work). Sections: **A** call reliability (below — fixed),
**B** UI fixes, **C** verification, **D** a plain-English security-posture doc. Owner-portal browser pass marked
**verified** (Kumar).

**Item A — intermittent "no one is available" — DIAGNOSED + FIXED + DEPLOYED (pending smoke).** Worked it with
`systematic-debugging`. **Root cause:** the Twilio account's **concurrent-call limit = 1** (console-confirmed;
Kumar submitted business verification to raise it — expect ~**2026-06-21**) colliding with routing's **parallel
`<Dial>` to all assigned + `accepting_calls` agents**. At limit 1 only one outbound leg is placed; with **2 of 3
agents (Dilnoza, Tejas) offline but still dialed**, the single slot usually landed on a dead identity → greeting,
no ring, apology. Evidence: prod `calls` rows (NO_ANSWERs dying in 7–15s, not the 120s ring) → Twilio per-leg
logs (all legs 0s/no-ring) → Twilio Monitor **10004 "concurrency exceeded" on every call** → console limit=1.
**NOT a code regression** (10004 + fast-misses go back ~2 weeks; rate rose as test agents drifted offline; an
earlier "tab-backgrounding" guess was refuted by Kumar's A/B test).
**Fix (TDD, merged `--no-ff` `2072105` → prod `dpl_HhkT1Go…`):** routing dials only **reachable** agents — new
pure `isReachableForDial(status,lastSeenAt,nowMs)` in `lib/voice/presence.ts` (= `effectivePresence(...)===
"AVAILABLE"`, so a stale heartbeat is unreachable even though the OFFLINE sweep is daily); `resolvePrimaryAgent`/
`resolveAvailableAdmins` (in `app/api/twilio/voice/incoming/route.ts`) select `status,last_seen_at` and gate;
empty-targets now emits a Sentry warning. With one online agent the fan-out collapses to a single leg → fits limit
1 → connects. `planDial`/TwiML byte-identical; zero migrations/RLS. All gates green.

**FIRST ACTION next chat (before anything else):** confirm Kumar's **single-agent prod voice smoke** — with only
his softphone online, call in 3–4× → every call should ring + connect (no random apology); and a fully-offline
call should apology + log a Sentry "no reachable agents" event. **If it passes:** check off A in the punch-list,
add a `docs(status)` note, move to the B items. **If it still misses:** the fix is presence-gating only — the
deeper lever is the Twilio concurrency increase (pending) and/or the lower-priority "harden + surface real Twilio
**Device** registration" follow-up (presence is a proxy for reachability, not a guarantee the Device is
registered) — re-open with the Twilio per-leg logs (creds in `apps/portal/.env.local`; Supabase prod ref
`ztunzdpmazwwwkxcpyfp`; both query approaches are in this session's history).

**Remaining v1 (see `docs/v1-punchlist.md`):** B1 Hang-up→**blaze** (LOCKED, no brainstorm), B2 kiosk favicon,
B3 hourly chart → thin 3-series (audio/video/missed, teal/navy/blaze, match Kumar's reference image), B4
"total call duration" → body font, B5 desktop type-scale bump, B6 logo+wordmark on all auth pages, B7 make the
**incoming-call property name** unmistakable; C finish the brand-polish audio smoke (local-time ticks +
Enter-saves-note); D the security-posture doc.

Read order for the next session: `CLAUDE.md` → `MEMORY.md` → this file → **`docs/v1-punchlist.md`** (the v1 tracker).
Brand design source =
`docs/brand/brand-guidelines.md`; impeccable context = `docs/PRODUCT.md` + `docs/DESIGN.md`. Relevant
auto-memories: `voice-vs-video-incoming`, `dev-server-sandbox-hazard`, `build-quirks` (the new `.next`
" 2"-dupe quirk).

---

### Session 26 cont. (2026-06-19, evening handoff — pick up in a fresh chat)

Two things shipped to `main` (Vercel auto-deploys both apps to prod). Kumar is re-testing **this evening**.

**1) UI/UX punch-list §B — ALL 7 DONE, pushed (`be5dab4`).** Implementation against the locked brand system
(`docs/brand/brand-guidelines.md`); TDD only where there was logic (B3 chart data).
- **B1** Hang up → **blaze** (`bg-attention`+ink) in `components/softphone/audio-call-overlay.tsx`; 911 stays red.
- **B2** Kiosk favicon — reused the portal navy-tile + reversed-mark SVG → `apps/kiosk/public/icon.svg` + `<link>`
  +`theme-color` in `index.html` (ships to `dist/`).
- **B3** Hourly chart → **thin grouped 3-series** bars + gridlines; new `HourlyLegend` (Phone=teal · Video=navy ·
  Missed=blaze) wired into agent/admin/owner cards. **Data partition (a decision — flag if Kumar wants it different):
  clean/non-overlapping** — `hourlyVolume` now buckets `audio`=answered AUDIO (COMPLETED), `video`=answered VIDEO,
  `missed`=NO_ANSWER; FAILED + live excluded (no double-count). `HourlyCall` gained `state`, `HourBucket` gained
  `missed`; `splitTodayByChannel` → narrower `DatedChannelCall`. TDD RED→GREEN.
- **B4** "Total call duration" → body font (dropped `font-mono`), agent + admin.
- **B5** Desktop type scale `+6.25%` — `globals.css` `@media (min-width:1024px){html{font-size:106.25%}}`
  (percentage = respects browser default; rem text+spacing scale together). **One knob — raise toward 112.5% if it
  still reads small.**
- **B6** Logo+wordmark **lockup** on all auth pages — extracted `components/auth/auth-shell.tsx`
  (Wordmark→`LogoLockup`); `(auth)/layout.tsx` delegates; new **`app/auth/layout.tsx`** brings `/auth/update-password`
  (outside the `(auth)` group — URL must stay) into the same shell; `update-password/page.tsx` stripped to its form.
- **B7** Incoming-call **property name** made prominent (`font-display text-2xl` bold) in `softphone.tsx`.
- Gates: 475 portal tests + typecheck + lint + check:routes + portal/kiosk builds all green. A faithful static chart
  preview was shown to Kumar in-chat. **PENDING: live visual pass** (sandbox can't run dev) — esp. B3 chart (needs a
  dashboard with calls today), B5 scale, B6 auth lockups, B7 + B1 (best seen during a real call).

**2) Item A voice smoke → found the presence-gate over-excluded ON_CALL; fixed + pushed (`d18d452`; doc `87e2562`).**
Single-agent smoke (only Dilnoza meant to be online) STILL apologized. `systematic-debugging` + **Twilio per-leg logs
were decisive:** the assigned primary agent (Dilnoza, correctly assigned) was **NEVER dialed** — she'd finished a
**VIDEO call ~22s earlier** so her presence was **ON_CALL**, and `isReachableForDial` required `status==="AVAILABLE"`
*exactly* → `resolvePrimaryAgent` skipped her. Both calls' legs went to the two ADMINS instead (Tejas
registered-but-unmanned → 125s no-answer; Kumar Device dead → 0s fail) → apology. **Fix:** reachable =
**`AVAILABLE || ON_CALL`** + fresh heartbeat (= the dashboard's `countOnlineAgents` "online" definition); still
excludes AWAY (opted-out) + stale/OFFLINE. TDD (old test literally asserted `ON_CALL→false`); all gates green.
- **CORRECTION (Kumar):** the `IN_PROGRESS` AUDIO row `83ef58de` seen mid-investigation was **his real live call with
  Dilnoza** — NOT a leak and NOT an audio-finalization bug. **Do not chase it.**

**EVENING RE-TEST PLAN (do this first next chat):** re-run the single-agent voice smoke, but with hygiene that matters
**at Twilio concurrency = 1** (still 1 until ~2026-06-21):
1. **Only ONE agent reachable.** At limit 1, multiple reachable targets RACE for the single slot. Set **Tejas's
   "Covering"/`accepting_calls` OFF** (or have him truly offline ≥90s); Kumar's admin is already `accepting_calls=false`.
   Otherwise the dial can land on an admin, not Dilnoza.
2. **Dilnoza: exactly ONE portal tab, foregrounded, "Accepting calls" ON.** A backgrounded tab throttles the 20s
   heartbeat → stale → OFFLINE → excluded. A *second* lingering "not accepting" tab fights the live one → flaps her to
   AWAY (the likely source of the "dashboard says AWAY, screen says accepting" she saw).
- Expected with the fix: every call rings + connects to Dilnoza, even right after a video call. Claude can verify live
  via prod `calls` rows + Twilio per-leg logs (creds `apps/portal/.env.local`; Supabase prod ref `ztunzdpmazwwwkxcpyfp`;
  child legs: `GET .../Calls.json?ParentCallSid=CA…`). Then also do the **UI/UX live visual pass** (B1–B7 above).

**Residuals / follow-ups (non-blocking, logged in punch-list §A):** (a) presence freshness lags real Twilio **Device**
registration by up to 90s (a just-closed browser is still dialed → 0s fail) — robust fix = gate on Device registration,
not the heartbeat; (b) concurrency=1 races multiple reachable targets — the raise (~06-21) is the multi-agent unblock;
(c) the "AWAY while accepting" flap — most likely multiple tabs; revisit only if it recurs with a single clean tab.

**Commits this session:** `be5dab4` (UI/UX §B), `d18d452` (ON_CALL fix), `87e2562` (punch-list doc).
Read order unchanged: `CLAUDE.md` → `MEMORY.md` → this file → `docs/v1-punchlist.md`.

---

## Session 27 (2026-06-20) — §A confirmed working in prod logs; Sentry hygiene + status-card fixes; presence-display mismatch fixed

Kumar kept testing §A and asked Claude to read the logs. Three threads, all shipped to `main` → prod.

**1) Item A (call reliability) — CONFIRMED WORKING from prod logs (no code change this thread).** Evidence via Supabase prod (`calls`) + Twilio REST (per-leg logs + Monitor alerts):
- **Today (06-20) audio: 4/4 COMPLETED, 0 NO_ANSWER, 0 sub-30s fast-fails** (vs 06-19: 7/16, 8 fast-fails; 06-18: 0/2). **Twilio 10004 "concurrency exceeded" alerts: 06-17=3, 06-18=1, 06-19=13, 06-20=0.**
- Per-leg: today every call dialed **Dilnoza (agent) + Tejas (admin)**; Dilnoza answered 3/4, Tejas 1/4 → the **`d18d452` ON_CALL fix is working** (she's dialed now; on 06-19's misses she was never dialed). **No black-holed calls** — the "no reachable agents" Sentry warning never fired (DB invariant: empty-targets are born NO_ANSWER; today had zero; Kumar confirmed nothing under "reachable" in Sentry).
- **STILL OPEN (the real §A close):** (a) the **isolated single-agent smoke has NOT truly been run** — right now Dilnoza **and** Tejas **and** Kumar all read AVAILABLE/online, so today's connects always had ≥2 manned identities (at limit-1 the race resolved to a live human either way). Definitive close = only Dilnoza reachable (Tejas accepting-off/offline; Kumar admin already accepting-off), her tab foregrounded → call 3–4×. (b) **Whether the Twilio concurrency cap actually lifted is UNCONFIRMED** — leg timing is ambiguous and the REST API can't read the cap; check the **Twilio console** (was 1; raise expected ~06-21). 0×10004 today is suggestive but volume was low.

**2) Sentry hygiene + read access — PRs #20 (`ca0369f`) + #21 (`6281d60`).** Surfaced while reading §A logs.
- **Read access set up:** `pnpm sentry:issues` (+ `-- --issue <id>`) CLI (`scripts/sentry-issues.mjs`) reads a new **`SENTRY_READ_TOKEN`** (Sentry **Internal Integration**, Issue&Event:Read) in `apps/portal/.env.local`. **The build `SENTRY_AUTH_TOKEN` is upload-only → 403 on the issues API** — don't use it for reads. New memory `sentry-observability-access`.
- **#20:** gate Sentry to **deployed builds only** (local `next dev`/`vite dev` stop creating prod issues — the recurring `ReferenceError: X is not defined` cluster was **local-dev HMR**, env=development); **`isTwilioTransportNoise`** beforeSend filter drops the benign Twilio Voice transport-churn `UnhandledRejection` (WS close 1005 → `TransportError 31009`). That **31009** = live evidence for the §A "presence ≠ real Twilio **Device** registration" follow-up.
- **#21:** the `/admin/status` "Recent errors" card — (1) read `SENTRY_READ_TOKEN` (the upload token 403'd → card was silently null; **Kumar added the read token to Vercel _production_ env** via dashboard — the REST/CLI write is blocked by the auto-mode classifier); (2) the query counted **all-time** unresolved (Sentry's `statsPeriod` does NOT filter the issue list by age) → showed "2" (two **June-4** stragglers outside the 14d UI view) while the dashboard showed 0 → fixed with **`lastSeen:-24h`**; (3) cache **60s→120s** to ease the issues-endpoint rate limit (**5/short-window, shared token** → transient grey "Sentry unavailable" flaps that self-heal).

**3) Presence-display mismatch — PR #22 (`c76d156`).** Admin dashboard Properties board showed an agent **OFFLINE** while `/admin/users` showed the same agent **AVAILABLE**. Cause: the users table rendered the **raw `profiles.status` column**; everywhere else (dashboard, owner portal, routing) computes **`effectivePresence`** (heartbeat stale >90s → OFFLINE regardless of the column — the OFFLINE sweep is only daily). Confirmed live: **Dilnoza** status=AVAILABLE, heartbeat ~2.5h stale → OFFLINE. Fix: `/admin/users/page.tsx` maps rows through `effectivePresence`; also refactored the dashboard's 2 inline `isStale ? OFFLINE : status` onto `effectivePresence` (one source, can't drift again). **Note:** non-softphone **OWNERs** now read OFFLINE in the users list (accurate) — blanking presence for owners is an easy open follow-up.

**Post-deploy checks for `c76d156` (verify next chat):** `/admin/status` Sentry tile reads **0 / green** (Kumar also resolved the 2 June-4 issues); `/admin/users` shows Dilnoza **OFFLINE** matching the dashboard; the Twilio `UnhandledRejection` drops off Sentry over ~a day.

**PICK UP HERE (fresh chat):**
1. **Close §A properly:** the **isolated single-agent smoke** (only Dilnoza reachable + foregrounded; Tejas accepting-off) → all calls ring+connect; **and confirm the Twilio concurrency cap in the console** (was 1; raise expected ~06-21). If both good → check off §A in `docs/v1-punchlist.md`.
2. **§C:** finish the audio in-call smoke (hotel-local-time ticks + Enter-saves-note) + the live a11y/visual pass for §B.
3. **§D:** write `docs/security-posture.md` (plain-English auth/tokens/caching/PII/service-role; consider the `security-review` skill).
4. Optional: blank presence for OWNERs in `/admin/users`; the deeper Twilio **Device**-registration hardening (§A follow-up); downsize `ring.mp3`.

**Commits this session:** `ca0369f` + `6281d60` (Sentry, PRs #20/#21), `c76d156` (presence, PR #22). New memory: `sentry-observability-access`. Read order unchanged: `CLAUDE.md` → `MEMORY.md` → this file → `docs/v1-punchlist.md`.

---

## Session 28 (2026-06-20) — §D security-posture doc + security-review rigor pass + cleanups

Branch `v1-security-posture` (off `main`). Closes punch-list **§D**. Three threads.

**1) `docs/security-posture.md` written (the §D deliverable).** Plain-English, audit-style, source-backed (file:line citations; explicit "inferred / not re-verified" flags per CLAUDE.md sourcing discipline). Covers: **auth & access control** (Supabase password-only admin-provisioned no-SMTP via `provision.ts`; `must_change_password`→`/onboarding` gate; middleware session gate; RLS on all 10 tables; profiles column-guard `0012` keyed on `current_user_role()` read from the table not the JWT → no JWT-tamper escalation; owner column-guards `0010`; the `requireApiActor`/`fetchOperatorCall` v2 multi-tenant seam); **token lifetimes** (Supabase session cookie + the one sourcing caveat = exact JWT TTL is a dashboard setting, default ~1h, not re-verified live; **Twilio Voice = 3600s** `token/route.ts:10`, in-memory, in-place auto-refresh, receive-only grant, self-identity; **Agora = 3600s** `agora/token/route.ts:13`, in-memory, channel-scoped publisher; **kiosk config = no expiry**, localStorage + `?t=`, HMAC-SHA256 + `timingSafeEqual`); **caching** (`cache()` render-dedupe in `session.ts`; the single `unstable_cache` = Sentry probe 120s `errors.ts:40`; 20s `AutoRefresh` poll + focus, no realtime; nothing else cached); **PII** (`scrubPii`/`scrubEvent` + `isTwilioTransportNoise` wired in 3 portal configs + kiosk; `audit_logs` has no PII column, admin-read/service-write; **recording OFF** — `recording_url`/`_sid` never written, grep-confirmed, no Twilio `record` attr); **secrets/service-role** (`SERVICE_ROLE_KEY` only in `env.ts`+`admin.ts`, never `NEXT_PUBLIC`/hardcoded; every service-role surface authenticates first — Twilio HMAC / `requireApiActor` / kiosk HMAC / `CRON_SECRET` fail-closed; Sentry token split).

**2) Security-review rigor pass (skill + live Supabase advisor) → no high/medium exploitable vuln.** Two read-only ID sub-agents over auth/RLS/service-role and tokens/HMAC/kiosk/PII; findings verified by reading the cited files myself (FP filter). Live `get_advisors(security)` on prod ref `ztunzdpmazwwwkxcpyfp` (2026-06-20). Triage:
- **FIXED (TDD):** Sentry scrubber missed recording URLs in free text / camel-case `RecordingUrl`/`recording_sid` keys. Added `RECORDING_URL_RE` (redacts `…/Recordings/…`) + `recording` to the key regex (`packages/shared/src/sentry-scrub.ts`; +3 tests). LOW (v1 has no recordings → no live exposure; forward-compat for the recording seam).
- **FILED to `docs/v2-backlog.md`:** (a) kiosk config token has **no expiry / no per-property revocation** + gates the WiFi password — **MEDIUM**, fix = per-property `kiosk_token_version` in the signed payload (pairs with the post-pilot device-registry item); (b) Agora token route doesn't constrain **`uid`** to a role namespace — **LOW**, same-call/own-property only, fix touches the live video path so deferred.
- **ACCEPTED (documented, no action):** advisor's 7× "SECURITY DEFINER executable by `authenticated`" = **by design** — `0014` re-grants EXECUTE to `authenticated`/`service_role` because RLS evaluates the helpers as the querying user; they only return the caller's own role/operator. Leaked-password protection disabled = **known Pro-tier deferral**. Twilio `Host`-header trust → only false-*negatives* (availability), not forgery.

**3) Optional cleanups.** OWNER presence in `/admin/users` now renders **"—"** (no misleading OFFLINE) — new TDD'd `roleHasPresence` (`lib/voice/presence.ts`) wired in `page.tsx` + `users-table.tsx:559`; agent/admin unchanged. **ring.mp3 NOT downsized** — no mp3 encoder in the sandbox (`ffmpeg`/`lame`/`sox` absent; `afconvert` can't emit mp3); 681KB/320kbps file untouched. Later: `ffmpeg -i ring.mp3 -ac 1 -b:a 80k ring.new.mp3` + confirm it rings on an incoming video call (prod-only).

**Gates:** typecheck (4 workspaces) · lint · check:routes · tests (shared 21 / kiosk 24 / portal 468+16) · portal+kiosk builds — **all green.** Zero migrations / RLS / new routes / service-role.

**NOT done this session (Kumar live, per the task):** §A isolated single-agent voice smoke + the Twilio concurrency-cap console check; the deeper Twilio Device-registration hardening (§A follow-up). Read order unchanged.

**Merged + deployed (2026-06-20).** PRs **#23** (`4f4eb11` — security-posture doc + Sentry scrubber recording-URL fix + OWNER-presence "—") and **#24** (`7a99989` — desktop type scale **106.25% → 112.5%**, the §B5 follow-up after Kumar's live desktop pass) merged to `main` → Vercel prod (auto-deploy). **Kumar confirmed §B + §C done** this session. Type-scale next rungs if still small: **118.75% / 125%** (one-line knob, `apps/portal/app/globals.css` `@media (min-width:1024px)`); note fixed-px `text-[11px]` micro-labels don't scale with it (convert per-spot if needed).

**v1 status (as of session 28): down to §A only.** To call the pilot done: (1) the **isolated single-agent voice smoke** — only Dilnoza reachable (Tejas Covering-off/offline ≥90s; Kumar admin already accepting-off), her tab foregrounded → call 3–4×, expect every call rings+connects; (2) **confirm the Twilio concurrency cap in the console** (was 1; raise expected ~2026-06-21 — REST can't read it); (3) lower-priority: real Twilio **Device**-registration hardening (presence is a proxy, lags reachability by ≤90s — `docs/v1-punchlist.md` §A + [[call-reliability-concurrency]]). Everything else is v2 (`docs/v2-backlog.md`): kiosk-token revocation, Agora-uid namespace, ring.mp3 downsize (no encoder in sandbox), cut-from-v1 features. Security posture of record: `docs/security-posture.md`.

---

## Session 29 (2026-06-21) — v1.0.0 release + versioning policy + staging environment

Three deliverables (brainstorm → spec → plan → execute). Did **not** touch v1 §A (voice smoke still Kumar's).

**1) v1.0.0 cut + released.** `v1.0.0` tag on release commit `cf81e48` + [GitHub Release "Pilot baseline"](https://github.com/kthakkar1983/lobby-connect/releases/tag/v1.0.0) (curated notes; `--generate-notes` skipped — much of v1 landed straight to main, not via PR). All four `package.json`s `0.0.0 → 1.0.0`. Straight-to-main per Kumar (no-logic bump).

**2) Versioning policy.** Semver via git tags + GitHub Releases (`docs/VERSIONING.md` + CLAUDE.md conventions pointer). `plan-*` tags kept as a separate milestone axis. **PR-per-release from v1.1 onward** (so CI is green before the tag + auto-notes are clean).

**3) Staging environment — built + portal-verified.** Persistent, prod-shaped, **$0**. Spec `docs/specs/2026-06-21-versioning-and-staging-design.md` · plan `docs/plans/2026-06-21-staging-environment.md` · **runbook `docs/setup/2026-06-21-staging-runbook.md`** (URLs, creds, env matrix, promotion flow, gotchas).
- **Supabase** `lobby-connect-staging` (ref `cgtvqjxhbojztzumshca`, us-east-1; free tier's 2nd active project — `Back of House` paused). Migrations 0001–0017 via MCP + schema verified (10 tables / 8 fns / indexes / 18 policies). Seeded operator + property (`supabase/seed-staging.sql`) + admin `admin@staging.lobbyconnect.local` via the **GoTrue admin API** (real `auth.identities` row → sign-in works; `must_change_password=false`).
- **Vercel:** long-lived `staging` branch → both apps auto-deploy as Preview; env scoped **Preview/`staging`** (set via CLI). Twilio/Agora/Sentry **shadowed to empty** so staging is isolated from prod (the project's pre-existing all-branches Preview vars would otherwise leak in). URLs: portal `lobby-connect-portal-git-staging-kumar-thakkars-projects.vercel.app`, kiosk `…-kiosk-git-staging-…`.
- **Verified:** prod-isolation proof ✅ (staging admin absent from prod); **Kumar confirmed portal sign-in + staging data** ("Good morning, Staging" + Staging Test Hotel). **Kiosk DEFERRED on staging** (Kumar's call) — the cross-origin kiosk→portal API call is blocked by Vercel's preview auth wall (`/api/kiosk/config` → 401, no SSO cookie for the portal domain); not needed for v1.1 (portal-side work) and the kiosk rarely changes. The generated link itself is correct (uses `KIOSK_ORIGIN`). Re-enable = disable preview Deployment Protection (exposes all previews) or send a Vercel bypass token from the kiosk — see the runbook.
- v2 follow-up (broaden staging DB to all preview branches) filed in `docs/v2-backlog.md`.

**Learnings:** Vercel **de-dupes** a branch push at an already-deployed SHA → needed a unique commit to trigger the first staging build; pre-existing **all-branches Preview env vars LEAK** into a new branch unless shadowed per-branch; the kiosk swallows config-fetch errors (`App.tsx:41` `catch(() => {})`) so every failure looks identical to "stuck on Loading"; `vercel env add <N> preview <branch> --value <V> --yes` is the non-interactive CLI form; `supabase db push` to staging is blocked here (no Postgres egress / CLI linked to prod) so migrations go via the MCP; Vercel **snapshots env vars at deploy creation** (vars added after a deploy is triggered need a fresh deploy/re-sync — the cross-app URL vars fell back to localhost until a re-sync); the **preview auth wall blocks cross-origin API calls** (kiosk→portal 401), so a protected staging preview can't run the kiosk.

---

## Session 30 (2026-06-22) — s1-test fixes (video routing + finalization + call UI) → v1.0.1

Kumar's s1 smoke surfaced 3 issues; investigation found a 4th (a data-correctness bug). All fixed via `systematic-debugging` (root-cause-first, TDD), merged `--no-ff` `2aeba0d` (fix `0249159`) → prod, **smoke CONFIRMED**, then released **`v1.0.1`** (first PATCH on the v1.0.0 baseline). Did **not** touch v1 §A (voice smoke / Twilio concurrency — still Kumar's; these fixes are orthogonal).

**1) Video rang every agent/admin (not just the assigned/covering set).** `GET /api/calls/incoming-video` filtered only by operator + channel + RINGING + time-window — no assignment/`accepting_calls` scope, while the audio path (`resolvePrimaryAgent`/`resolveAvailableAdmins`) already scoped. Prod proof: a video call was `handled_by` Tejas, an ADMIN with `accepting_calls=false`. **Fix:** new `resolveTargetPropertyIds` (in the route) scopes the poll to the same set as the audio dial — the property's assigned primary agent + admins accepting calls for it; empty scope short-circuits (no query, no ring). **Presence deliberately NOT gated on the polling user** (polling proves liveness; a stale heartbeat must not silence a present client — unlike audio, which gates dead Twilio identities). 7 tests.

**2) Answered video calls mislabeled NO_ANSWER (the data anomaly).** The kiosk finalizer (`/api/kiosk/call-ended`) mapped `cancelled`/`no-answer` → NO_ANSWER with only an `.in(state, ACTIVE_CALL_STATES)` guard, so it overwrote an already-answered IN_PROGRESS call. Triggered by a concurrent accept (both rung browsers accepted — #1's broadcast) or a guest ending a connected call (kiosk `onCancel`/abort paths send `cancelled`, racing the agent's `completed`). **Fix:** new pure `resolveFinalState(reason, answered)` in `lib/voice/call-state.ts` — an answered call (`answered_at` set) can only be COMPLETED/FAILED, never NO_ANSWER. **15 corrupted prod rows (back to 2026-06-06) backfilled to COMPLETED** via MCP. Tests in call-state + call-ended.

**3) Phantom ringtone, unidentifiable tab.** A tab rang during a meeting and no one could tell which — incoming calls left no tab-level signal. Mostly explained by #1 (video broadcast rang everyone; prod had zero stuck RINGING rows). **Fix:** new `lib/hooks/use-ringing-tab-title.ts` flashes the browser tab title ("Incoming call · {hotel}") while ringing, wired into the audio softphone (`phase==="incoming"`) and the video banner. Hook unit-tested.

**4) Chart colours ≠ recent-calls indicator.** Channel colour was defined in ~4 places independently and the recent-call channel icon was muted grey. Kumar chose: keep the chart's channel colours, bring the icon up to match. **Fix:** shared `lib/dashboard/channel-colors.ts` (teal=phone, navy=video) used by the chart/legend/bar + the recent-call icon; outcome dots (mint/blaze/grey) unchanged.

**Release:** `v1.0.1` — four `package.json`s `1.0.0 → 1.0.1`, annotated tag, GitHub Release. CI green before the tag (per `docs/VERSIONING.md`).

**Gates:** full suite (+ new specs) · typecheck · lint · check:routes · portal build · CI — all green. Zero migrations / RLS / new routes / service-role. Cross-session memory [[voice-vs-video-incoming]] updated.

**v1 status (Kumar, 2026-06-22): COMPLETE.** §A (call reliability) smoke passed — audio connects reliably with the presence-gated single-agent routing. The **Twilio concurrent-call cap (=1) + multi-agent fan-out are deferred to v2** (`docs/v2-backlog.md` → Agents/routing). v1 (pilot, one hotel end-to-end) is done; remaining `docs/v1-punchlist.md` items are non-blocking niceties or v2 pointers.

---

## 2026-07-01 — STACK-CONSOLIDATION rethink + business-model correction (brainstorm; nothing built)

*(Sessions between v1.0.1 and here — v1.1 captions, v1.2 realtime, first-call-audio debug, background-alerting design — are captured in their own handoffs + auto-memory, not re-logged here.)*

A pure strategy session — **no code changed; docs/memory updated.** Two outcomes:

1. **Business model was undocumented and is now committed.** Lobby Connect provides **virtual night-shift front-desk employees** who **remote into the hotel PC (RustDesk)** to do check-ins / reservations / night audit — remote-desktop is a **deliberate PCI firewall** (card/PII/PMS stays on the hotel PC → LC out of PCI scope). **Pod model:** 1 agent owns ~5 properties, same faces (employees, not a call center). **Overflow:** manual admin `covering` toggle, SOP-coordinated, **no auto-widening**; raise Twilio concurrency at launch so the built-in parallel dial (agent + covering admins) places multiple legs. Written into `CLAUDE.md`, `docs/PRODUCT.md` ("Operating model"), memory `business-model-remote-desktop`.

2. **Major stack-consolidation direction agreed (high-level, NOT designed/locked):** move ~9-10 rented vendors → ~3-4 on **owned servers**. **Keep Twilio.** **Drop Agora** (opaque billing — a 7:39 call showed 71 min). Self-host **video** (LiveKit/Jitsi), the **app** (off Vercel via Coolify/Dokku — re-host, not rewrite), and the **RustDesk relay**; **database = open "keep managed?" call** (only irreplaceable asset). Captions/Sentry/analytics = minor/low-priority. Kumar has an unshared idea for **folding RustDesk into the agent dashboard** — which ≈ most of the background-alerting fix (LC becomes foreground → Web Push demotes to backstop), so prior threads (**Web Push alerting, realtime phases 2-4, Vercel Pro**) are **on hold / reframed.**

**START HERE next chat: `docs/handoffs/2026-07-01-stack-consolidation-strategy-handoff.md`.** First action: **pull Kumar's RustDesk-into-dashboard idea out**, then decide the DB question, then design the target architecture. **`CLAUDE.md` + `docs/PRODUCT.md` edits are UNCOMMITTED** (load from disk regardless; commit if desired). *(Superseded the same day by the design session below — the CLAUDE.md/PRODUCT.md edits turned out to be already committed in `2e107ca`.)*

---

## 2026-07-01 (second session) — Stack consolidation DESIGNED + LOCKED (spec + migration plan written; docs only)

The design session the strategy handoff asked for. **No code changed** — two design docs + doc/memory sync. Dialogue-first per the register; two source-backed research agents (VPS cost model; RustDesk feasibility) — every price/limit cited in the spec.

**Kumar's idea, finally on the table:** a **Connect** button in the call window — call shrinks to a small floating window (Google-Meet style), playbook folds to a sidebar, and the hotel PC's remote session fills the screen. His 13 Q&A answers added: **per-property dashboard cards** that also carry ringing + Answer (back to the original dashboard vision; kills property misidentification); dashboard = the agent's all-night home base (standalone RustDesk retired); one remote session at a time; a **one-click hold** (pause audio+video — resurrects the v1-cut held-call slot); hotel PC = the hotel's primary PC behind the counter (blackout nice-to-have); RustDesk passwords currently sit on the agent's PC (→ LC will broker/inject/rotate/audit them); **an AHK + Zebra DS9308 driver-license scanner script already lives on hotel PCs** (Claude-cowork-built, SynXis-specific, stays a separate install — documented as the "hotel-PC footprint" pillar); keys = lockbox/premade; comms stay WhatsApp; target 10–25 properties / 5–10 agents / 1 PC each; **India hire = server/software maintenance, not ops** (→ boring tech, few endpoints, runbooks); migration freedom is high (his own property, on-site, standalone RustDesk + Google Meet as fallbacks); **Twilio concurrency cap is raised but extra concurrent legs cost money → staying at current capacity until needed** (CLAUDE.md corrected).

**Research verdicts (full citations in the spec):**
- **RustDesk web client V2 = REJECTED for embedding:** closed-source (V1 source deleted from `master` 2025-07-01; V2 never published), "preview" grade, self-hosting it gated behind Server Pro ≥ $47.88/mo, **no URL-param/iframe auto-connect** (unanswered GH discussion #14059), and in-browser E2EE **unverifiable** for the client we'd use — fails the PCI story. **Native path fully verified instead:** `rustdesk://connection/new/<id>?password=<pw>` deep link confirmed in shipped source (`urlLinkToCmdArgs`), mass provisioning via `--silent-install`/`--config`/`--password` documented, hbbs/hbbr AGPL with **no session limits** (Kumar's "1 concurrent connection" = the Customized-V2 paid plan, not OSS). E2EE maintainer-confirmed peer-to-peer; ops rule = pin server key, non-encrypted indicator = incident. No alternative OSS tool passes browser-viewer+blind-relay+Windows (KasmVNC = no Windows).
- **Cost model:** **Hetzner US is out** (2026-06-15 ~3× US price hike; $73.49 for 4c/8GB + only 3TB traffic). **DigitalOcean Basic 4c/8GB $48/5TB** picked (Vultr $40–48 = named alternate). LiveKit (Apache-2.0, embedded TURN) sized by its official benchmark → our peak ≈ 1–2 cores. **All-in fixed ≈ $84/mo** (box + 20% backups + R2 dumps + Supabase Pro $25 + domain) = $3.40–8.40/property/mo at target scale; bandwidth ~1–1.5TB vs 5TB included (wildcard: RustDesk relay fallback — make P2P work).

**Docs written:** spec `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` (architecture, dispositions, RustDesk integration design incl. `property_remote_access` sketch + rejected-alternatives record, agent-workspace direction, cost model, tradeoffs, non-goals) + migration `docs/plans/2026-07-01-stack-consolidation-migration.md` (**Phase 0** hygiene: merge `fix/max-call-duration-cap`, tag `pre-consolidation-baseline` → **1** box+domain+Coolify+staging → **2** self-hosted relay → **3** property cards + Connect + floating Document-PiP call window + hold [on Vercel/Agora, feature-only] → **4** LiveKit swap [flag + 1-week soak] → **5** app cutover off Vercel + decommission + the final DB call; rollback per phase). CLAUDE.md current-focus + RustDesk stack line updated; old handoff banner-superseded; **new START HERE: `docs/handoffs/2026-07-01-stack-consolidation-design-complete-handoff.md`**.

**Review round (same session, pre-commit):** Kumar challenged four things — tile utility ("can't read a playbook in a tiny cell"), the admin dashboard, LiveKit-vs-Jitsi, and notifications-for-real (agents watch YouTube between calls). Amendments locked: the tile is a **persistent "deskphone"** opened at shift start (a "Go on duty" click that also primes audio) — **lifeline, not workspace** (playbook/notes stay in the portal tab; mid-PMS the call is audio); **layered alerting** = tile-above-everything (L1) + **Web Push BUILT in Phase 3, un-demoted** (L2, folds in the 2026-06-30 alerting handoff) + Twilio's background-proof audio ring (L3), with two verify-at-build items (PiP exempts its parent tab from throttling; tile floats over OS-fullscreen video); **admin workspace** = same card component, **pod-grouped fleet view** under the command-center strip, ring gated by `covering`, **Connect on ANY property** (locked); **LiveKit-vs-Jitsi** = product-vs-infrastructure (Jitsi = named plan B; its 1:1-P2P bandwidth edge conceded and priced in); **Gate 3.0** = a 1–2 day deskphone-tile prototype judged live by Kumar + the pilot agent BEFORE Phase-3 proper (fail → thin desktop-shell escalation). Realtime phases 2–4 de-pressurize to pure-UX questions once off metered serverless.

**Phase 0 DONE (same session):** tag `pre-consolidation-baseline` @ `47b6a49` + merge `d9f04da` (`fix/max-call-duration-cap` — 30-min hard cap on connected video calls, kiosk + agent side, module-guard under the 3600s Agora token TTL; one clean auto-merge in `video-call.tsx`; full suite + typecheck + lint green post-merge). **NEXT: Phase 1** (domain + DO box + Coolify + staging hosting + ops runbook). Carry-forward hygiene unchanged: temp guest-audio diagnostics on `main`, GitHub secret-scanning alert, first-call-audio cause not airtight.

---

## 2026-07-02 — Phase 1 KICKOFF (brainstorm dialogue; docs only, no code)

Phase-1 house-workflow brainstorm opened; **clarifying dialogue with Kumar DONE**, design presentation NOT yet (next session). Decisions locked: **region ATL1** (measured TCP-connect RTT from OKC: ATL1 30 ms vs SFO 54–55 / NYC3 58 / TOR1 58; both Supabase projects are `us-east-1` so east coast also wins the box↔DB leg; verify 4c/8GB in ATL1 at provision, fallback NYC3) · **registrar/DNS Cloudflare** (at-cost .com $10.46/yr verified; infra hosts grey-cloud/DNS-only) · **one domain** — apex reserved for the ~1-month-out landing page (Kumar + India partner picking the name; `lobbyconnect.com`/`.io` taken, `lobby-connect.com` available + recommended; split .app/.com option = works-but-zero-benefit) · **DO auto-backups + Supabase Pro deferred to Phase 5** (phase-boundary snapshots meanwhile; migration-period net-new ≈ $49/mo) · **nightly prod `pg_dump` (read-only DB role) pulled forward INTO Phase 1** — fact-check confirmed the Supabase free tier has ZERO backups → prod pilot data currently unprotected. Kumar also challenged DO-vs-AWS/Cloudflare-hosting ("not the Agora mistake again?") → answered + **recorded in spec §3** (CF containers can't take non-HTTP TCP/UDP → no LiveKit/RustDesk; AWS egress $0.09/GB → bandwidth alone > the box; managed-Postgres ≠ Agora because OSS exit door + flat price; own-the-stateless-rent-the-stateful). Preflight: staging Supabase restored **ACTIVE_HEALTHY** (was auto-paused); `staging` branch 66 behind `main` (re-sync at build); no SSH keys/`doctl` on the Mac. **Kumar's homework before next session: domain purchase on Cloudflare + DO account (+ scoped API token if Claude drives `doctl`, recommended) + (optional) his specific Supabase-Auth gripes for the Phase-5 record.** **START HERE: `docs/handoffs/2026-07-02-phase1-kickoff-handoff.md`** (decisions + next-session runsheet). Spec §3/§7/§9-adjacent + migration-plan Phase-1 amended.

---

## 2026-07-02 (second session) — Phase 1 design presented + spec WRITTEN (docs only, no code; nothing provisioned)

Resumed from the kickoff handoff; the design-presentation session. **Inputs collected:** `lobby-connect.com` purchased on **Cloudflare Registrar**; DO account active + **full-access API token** handed over (stored only in `~/.config/doctl/config.yaml` on Kumar's Mac; `doctl` installed via brew; **revoke/rotate after the Phase-1 build**). **Read-only `doctl` preflight verified live:** account active (droplet limit 3); `s-4vcpu-8gb` = 4c/8GB/160GB/$48/5TB **available in NYC3, NOT offered in ATL1**; image `ubuntu-24-04-x64` available. Nothing created.

**Region resolved ATL1 → NYC3 (decision record in the Phase-1 spec §1).** Kumar surfaced a major new business fact — **~95% of agents/admins will be India-based; 100% of hotels are US** (US nights = India days) — and asked whether the box should live in India. Answer: NO — the DB (`us-east-1`, managed, locked) + Twilio webhooks + 100%-US hotels anchor US-East; every SSR page / call-setup webhook does multiple DB round trips (~10 ms from NYC vs ~200 ms from India → would slow US guests' ring path); the agent↔hotel India↔US leg is fixed geography no middle-hop placement can shorten (RustDesk norm = direct P2P anyway); and US-East beats US-West for India RTT (Europe route, estimates labeled). Consequence recorded: **Phase-2 (relay-vs-P2P) and Phase-4 (LiveKit-vs-Agora) smokes must include a real India-side agent.** Fact persisted to auto-memory (business-model + stack-consolidation files).

**Design presented + approved in dialogue.** Highlights: **Dockerfiles not Nixpacks** (portal multi-stage w/ env-gated `output:"standalone"` — `BUILD_STANDALONE=1` only on Coolify, Vercel untouched; kiosk → nginx static w/ SPA fallback); **Traefik basic-auth with carve-outs** for self-secured paths — `/api/kiosk/*` (HMAC token; the exact Vercel-wall lesson) + `/api/agora/*` (dual-branch auth verified in `route.ts`; kiosk calls it cross-origin — carve-out inherited by the P4 LiveKit token route) + `/api/cron/*` (`CRON_SECRET`); **one Coolify "ops" container** hosts all scheduled tasks (reaper finally `*/15` on staging; presence daily 08:00; **nightly prod `pg_dump` 13:00 UTC** via new `lc_backup` role `LOGIN`+`pg_read_all_data`+`BYPASSRLS` [verify at build] — never the master password; `-Fc`, 14-day on-box retention, R2 ship stays at P5; **restore drill required in smoke**); `git.deploymentEnabled.staging:false` in both `vercel.json`s; DO firewall 22-restricted-to-Cox-IP/80/443; unattended-upgrades reboot 17:00 UTC (US nights ≈ 03:00–15:00 UTC); done = **a week unattended** (also proves `*/15` traffic prevents staging Supabase auto-pause).

**Spec written + self-reviewed: `docs/specs/2026-07-02-phase1-box-domain-staging-design.md` — AWAITING KUMAR'S REVIEW GATE** → then `writing-plans` → build (provisioning via `doctl`). Parent docs synced (migration plan Phase-1 line, target spec §3 region note, CLAUDE.md current-focus, MEMORY.md). Carry-forward hygiene unchanged (temp guest-audio diagnostics on `main`; GitHub secret-scanning alert; Supabase-Auth-gripes homework still open, collect by P5).

---

## 2026-07-03 — Phase 1 BUILT + SMOKE PASSED in one session; SOAK RUNNING (→ ~2026-07-10)

Same-day continuation: spec approved → plan (`docs/plans/2026-07-02-phase1-box-domain-staging.md`, 14 tasks) → inline execution with Kumar gates. **Repo tranche (PR #25, CI green):** portal/kiosk/ops Dockerfiles (all built + smoke-run locally), env-gated `output:"standalone"` (`BUILD_STANDALONE=1`, Vercel byte-identical; build-stage `SUPABASE_SERVICE_ROLE_KEY` dummy because Next page-data collection IMPORTS route modules at build), `git.deploymentEnabled.staging:false` both `vercel.json`s (verified: staging force-push fires no Vercel build), `ops/` backup+drill scripts; `staging` branch re-synced. **Infra:** droplet `lc-box-1` (NYC3, s-4vcpu-8gb, `159.203.124.112`, IPv6, monitoring, ID 581936683) + firewall `lc-box-fw` (22 only from Kumar's static `70.184.31.21`) + 3 DNS A-records (grey-cloud) + hardening (key-only sshd verified, ufw, fail2ban, unattended-upgrades w/ 17:00 UTC reboot window, 2G swap, UTC, clean reboot, 3 DO email alerts) + **Coolify 4.1.2** (Kumar: admin+2FA, instance domain w/ LE, GitHub App `lc-coolify` app 4204806 install 144083654; `.env` → PM). **Apps via Coolify API** (token from Kumar): project `lobby-connect`/env `staging` → `lc-portal-staging` (lg2rzpmc…) + `lc-kiosk-staging` (ziqzypp2…) + `lc-ops` (su8p4jpn…, no domain, `/data/lc-backups`↔`/backups`); env matrix API-set, 3 secrets pasted by Kumar in UI. **Basic auth:** Traefik basicauth + carve-out router (`/api/kiosk/*`+`/api/agora/*`+`/api/cron/*`, priority 100); **BUG FOUND: compose-style `$$` doubling is WRONG for Coolify — labels pass verbatim** (live container label showed `$$2y$$…` → auth rejected everything; fixed to single-`$`). **Staging admin password lost** → reset via GoTrue admin API (service key read silently from Coolify env) + `must_change_password=true` forced-change. **Crons:** 3 scheduled tasks on `lc-ops` (reaper `*/15`, presence 08:00, pg_dump 13:00 UTC); reaper verified at exact 15-min cadence w/ heartbeat rows in staging `health_signals`. **Backups:** prod role `lc_backup` (LOGIN+`pg_read_all_data`+`BYPASSRLS` — created cleanly; prod = PG 17.6), first dump 240 KB over IPv6 direct, **restore drill PASS (calls=225 / auth.users=5 exact match**, 22 tolerated ACL warnings). **Kiosk e2e walked by Kumar** (Home→Ringing→apology→auto-Home; video inert until P4) — **the 2026-06-21 kiosk-on-staging 401 gap is CLOSED**; his tap's leaked RINGING row was **auto-reaped to NO_ANSWER at the 10-min cutoff on the next `*/15` tick — the reaper backstop demonstrated live** (an earlier "not reaped" read raced the 04:00 tick by seconds; `ring_started_at` was set correctly all along). **Docs:** ops runbook (`docs/setup/2026-07-02-box-ops-runbook.md`, no placeholders) + **accounts/credentials inventory** (`docs/setup/2026-07-03-accounts-credentials-inventory.md` — register only, secrets live in Kumar's PM). **Smoke = 6/6 PASS** (item 2 = admin dashboard verified; agent/owner eyeball during soak; item 6 = alert policies API-verified, email only fires on real breach). **SOAK: box runs unattended to ~2026-07-10** — watch: Coolify task history gaps, staging `/admin/status`, DO alert emails, staging Supabase must NOT auto-pause (the `*/15` traffic is the test), first SCHEDULED 13:00 UTC dump lands 2026-07-03. **Post-soak checklist:** migration-plan Phase-1 DONE stamp · tag `plan-phase1-box-staging-complete` · revoke both `lc-claude` API tokens (DO + Coolify) · then **Phase 2 (RustDesk relay)** with a pre-phase snapshot.

**Addendum (2026-07-03 ~04:45 UTC, same session):** Kumar proposed closing out early — **soak-age check said no: the box was 3.5 h old, soak ~40 min** — the week-unattended gate stands (→ ~2026-07-10). Prepped the handoff instead: **`docs/handoffs/2026-07-03-phase2-relay-kickoff-handoff.md` (new START HERE)** — opens with the soak-verification checklist (reaper ≈96/day, nightly dumps, no Supabase auto-pause, front-door probes), then the Phase-2 relay runsheet (snapshot first · hbbs/hbbr · relay. DNS grey-cloud · ports 21115-21117 open, 21118/21119 closed · pin + PM-backup the server key · pilot PC + agent `--config` repoint · **India-side agent required in the P2P/relay smoke** · done-when = a real night through our relay) + Phase-1 build gotchas. **Token decision (Kumar): both `lc-claude` API tokens stay through the migration for debugging — revoke at Phase-5 close** (inventory §4 + plan + CLAUDE.md re-pointed). Cleanup: leftover `lc-restore-drill` container removed from the box; **43 untracked macOS `"* 2.*"` duplicate files** (all byte-identical to originals, verified per-file) deleted from the working tree.

**Addendum 2 (2026-07-03):** Kumar challenged the soak-then-P2 serialization → **corrected: Phase 2 starts immediately, concurrent with the soak** (the migration plan itself marks P2 "independent — do it early"; July-10 is the checkpoint to run the soak-verification checklist + stamp Phase-1 DONE, not a start gate; trade-off = two variables on one box, mitigated by the mandatory pre-phase2 snapshot + near-disjoint failure domains; pilot-PC repoint stays LAST inside P2). Handoff + CLAUDE.md + plan + memory all re-synced.

---

## 2026-07-03 (second session) — Phase 2 SERVER SIDE BUILT + VERIFIED (concurrent with the soak); Kumar's client runsheet pending

Resumed from the P2 kickoff handoff (autonomous session; Kumar's "continue building phase 2" = the go). House workflow compressed to spec→build in-session because the product scope was already locked (target spec §4 + migration plan P2 + handoff runsheet); the two "decide at build" items were decided and recorded. **Step 0 first: snapshot `pre-phase2-relay`** (19.41 GiB, completed 05:25 UTC, `doctl`-verified) — box changes only after it finished. **Build:** hbbs+hbbr **`rustdesk/rustdesk-server:1.1.15`** (pinned; latest release 2026-01-12) live on lc-box-1 as **plain docker compose at `/opt/rustdesk/`** — build decision D1: NOT a Coolify app (host networking makes Traefik/domains irrelevant + keeps the relay in a **disjoint failure domain from the soaking Coolify stack**); D2: `network_mode: host` per the official pattern (real client IPs → NAT hole-punch → P2P-the-norm; also keeps ufw authoritative, no Docker DNAT bypass); **D4: `-k _` on both** — server-side rejection of any client not presenting our public key (flag semantics **source-verified** in rendezvous_server.rs/relay_server.rs: `_` → required key = generated pubkey; mismatch → `LICENSE_MISMATCH`/relay-auth-fail). **Verified live:** both containers Up (`unless-stopped`, docker boot-enabled); hbbs+hbbr log the **same** `Key: oH2Lzh…3GY=` (keypair written by hbbs, read by hbbr via shared `./data`); `relay-servers=["relay.lobby-connect.com"]`; `ALWAYS_USE_RELAY=N`. **Firewalls:** 21115/tcp+21116/tcp/udp+21117/tcp on ufw AND DO fw `lc-box-fw`; **proven from outside** — TCP connects from the Mac, UDP 21116 probe packet-captured arriving on eth0 (through both layers), 21118/21119 (web client, locked closed) verified timing out despite listening. **Key discipline:** keypair copied to Mac `~/.ssh/lc_relay_id_ed25519{,.pub}` (0600) same-session; PM note = runsheet H2; public key recorded in runbook §12 (not a secret). **Build gotcha (source-verified, recorded):** hbbs DNS-resolves `-r` hostnames at startup (`test_if_valid_server`→`to_socket_addrs`) and **silently filters failures** → since `relay.` DNS doesn't exist yet, pinned via compose `extra_hosts` + box `/etc/hosts`; clients resolve public DNS at connect time. Also: the server image is **shell-less** (no `docker exec` debugging — logs only). **Docs:** spec `docs/specs/2026-07-03-phase2-rustdesk-relay-design.md` (D1–D8, sourced; rustdesk.com 403s fetchers → cited from the official docs source repo + server source) · plan+runsheet `docs/plans/2026-07-03-phase2-rustdesk-relay.md` (T1–T6 machine ✓, H1–H5 human) · runbook §12 (manage/upgrade/rotate/incident + client-config values) · credentials register (keypair row + 2 PM checklist items) · migration-plan P2 STATUS block · repo artifacts `ops/rustdesk/compose.yaml` + `ops/rustdesk/provision-hotel-pc.ps1` (client pinned 1.4.8, gh-verified; config-string placeholder filled at H3). **Remaining = human, in order: H1 `relay.` A-record (grey-cloud) → H2 PM keypair backup → H3 Kumar's client test + export config string → H4 India-side agent test (locked consequence of the region record) → H5 pilot-PC repoint at a scheduled daytime moment, LAST.** Done-when unchanged: **the pilot agent works a real night through our relay** → then tag `plan-phase2-relay-complete`. Soak untouched (checkpoint ~07-10 checklist now also eyeballs hbbs/hbbr). **START HERE next session: `docs/handoffs/2026-07-03-phase2-server-built-handoff.md`.**

**Addendum (same session, ~06:00→10:15 UTC): the ENTIRE client runsheet H1–H5 was completed live in this chat.** H1 DNS created by Kumar + dig/port-verified through the hostname · H2 keypair → PM · H3 Kumar's Mac registered (`139513354`; RustDesk installed via brew) + **export-config string → PM** (gotcha: Export Server Config writes to the CLIPBOARD, not a file) · **relabel discovery: `511505435` from Kumar's IP is THE PILOT HOTEL PC** (the pilot property shares his network/IP — consistent with the migration plan's "pilot is at Kumar's own property") — he repointed it same-day with on-site hands, so H5's hotel half happened early and safely · H4 run by the **India admin** (`250885235`, Airtel) against the hotel PC = the REAL production pair: three hbbr sessions incl. ~12 min of real work, verdict **"definite speed improvement — snappy — almost as if controlling his own PC"** on the relayed WORST case · H5 completed when **pilot agent Dilnoza** (`428868591`, India mobile/CGNAT — registration IP-hopped within 16 s) swapped and connected: **her session + Kumar's went DIRECT P2P (zero hbbr trace) — relay proven fallback-only, exactly the design goal.** 4 peers, **0 auth failures ever**. Extras this session: **enrollment-token self-registering provisioning** captured in `docs/v2-backlog.md` (answering Kumar's "fire-and-forget for hotels?" — today = one script + 2 values to PM; Phase 3 = paste into `property_remote_access` CRUD; endgame = script self-registers via tokenized link) · client **"Enable IPv6 P2P" toggle recorded as a post-gate experiment** in runbook §12 (left OFF during cutover — no new variables; promising for India↔hotel direct given India's v6 adoption) · public-repo hygiene: the full public key + exported config string are deliberately kept OUT of the repo (under `-k _` they double as the relay's access token) — PM + box + Mac only, truncated fingerprint in docs. **Remaining: ONLY the done-when — Dilnoza works one clean full night → stamp Phase-2 DONE + tag `plan-phase2-relay-complete` (checklist in the new handoff). NEXT SESSION = Phase 3 kickoff (Gate 3.0 tile prototype FIRST): START HERE `docs/handoffs/2026-07-03-phase3-kickoff-handoff.md`.**

---

## 2026-07-03→04 (session) — Gate 3.0 PASSED both OSes → brainstorm pivot (push-first + call-scoped tile) → P3 SPEC WRITTEN, at Kumar's gate

Resumed from the P3 kickoff handoff. **Gate 3.0 (deskphone-tile prototype)** built same-day on `phase3-gate-tile-prototype`: role-gated `/duty-tile-prototype` (AGENT+ADMIN, outside the app shells) — "Go on duty" primes ring audio (session-22 pattern) + opens a Document-PiP tile; self-scheduled test rings (15s/60s/6min); a 1s parent-tab tick probe with OK/DEGRADED/THROTTLED shown live in the tile; resize readout; copy-paste report; TDD'd `lib/duty-tile/tick-stats`. **Sequencing per Kumar ("not straight to prod"): staging first** (`staging` branch fast-forwarded → Coolify box deploy), he judged there, then HE took it to prod via PR #26 (merge `ba1b828`; direct Claude pushes to `main` are permission-blocked — PR path is the precedent). Ring recolored mint-on-navy `e2afa10` after Kumar's pushback (note: he said "we did away with blaze" — factually CORAL was retired, blaze is still the attention token; settle the stance before the P3 cards ship). Report-quality tweaks `7fddcad` (visibility-transition logging + silent-ring detection). **PASS EVIDENCE (pasted reports): Mac 2026-07-03 ~23:52 CDT + WINDOWS PC 2026-07-04 ~00:48 CDT** — max tick gap ≤1.1s with the browser minimized; all rings 0.0s late incl. the 360s intensive-throttling case; answered from the tile over **fullscreen RustDesk + SynXis during a real guest check-in**; audio never blocked. Desktop-shell escalation retired; Dilnoza's run demoted to informational.

**Phase-3 brainstorm (visual companion + terminal, 2026-07-04):** pilot reality surfaced — **the hotel phone line is deliberately NOT transferred yet** (kiosk-first training, "one thing at a time"; P3 lands before phone volume) · RustDesk-all-shift is a single-property training artifact (per-need Connect at ~5 properties) · duty = **local** ("Go on duty" slims to audio-prime + push permission; fleet "on duty" DERIVED from existing presence; **new "End shift" button** → immediate service-role OFFLINE; NO shift schedule — "who is busy not who hasnt showed up" — v2 seam) · dashboard-first answering (**the ringing property's card expands + rings in place**, retiring the static right-rail incoming placements; **today's full-screen in-call overlays UNTOUCHED** — "lets not mess with todays working full screen in-call set up") · **THE PIVOT (Kumar): the all-shift tile "solves two problems at once" → separated.** (P1) always-rings = **Web-Push-FIRST signal path with an AUDIBLE contract** ("as long as they can hear it ring, like with twilio… answer from the dashboard"; SW wake → OS toast (best-effort, click-to-focus) + postMessage → the buried tab plays the loud primed ringtone; answer-from-toast NOT required). (P2) **the tile is CALL-SCOPED** — opens on the Answer gesture (DocPiP needs one), guest-video-FIRST (eye contact with the kiosk guest while working RustDesk), compact controls + Room#/note, second-ring banner, dies at hang-up. Hold correction (Kumar): **video-hold wiring = Phase 4/LiveKit, NOT Agora plumbing** — P3 ships hold UI + AUDIO (Twilio Conference seam, 6c precedent) only.

**SPEC WRITTEN + COMMITTED `72b7003` on branch `phase3-workspace` (pushed, NOT merged): `docs/specs/2026-07-04-phase3-workspace-design.md`** — decision log D1–D11 · card anatomy + admin pod-grouped fleet · 3-layer alerting stack + subscription lifecycle · call-tile faces + reopen affordance (the "Back to tab" accidental-close lesson) · migrations **0019 `property_remote_access`** (service-role-only reads, audited credential API via `requireApiActor`, `rustdesk://` deep link, pre-warm at Answer, enrollment-token v2 seam) + **0020 `push_subscriptions`** · conference-seam hold · **Gate 3.1 (push-ring spike) = FIRST build task** (pass = loud ring, browser minimized behind fullscreen RustDesk, both machines; fail → all-shift tile is the recorded Plan B) · build order: gate → cards → push → tile → remote-access → hold-audio (staging-first, hold last with 911-grade review). Same commit: migration-plan Phase-3 bullets + done-when amended, Gate 3.0 stamped PASSED there, target-spec §5 all-shift framing marked superseded.

**NEXT SESSION: Kumar's spec verdict → apply edits → superpowers:writing-plans → subagent-driven build. START HERE: `docs/handoffs/2026-07-04-phase3-spec-gate-handoff.md`** (also carries the Phase-2 real-night close-out checklist — ask Kumar about Dilnoza's night — and the July-10 soak checklist). Phase-1 soak + Phase-2 gate untouched all session.

---

## 2026-07-04 (second session) — P3 spec+plan GATED (hold deferred) → subagent-driven build: Phases A+B CODE-COMPLETE, at Kumar's two staging gates

Resumed from the spec-gate handoff. **Spec gate:** Kumar approved with one edit — **D12: Connect from inside a live call** (both overlays + tile, pre-warmed credential fetch) folded in `c3eda73`; blaze/coral confusion settled (blaze stays, sparing, non-emergency red replacement; red = 911 only). Phase-2 real night: NOT yet run. **Plan written** via writing-plans (6 parallel Explore agents mapped tile/softphone/dashboards/API/6c/kiosk seams first): `docs/plans/2026-07-04-phase3-workspace.md`, originally 25 tasks/6 phases with a fully-designed audio-hold choreography. **Plan gate (Kumar): "I am not understanding the hold function implementation completely… push it to when we have more than one property" → HOLD DEFERRED ENTIRELY** (`35f0d9e`): 21 tasks/5 phases; hold's 6c design RECORDED in spec §3.6 (agent-leg endConferenceOnExit=true so a crash can't orphan a guest in hold music; 911-after-hold = REST-redirect GUEST first — dial-result never re-fires once conferenced); with hold out, Phase 3 touches NOTHING in dial-result/911. Migrations renumbered to ship order (0019 push_subscriptions / 0020 property_remote_access; 0021 hold dropped).

**Build (subagent-driven: fresh implementer per task + two-stage review + fix agents): Tasks 1–9 ALL CLOSED.** Phase A: web-push@3.6.7 + VAPID reader (`3e34702`; keys generated, LIVE in Vercel prod + .env.local; Kumar loaded Coolify staging + redeployed) · SW skeleton + spike panel + delayed-send route (`553d274`+`c57e243`+`43590f3`). Phase B: additive propertyId TwiML Param (`1378b25`, dedicated BYTE REVIEW = dial byte-identical across all routing branches) · pods helpers (`b7358da`+ghost-agent placeholder `33d1e3e`) · CallSurfaceProvider (`b3fba25`) · softphone/video-host publishers + banner→hook extraction, verbatim-verified (`fa48f76`+`e768227`) · PropertyCard + agent pod grid (`2be067b`) + unmatched-ring fallback (`fd36bb2`) · admin FleetBoard replaces the ops table, covering-gated Answer, AvailabilityToggle on cards, IncomingCallToast deleted (`d966070`). 545 node + 67 jsdom tests; root lint/typecheck/build/check:routes green; staging fast-forwarded to `d966070`.

**The reviews caught three real defects pre-merge:** (1) `getNotifications({tag:""})` matches ALL notifications per WHATWG (reviewer corrected its own prior-knowledge claim against the spec) → callId-guarded SW; (2) the plan's own Task-7 wiring would INFINITE-LOOP (publisher effects depending on `surface` while registration mutates it) → stable-dispatcher dep rule + loop-guard test (`c955d8d`); (3) root-vs-package lint scope gap hid SW `self` no-undef from CI (`1e46bbf`). Also: Decline button retired with the incoming block (spec'd: cards = Answer+Connect only — flag at smoke); "a ring must never be audible but unanswerable" fallback card added.

**AWAITING KUMAR (after sleep): Gate 3.1 push drill + Phase-B ring-on-card smoke, both on staging** (checklists in the handoff). Both pass → PR to main (A+B slice, #26 precedent) → prod smoke → Phase C (Task 11 = migration 0019 + push send + subscription route). Gate fail → Plan B = all-shift tile, re-plan Phase C with Kumar. **START HERE: `docs/handoffs/2026-07-04-phase3-build-gates-handoff.md`** (also carries the Phase-2 close-out + July-10 soak checklists).
