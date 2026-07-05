# Handoff — Phase 3: Phase C CODE-COMPLETE + reviewed + gated → run the Phase-C smoke, then build Phase D — START HERE

**Written:** 2026-07-05 (end of the Phase-C build session) · **Supersedes:** `2026-07-05-phase3-phaseC-kickoff-handoff.md` · **Branch:** `phase3-workspace` (NOT merged to `main` yet). **Continue on `phase3-workspace`.**

## Where things stand

**Phase C (Web Push productionized + Go-on-duty / End-shift duty controls) is CODE-COMPLETE, two-stage-reviewed per task, whole-branch integration-reviewed (= SHIP), and the full branch gate is GREEN.** Built subagent-driven (fresh implementer + spec-compliance + code-quality review per task). Commits `ccc8813`→`2fab4ec`.

**What shipped on the branch (plan Tasks 11–15):**
1. **Task 11 (`ccc8813`/`e39cd38`/`83ab1a0`)** — migration `0019_push_subscriptions` (owner-only RLS select/delete; inserts service-role only) + regenerated types; `lib/push/targets.ts` (`resolveTargetUserIds` — send-side mirror of the incoming-video poll scope: assigned primary agent + `accepting_calls` admins, NOT presence-gated) + `lib/push/send.ts` (`sendCallPush` — never throws, prunes 404/410 dead endpoints, Sentry on other failures) + `POST/DELETE /api/push/subscription` (session-authed, actor-sourced ids) + `PUSH_TTL_SECONDS` in `@lc/shared/protocol`.
2. **Task 12 (`f002944`/`77bed76`)** — `lib/push/client.ts` (`armPush`/`syncPushSubscription`/`pushArmed`); the SW-message→`tick()` wiring in `use-incoming-video-calls.ts` (converges on the SAME `tick()` as realtime+poll; `tick` lifted to `useCallback([])`, `waiting` still `useMemo`'d — loop-safe); `syncPushSubscription()` on dashboard mount + the `focus-home` SW-message → `router.push(home)` in `dashboard-workspace.tsx`. `public/push-sw.js` was already production-shaped (Phase A) — unchanged.
3. **Task 13 (`f79181e`)** — `sendCallPush` wired into the 4 VIDEO routes (`kiosk/call-started` → `incoming-call`; `answer-video`/`end-video`/`kiosk/call-ended` → `call-cleared`, same `calls.id` so the SW closes the right notification). **The Gate-3.1 spike is DELETED** (`/api/push-spike`, `push-spike-panel.tsx`, the prototype mount). **Audio is intentionally NOT push-wired** — Twilio's own background-proof audio ring is the audio layer.
4. **Task 14 (`4c28776`/`e6c04ac`)** — `lib/video/prime.ts` (shared `primeRingtone` autoplay-unlock) + `components/dashboard/duty-controls.tsx` ("Go on duty" = prime + `armPush`). **Architecture decision (deliberate, recorded): `DutyControls` is PRESENTATIONAL, rendered BY the softphone, props-driven — NOT the plan's `registerDutyHandlers`/`CallSurfaceProvider` mechanism.** This keeps all duty state in the softphone → zero state-lift → zero render-loop risk (the dep-hygiene trap that OOM'd this project twice). The Accepting toggle + pendingNotes stay in the softphone card.
5. **Task 15 (`2fab4ec`)** — `POST /api/presence/end-shift` (service-role OFFLINE write, actor-scoped, 0012-guard-compliant); softphone `onDuty` state + `onDutyRef` disarms the 20s heartbeat while off-shift; `endShift`/`resumeDuty` passed to DutyControls as props (again NO provider change). End-shift button is NEUTRAL (not red — red is 911/destructive only), disabled during a ring. `DutyControls` fully-active state gates on `armed && onDuty` (so a post-End-shift `armed=true, onDuty=false` shows "Off duty / Go on duty to resume", never a stale "On duty"). Fleet "Off duty" label already wired via `dutyLabel` — verified.

**Full branch gate GREEN (run at close):** `pnpm -F @lc/portal typecheck` · portal tests **node 571 + jsdom 89 = 660** · `pnpm lint` (3 pkgs) · `pnpm check:routes` · **`pnpm gen:types:check` = "DB types in sync"** (CI drift check passes) · kiosk 27 · `pnpm -F @lc/portal build`. Migration `0019` is applied to LOCAL + STAGING. VAPID keys live in Vercel prod + Coolify staging (from Gate 3.1).

## NEXT SESSION, in order

### 1. Run the Phase-C smoke (HUMAN — Kumar) — staging first, then prod at merge
Fresh browser → dashboard → **Go on duty** → accept the OS notification permission → then, with the browser MINIMIZED behind fullscreen RustDesk:
- **Kiosk VIDEO call** → expect a **loud ring + OS notification** (naming the property) even minimized; **click the notification** → the tab focuses + navigates home → the ringing **property card** is on screen → **Answer** connects to the kiosk. On hang-up, the OS notification clears (the `call-cleared` push).
- **End shift** → the admin **fleet** shows that agent "Off duty" (on the next refetch); the softphone heartbeat stops (no more presence beats). **Go on duty** again → re-arms WITHOUT a second permission prompt (subscription persists).
- The staging deploy is on the `staging` branch (box auto-deploys, behind basic auth). Staging video-connect still can't fully test the Agora leg (AGORA_APP_CERTIFICATE declined on the box — LiveKit replaces it in Phase 4); the **card ringing + push + notification-click-home** ARE testable on staging. Full Answer→connect is a prod smoke.
- **At merge:** apply migration `0019` to **PROD** (ref `ztunzdpmazwwwkxcpyfp`) via MCP **before** the PR merges (the 0018 lesson — staging is back-applied by hand, prod at merge). Then Kumar merges the PR; re-smoke on prod.

