# Handoff — Phase 3 · Phase C DONE (on staging, NOT merged to prod) → next = Phase 4 (LiveKit) — START HERE

**Written:** 2026-07-05 (end of the Phase-C build + staging-decouple session) · **Supersedes:** `2026-07-05-phase3-phaseD-kickoff-handoff.md` (Phase-D-next is DEFERRED; see the decision below) · **Branch:** `phase3-workspace` @ `1270c2e`, mirrored to `staging` (box auto-deploys). **NOT merged to `main`/prod.**

## TL;DR / the decision (Kumar, 2026-07-05)
Phase C is **code-complete, two-stage-reviewed per task + whole-branch integration-reviewed (SHIP), full gate green, and deployed to staging.** On staging Kumar confirmed the **duty controls + push path work**, but the **kiosk video call ends in "sorry, no one is available"** because **Agora doesn't function on the box** (cert declined; being replaced). Kumar: *"I really don't want to mess anything up in prod... move on to Phase 4 in a new chat."* So:
- **DO NOT merge PR #29 to prod / DO NOT apply 0019 to prod / DO NOT prod-smoke yet** — deliberately avoiding pilot risk until the stack is testable end-to-end on staging.
- **NEXT = Phase 4 of the stack consolidation: self-hosted LiveKit video, replacing Agora** (`docs/plans/2026-07-01-stack-consolidation-migration.md` Phase 4). Doing LiveKit before the remaining Phase-3 sub-phases is intentional: Phase 3 **D (call tile)** is *guest-video-first*, so building it against Agora then redoing it for LiveKit would be waste — build it on LiveKit.
- **Deferred (not lost):** Phase 3 **D (call tile, Tasks 16-17)** + **E (remote access + Connect, Tasks 18-20, migration 0020)** — resume after LiveKit. ⚠ Confirm this sequencing at the next chat's start (Phase-4-then-D/E vs. something else).

## Phase C — what shipped (branch `phase3-workspace`, commits `ccc8813`→`1270c2e`)
Web Push productionized + Go-on-duty / End-shift duty controls. All subagent-driven (fresh implementer + spec + quality review each; final integration review = SHIP).
- **Task 11** (`ccc8813`/`e39cd38`/`83ab1a0`) — migration `0019_push_subscriptions` (owner-only RLS; inserts service-role only) + `lib/push/{targets,send}.ts` (`sendCallPush` never-throws + prunes 404/410) + `POST/DELETE /api/push/subscription` + `PUSH_TTL_SECONDS`.
- **Task 12** (`f002944`/`77bed76`) — `lib/push/client.ts` + SW-message→`tick()` wiring (converges on the same `/api/calls/incoming-video` refetch; `tick` `useCallback([])`, `waiting` memoized = loop-safe) + `focus-home`→navigate-home.
- **Task 13** (`f79181e`) — `sendCallPush` in the 4 VIDEO routes (`call-cleared` reuses the same `calls.id` so the SW closes the right notification); **Gate-3.1 spike DELETED**; audio NOT push-wired (Twilio's own ring is the audio layer).
- **Task 14** (`4c28776`/`e6c04ac`) — `lib/video/prime.ts` + `DutyControls` (Go-on-duty = prime ring + `armPush`).
- **Task 15** (`2fab4ec`) — `POST /api/presence/end-shift` (service-role OFFLINE) + heartbeat disarm + End-shift button + `dutyLabel` fleet.
- **End shift silences VIDEO too** (`8c2f6b4` + fail-open tests `eeac5d4`) — Kumar: "end shift means end shift, audio and video." + **AWAY parity** (`4b6bd91`) — "not accepting calls" also silences video. Shared deny-list `isVideoSilencedStatus(status) = OFFLINE || AWAY` on RAW status (NOT effectivePresence — a minimized on-shift tab stays wakeable), gating both the incoming-video poll and the push target list. **Fail-open** on a status-read error (a DB blip never silences a live agent). Audio/dial untouched.
- **DutyControls decoupled from the Twilio line** (`f6e42a1`) — see the staging section; it's why duty controls work on staging with no Twilio.

**⚠ ARCHITECTURE (deliberate, superseded the plan):** `DutyControls` is PRESENTATIONAL + PROPS-DRIVEN, rendered BY the softphone — NOT the plan's `registerDutyHandlers`/`CallSurfaceProvider` state-lift → zero render-loop risk (the dep-hygiene trap that OOM'd this project twice). Kumar would have preferred the plan's original unified-duty-card idea and dislikes the softphone-as-a-tile + empty right-column — **the dashboard/right-column layout rework is DEFERRED to post-build + off-Vercel** (see [[dashboard-layout-rework-deferred]] + this doc's carry-forward).

**Full branch gate GREEN:** typecheck · portal **node 580 + jsdom 90** · lint (3 pkgs) · check:routes · `gen:types:check` "DB types in sync" · kiosk 27 · portal build. `0019` applied to LOCAL + STAGING only (**NOT prod**). VAPID keys live in Vercel prod + Coolify staging.

## 🔬 STAGING TESTING STATUS + DEBUG GUIDE (the key notes Kumar asked for)
Staging = the DO box: `staging.lobby-connect.com` (portal) + `staging-kiosk.lobby-connect.com` (kiosk), behind basic auth (creds in the credentials register). Everything below is what to expect + how to tell a real bug from a known-gap when the stack is finally end-to-end testable (post-LiveKit).

