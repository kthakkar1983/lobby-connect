# Handoff — Outbound Video Calls: BUILD COMPLETE + SHIP-gated, smoke pending (2026-07-15)

**START HERE.** The 18-task plan is **fully built** on branch `outbound-video-calls` (subagent-driven, per-task two-stage reviews + a final **opus whole-branch review = SHIP**). **Not merged, not pushed.** The only remaining gate is **Task 18 — the staging + real-iPad smoke** (a human gate; can't be automated). After smoke passes → apply prod migrations 0022/0023 → merge to `main` (Coolify auto-deploys prod). Plan: [`docs/plans/2026-07-15-outbound-video-calls.md`](../plans/2026-07-15-outbound-video-calls.md) · Spec: [`docs/specs/2026-07-15-outbound-video-calls-design.md`](../specs/2026-07-15-outbound-video-calls-design.md).

## What shipped (branch `outbound-video-calls`, HEAD `1206b66`, 18 commits over `main`)

Agent-initiated **OUTBOUND video calls** to a lobby kiosk (call-back flow) + **kiosk liveness**, reuse-and-reverse on the existing LiveKit stack. Also **fixes tracked bug `task_71d65b0a`** (presence not reset after a video call).

**End-to-end flow (all built + whole-branch-verified):** agent clicks **"Kiosk"** on a property card *or* the **10s "Call back"** shortcut → `CallSurfaceProvider.startOutboundVideo` → `POST /api/calls/start-outbound-video` (creates OUTBOUND/RINGING VIDEO row `call_<uuid>` + `handled_by`, sets agent ON_CALL) → agent sees **"Calling…"** in the video surface → kiosk (idle) polls `GET /api/kiosk/incoming-call` (3s) → **"The front desk is calling — Answer"** → tap Answer → `POST /api/kiosk/answer-call` (RINGING→IN_PROGRESS, preserves `handled_by`) → both join the **same** LiveKit room → connected (captions/chat/RustDesk all ride along). End → state-guarded finalize + **presence reset ON_CALL→AVAILABLE**. Outbound `NO_ANSWER` renders **"No answer"** (not "Missed"). Liveness → **mint/muted card dot** + Kiosk-button greying + **admin status tile**. Terminal drop → kiosk **10s tap lockout**; agent-not-joined → kiosk **12s watchdog**.

**Migrations (additive, blue-green-safe):** `0022_calls_direction.sql` (`calls.direction` text default INBOUND) · `0023_kiosks_liveness.sql` (`kiosks` table, operator-scoped SELECT RLS, service-role writes, `+ operator_id` index). Types regenerated + overlay narrowed (`CallDirection`); `gen:types:check` green.

**Commits (task → sha):** 3c0057f (T1 db) · e75fae0 (T2 protocol) · 7c21df6 (T3 isKioskOnline) · d170c7b (T4 direction labels) · 16f4482 (T5 start-outbound-video + inbound-feed exclusion) · 7daa0fe (T6 incoming-call poll + liveness) · 1e9e62b (T7 answer-call + claimOutboundByKiosk) · e7b13a9 (T8 presence reset + reaper — task_71d65b0a) · 1e824db (T9 reducer) · 04084cf (T10 kiosk Answer flow) · cc6505b (T10 fix: answer watchdog) · d6f1503 (T11 drop lockout) · fccad70 (T12 originate action + host mount) · b1f24b7 (T13 video-call "Calling…" phase) · 30764e3 (T14 Kiosk button + dot) · 33f1bb3 (T15 Call-back shortcut) · 7dc3ec6 (T16 admin status tile) · 1206b66 (T17 thread direction into views).

## Status: green

Full CI-equivalent gate (run by the whole-branch reviewer): **1183 tests** (shared 52 · kiosk 64 · portal 1067) + typecheck (3) + build (portal+kiosk) + lint (3) + `check:routes` + `gen:types:check` — **all pass**. Blue-green invariants confirmed (additive-only, `agora_channel_name` untouched). `analysis-and-audit-2026_07_11/` never committed.

## Task 18 — the remaining gate (staging + REAL iPad smoke)

Deploy the branch to staging (apply 0022/0023 to staging Supabase `cgtvqjxhbojztzumshca` via MCP first), then walk on a **real iPad kiosk** (Mac-Chrome is a pessimistic proxy — don't judge video there):

1. **Happy path:** agent on duty → card shows **mint** kiosk dot → click **Kiosk** → agent "Calling [hotel]…" → iPad flips to "The front desk is calling — Answer" (~3s) → tap Answer → both connected → **captions + in-call chat + RustDesk Connect all work** → hang up → **agent presence returns to AVAILABLE** (not stuck ON_CALL).
2. **Glare:** guest taps the kiosk during a live outbound call → surfaces **Answer**, not an error. Second outbound to same property → **409 "busy."**
3. **30s no-answer:** click Kiosk, leave iPad idle → 30s → agent "No answer"; owner call history shows **"No answer" (neutral), NOT "Missed" (blaze)**, and it does **not** appear under the **Missed filter** (click the filter to confirm the query exclusion — from the T17 quality review).
4. **Terminal-drop lockout:** mid-connected-call kill the iPad network → iPad returns Home "Reconnecting you to the front desk — one moment", tap disabled ~10s; fire a **Call back** in that window → iPad flips straight to Answer.
5. **Answer watchdog (cold first call):** answer late in the ring window on a cold start; if the agent's side already tore down, the iPad should recover to apology→home within ~12s, not hang on "connecting".
6. **Liveness offline:** sleep the iPad → within ~90s the card dot goes **muted** + Kiosk button greys "Offline"; admin status **Kiosks** tile flips to **blaze** with a reduced count.
7. **Presence regression:** run a normal **inbound** guest call → answer → hang up → confirm the agent is no longer stuck ON_CALL (`task_71d65b0a`).
8. **Handler-name (verify-live, from T17 review):** open an outbound-initiated NO_ANSWER row in owner/admin call history → confirm it shows the **initiating agent's name** (the code says it should — `handled_by` is set at insert; the ternary is presence-based). If it reads "Unanswered," that's an easy fix.
9. **Video quality:** hardware-H.264 on the real iPad (`packages/shared/src/video.ts` single-layer H.264/1080p) — the night-1 quality gate.

## Deployment sequencing (do NOT casual-merge)

Merging to `main` makes **Coolify auto-deploy prod** — and the prod code will reference `calls.direction` + the `kiosks` table. So: **apply 0022/0023 to prod Supabase (via MCP) BEFORE/with the merge** (additive → the frozen Vercel/Agora standby ignores them, so applying early is safe). Order: staging smoke → apply prod migrations → merge `--no-ff` → prod smoke on the real pilot iPad. Then `pnpm gen:types` already committed; nothing else.

## Deferred follow-ups (documented, none blocking)

1. **Ownership-aware presence reset + audio one-call gate** — `resetPresenceAfterCall` is value-based (ON_CALL→AVAILABLE), not ownership-aware; an agent holding two concurrent calls (audio+video today; outbound later) could be flipped AVAILABLE while still live. Cosmetic + self-heals ≤1 beat today (`isReachableForDial` treats AVAILABLE==ON_CALL; the outbound busy-guard is row-based). **Tracked as `task_c1f5dccc`, which Kumar started in a separate worktree** (branch `outbound-video-presence-ownership`, `.claude/worktrees/quizzical-lamarr-*`). Reaper needs a two-pass restructure (a naive ownership check self-races). Deliberate value-based choice is JSDoc-commented in `lib/voice/call-state.ts`.
2. **`kiosk/call-ended` presence residual** (whole-branch review #1): when the *guest* hangs up a *connected* call, `kiosk/call-ended` finalizes COMPLETED but doesn't reset the handler's presence, and the reaper only sweeps RINGING/IN_PROGRESS — so a narrow case (agent client gone/crashed mid-call, then guest hangs up) stays ON_CALL until the next foreground heartbeat. Self-healing. Fuller `task_71d65b0a` closure = reset presence in `kiosk/call-ended` (it already reads the row; add `handled_by_user_id` to its select). Fold into follow-up #1.
3. **Tile phase-awareness (M1)** — the DocPiP call tile isn't phase-aware, so a "Calling…" state would look connected in the tile. **NOT reachable in v1** (outbound is overlay-only — `startOutboundVideo` never opens the tile). Only matters if a future task auto-opens the tile for outbound.
4. **Minors:** `CallStartResult` JSDoc in `packages/shared/src/kiosk-api.ts` still says "call-started" (now also incoming-call); no page-render test asserts the Kiosk/Connect buttons are present in `PodCardGrid`'s default slot (pre-existing pattern); `busy`-state mid-flight not test-exercised on the buttons; a `useOutboundVideoAction` hook could DRY `KioskCallButton`/`CallBackShortcut`.

## Repo gotchas

- Root `pnpm lint` currently shows errors from `.claude/worktrees/quizzical-lamarr-*` (the `task_c1f5dccc` worktree) — **ignore**; CI runs on a clean checkout. Lint per-workspace (`pnpm --filter @lc/portal lint`).
- `check:routes` is a **root-only** script (`pnpm check:routes` from repo root).
- **Never `git add -A`** — `analysis-and-audit-2026_07_11/` stays untracked (prior key-leak).
- Portal `test` script is compound; `pnpm --filter @lc/portal test -- <filter>` only filters the jsdom pass — use `cd apps/portal && npx vitest run <name>` for one file.