### 2. ⚠ One design confirm for Kumar (surfaced by the integration review — NOT a code defect)
**End shift silences AUDIO dialing (OFFLINE → `isReachableForDial` false) but NOT VIDEO push/ring.** Video targeting (`resolveTargetUserIds` + the incoming-video poll) is **assignment-based, not presence-gated** — a deliberate v1.0.1 decision ("polling proves liveness"). So an agent who ended their shift still gets a VIDEO OS-push (and their card still rings if the tab is open) for their assigned property, while a covering admin is expected to actually take it. **Decide:** (a) leave as-is (waking an off-home agent is arguably the whole point of push), or (b) also presence-gate video targeting so End-shift fully silences that agent. Option (b) is a small follow-up (gate `resolveTargetUserIds`/`resolveTargetPropertyIds` on `effectivePresence`), out of Phase-C scope. Recommendation: confirm the intent before Phase D; likely leave-as-is for the pilot.

### 3. Then build PHASE D — the call tile (plan Tasks 16–17, spec D4/D2)
The call-scoped Document-PiP "deskphone" tile: opens on Answer (synchronous `requestWindow()` inside the user gesture — Task 16), guest-video-first faces + overlay integration (Task 17), dies at hang-up. Gate 3.0 (the tile prototype) already PASSED on both machines. After D: Phase E (remote access + Connect, Tasks 18–20 — migration `0020_property_remote_access`), then close-out (Task 21).

## Build gotchas / discipline (carried — load-bearing)
1. **⚠ DEP-HYGIENE remains the dominant risk.** Phase C avoided it by keeping DutyControls props-driven (no state-lift) and lifting the video hook's `tick` to `useCallback([])` while keeping `waiting` memoized. For Phase D's tile: any value a tile effect depends on must be identity-stable; publisher effects use STABLE dispatchers, never the whole `surface`.
2. **`getNotifications({tag:""})` matches ALL** (WHATWG) — the SW's clear path is callId-guarded; the production sender already sends the same callId on clear as on incoming. Keep that invariant for any new push.
3. **Staging migrations lag prod** — back-apply via MCP (staging ref `cgtvqjxhbojztzumshca`) whenever prod ships one; **prod 0019 at merge** (ref `ztunzdpmazwwwkxcpyfp`).
4. **`gen:types` needs the pinned Supabase CLI 2.101.0** (homebrew PATH binary; `npx supabase` pulls 2.109 — do NOT use it for gen:types). Local stack is up; `supabase migration up --local` then `pnpm gen:types`, commit the regenerated file; CI's `gen:types:check` fails on drift.
5. Still-live priors: **Claude cannot push `main` (PR; Kumar merges)** · pushing `staging`/`phase3-workspace` IS allowed · presence/`last_seen_at`/`status` writes stay service-role (0012 guard) · DocPiP `requestWindow()` synchronously inside the user gesture (Phase D, Task 16) · Coolify Traefik labels verbatim, no `$$`.
6. **Subagent-driven build with two-stage reviews earns its keep** — this session the reviews caught/confirmed: the DELETE-swallows-error observability gap (fixed), the stale dep-comment on the loop-prone hook (fixed), the exact-payload test rigor on all 4 push routes, and the `armed && onDuty` gate. Fresh implementer per task + spec-then-quality review + a final integration review.
7. **Commit trailer this session: `Co-Authored-By: Claude Opus 4.8`** (harness directive). Match the active session's harness.

## Carry-forward (non-blocking)
- **Disabled End-shift button a11y (tiny):** the "Finish the call first" hint is a `title` only (not surfaced to AT). The button is disabled only during the brief "incoming" ring, so low-value; a visible sibling line (like the "Off duty"/blocked lines) would be the clean upgrade if ever touched.
- **ChunkLoadError→reload guard** (from the Phase-B video-answer smoke) — a durable reload-guard so a mid-shift deploy can't throw an agent's next lazy-loaded chunk to `global-error`. Self-heals today; still real for an all-shift-open tab.
- **Phase 2 (RustDesk relay):** waiting only on Dilnoza's first clean full night → close-out (tag `plan-phase2-relay-complete`).
- **Phase 1 soak:** ~2026-07-10 checkpoint → close Phase 1 (tag `plan-phase1-box-staging-complete`).
- Temp guest-audio diagnostics still on `main` · GitHub secret-scanning alert still open · pilot phone line not yet transferred.

## Register reminder
Real dialogue, plain English, no pick-one menus — decide when one answer is sane; converse on genuine forks (the off-shift-video-push question above IS a genuine fork — surface it, don't silently decide). Build for the future, not just the pilot. Sourcing discipline on every number/claim. Systematic debugging before any fix. Nights run on proven infrastructure. Subagent-driven build with two-stage reviews.