**✅ WORKS on staging today (Phase C, Twilio-independent):**
- **Go on duty / End shift** render + work even though the box has **no Twilio** — because `DutyControls` was decoupled (`f6e42a1`) from the phone-line state (it renders whenever `phase !== "in-call"`, not just the line-healthy idle block). Rationale: arming Web Push is a browser subscription and going on/off duty is a presence write — neither touches Twilio.
- **Push arming** (Go on duty → OS permission prompt → subscription upserted), **card ring** (realtime/poll), **OS notification + click→home**, **End shift → admin fleet "Off duty"**, **heartbeat disarm/resume**.
- **Video off-shift / AWAY gating** (targets + poll side) — the DB gating logic runs.

**❌ BLOCKED on staging today (known, EXPECTED — not Phase-C bugs):**
1. **Audio softphone line → "Phone line disconnected — reload to reconnect."** The box has no Twilio, so `/api/twilio/token` fails (missing creds → 500, or the staging user has no `twilio_identity` → 403), `connect()` → `phase='error'`. Expected. (Duty controls still show, by design — see above.)
2. **Kiosk VIDEO Answer→connect → "sorry, no one is available" (the kiosk apology).** **Agora is non-functional on the box** (`AGORA_APP_CERTIFICATE` declined by Kumar — it's being replaced by LiveKit in Phase 4). The video call cannot complete, so it falls through to the apology. **This is the observed symptom Kumar hit, and it's expected until LiveKit lands.** NOTE: this session did NOT isolate *where* it fails (kiosk can't get an Agora token to publish guest video, vs. the agent's card rings but the answer→Agora-join fails) — both are gated on the same missing Agora config, so it reads the same until the video stack works.

**🔍 When you CAN finally run end-to-end tests (after Phase 4 / LiveKit): to distinguish a real bug from the old Agora gap, check in this order:**
1. **Targeting/setup on staging** — is the test agent actually **assigned** to the kiosk's property (`property_assignments`, `effective_until IS NULL`) AND did they go **AVAILABLE** (Go on duty)? If not, the incoming-video poll/push won't target them → the card never rings → apology, which looks like a video failure but is a data/setup issue. (Staging DB ref `cgtvqjxhbojztzumshca` — query `property_assignments`, `admin_call_availability`, `profiles.status`.)
2. **Card ring** — with the tab open, does the property card ring (realtime/poll)? If yes, targeting is fine.
3. **Push wake** — minimized/backgrounded, does the OS notification fire? (Push is armed via Go-on-duty; VAPID keys are on Coolify staging.)
4. **Video connect leg** — only THEN is a connect failure a real video/LiveKit bug rather than the Agora gap.
Also: staging migrations lag prod — if anything behaves oddly, check `supabase_migrations.schema_migrations` on the staging DB (0018 once sat missing a week and silently killed realtime).

## Pending / deferred (nothing lost)
- **PROD, at eventual merge:** apply `0019` to prod (ref `ztunzdpmazwwwkxcpyfp`) via MCP BEFORE merging PR #29 (the 0018 lesson) → merge → prod re-smoke (full video connect + audio). **Deliberately not done yet** (Kumar: don't risk prod until end-to-end testable).
- **AWAY-toggle decouple (optional):** the "not accepting calls" toggle is still phone-line-gated, so it's hidden in the error state on staging → the *AWAY-silences-video* check specifically is a prod verification today. One-line to decouple like DutyControls if wanted.
- **Phase 3 D (call tile, Tasks 16-17)** + **E (remote access + Connect, Tasks 18-20, migration 0020)** — deferred behind LiveKit.
- **Dashboard/softphone-tile layout rework** — deferred to post-build + off-Vercel ([[dashboard-layout-rework-deferred]]).
- **ChunkLoadError→reload guard** (Phase-B smoke finding) · **disabled End-shift `title`-only a11y** (tiny) · temp guest-audio diagnostics on `main` · GitHub secret-scan alert · pilot phone line not transferred.
- **Phase 1 soak** ~2026-07-10 checkpoint → tag `plan-phase1-box-staging-complete`. **Phase 2 relay** waiting on Dilnoza's clean night → tag `plan-phase2-relay-complete`.

## Build gotchas / discipline (carried — load-bearing)
1. **⚠ DEP-HYGIENE = the dominant risk.** Effects depend on identity-stable values (stable dispatchers, never the whole `surface`); a hook returning an array that feeds a consumer's effect MUST `useMemo` it. Phase D's tile must keep this discipline.
2. **`getNotifications({tag:""})` matches ALL** (WHATWG) — the SW clear path is callId-guarded; senders must send the same callId on clear as on incoming.
3. **`gen:types` needs the pinned Supabase CLI 2.101.0** (homebrew PATH binary; `npx supabase` pulls 2.109 — do NOT use it). Local stack up; `supabase migration up --local` then `pnpm gen:types`; CI `gen:types:check` fails on drift.
4. **Claude cannot push `main` (PR; Kumar merges)** · pushing `staging`/`phase3-workspace` IS allowed · presence/`status` writes stay service-role (0012 guard) · Phase-D DocPiP `requestWindow()` synchronously inside the user gesture · Coolify Traefik labels verbatim, no `$$`.
5. **Subagent-driven with two-stage reviews earns its keep.** (This session an implementer's API dropped mid-task; recovery = verify the diff + run the gate as controller before committing. Reviews caught real issues throughout.)
6. Commit trailer this session: `Co-Authored-By: Claude Opus 4.8`.

## Register reminder
Real dialogue, plain English; decide when one answer is sane, converse on genuine forks. Build for the future, not just the pilot. Sourcing discipline on every claim. Systematic debugging before any fix (root cause first). Nights run on proven infrastructure. Subagent-driven build with two-stage reviews. **Surface UX/layout consequences when deviating from a plan's design for internal reasons** (the DutyControls lesson).
