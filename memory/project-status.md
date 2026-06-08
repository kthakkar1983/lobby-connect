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
- **Color:** ink `#2C425C` · coral `#F0795B` base / `#E05A39` deep-for-fills (AA) · mint live `#06D6A0` · emergency `#C81E1E` · cool neutrals (`#F6F8FA` page / `#EAEEF2` muted fill / `#E1E7EC` border / `#64748B` muted text). (Started from Kumar's "B+" trio; vermilion → coral; kept ink+mint.)
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
