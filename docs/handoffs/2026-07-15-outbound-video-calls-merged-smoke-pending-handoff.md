# Handoff — Outbound Video Calls: MERGED to `main` + CI green, real-iPad PROD smoke pending (2026-07-15)

**START HERE.** Agent-initiated **outbound video calls** (call-back to a lobby kiosk) + **kiosk liveness** are **built, integrated, merged to `main`, and live on prod** (Coolify). Prod + staging DBs are both migrated. **CI is green.** The **only** remaining gate is the **real-iPad PROD smoke** — a human walk that tests can't cover. This chat was opened to bring back the smoke results.

- Predecessor handoff (build state, deferred-follow-up detail): [`2026-07-15-outbound-video-calls-build-complete-smoke-pending-handoff.md`](2026-07-15-outbound-video-calls-build-complete-smoke-pending-handoff.md)
- Spec: [`docs/specs/2026-07-15-outbound-video-calls-design.md`](../specs/2026-07-15-outbound-video-calls-design.md) · Plan: [`docs/plans/2026-07-15-outbound-video-calls.md`](../plans/2026-07-15-outbound-video-calls.md)

## Current state (all done)

| Thing | State |
|---|---|
| `main` | `fd3fbdb` = feature merge `67fd885` (parents `4860261` + `4f897ea`) + flaky-test fix merge `3a2e02a`. `origin/main` == `fd3fbdb`. |
| Feature | 18-task plan (subagent-driven, per-task two-stage reviews + **opus whole-branch = SHIP**) + `task_c1f5dccc` presence fix cherry-picked in. |
| `task_c1f5dccc` (ownership-aware presence reset + one-call gate) | Built in worktree branch `outbound-video-presence-ownership` (`8f28720`), **cherry-picked** onto the feature branch as `4f897ea` before merge — zero conflicts (verified no file overlap with tasks T10–T17). |
| Prod DB (`ztunzdpmazwwwkxcpyfp`) | Migrated to **0023** (`0022_calls_direction` + `0023_kiosks_liveness`), applied via MCP **before** the merge. |
| Staging DB (`cgtvqjxhbojztzumshca`) | Caught up to **0023** (parity). Kumar skipped the staging *smoke* deliberately, but the schema is aligned. |
| Coolify prod | `lc-portal-prod` + `lc-kiosk-prod` deployed from `main` (Kumar confirmed the deploy). |
| CI | **GREEN** — run `29464154427` on `fd3fbdb`, all steps incl. `Test` + `DB types drift check` (the drift check confirms the committed generated types match 0022/0023). |
| Local gate (integrated branch, pre-merge) | shared 52 · kiosk 64 · portal (node+jsdom) · typecheck · build (portal+kiosk) · lint · check:routes — all green. |

### The CI red-herring (already resolved — context only)
The feature merge (`67fd885`) reddened CI on a **pre-existing flaky test**, NOT the feature: `apps/portal/tests/components/softphone.test.tsx` → *"Softphone — D13 duty hydration + gated beats > an OFF-duty tab resyncs to ON duty via focus…"*. It used `expect(posts.length).toBe(1)` inside a `waitFor` on a **monotonically-growing** presence-beat counter — a timing-raced second (correct, `AWAY`) beat overshoots to 2 and can never settle back to 1 (~1-in-6 flake locally; red on the slower CI runner). Fixed in `3a2e02a` (merge `fd3fbdb`) by asserting **≥1 beat AND every beat is `AWAY`** — preserves the guard (no stale-accepting `AVAILABLE` beat) without the count race. 20/20 clean after the fix; full file 21/21. Not related to outbound calls or the deployed build.

## THE remaining gate — real-iPad PROD smoke (run this, bring back results)

Walk on a **real iPad kiosk** on **prod** (`app.lobby-connect.com` / `kiosk.lobby-connect.com`). **Do NOT judge video on a Mac** — the iPad uses **hardware H.264**; Mac-Chrome is a pessimistic software-encode proxy (`packages/shared/src/video.ts` = single-layer H.264/1080p). The frozen Vercel/Agora standby is the rollback net (see below).

1. **Happy path** — agent on duty → property card kiosk dot **mint** → click **Kiosk** → agent shows "Calling [hotel]…" → iPad flips to "The front desk is calling — Answer" (~3s poll) → tap **Answer** → both connected → **captions + in-call chat + RustDesk Connect all work** → hang up → **agent presence returns to AVAILABLE** (not stuck ON_CALL).
2. **Glare** — guest taps the kiosk during a live outbound call → surfaces **Answer**, not an error. Second outbound to the same property → **409 "busy."**
3. **30s no-answer** — click Kiosk, leave iPad idle → 30s → agent shows "No answer"; owner call history shows **"No answer" (neutral), NOT "Missed" (blaze)**, and it does **not** appear under the **Missed** filter (click the filter to confirm the query exclusion).
4. **Terminal-drop lockout** — mid-connected-call, kill the iPad network → iPad returns Home with "Reconnecting you to the front desk — one moment", tap disabled ~10s; fire a **Call back** in that window → iPad flips straight to Answer.
5. **Answer watchdog (cold first call)** — answer late in the ring window on a cold start; if the agent side already tore down, the iPad should recover to apology→home within ~12s, not hang on "connecting."
6. **Liveness offline** — sleep the iPad → within ~90s the card dot goes **muted** + the Kiosk button greys "Offline"; admin **status page → Kiosks** tile flips **blaze** with a reduced count.
7. **Presence regression (`task_71d65b0a`)** — run a normal **inbound** guest call → answer → hang up → confirm the agent is **no longer stuck ON_CALL** (this feature's shared end-path reset is the fix).
8. **Handler name (verify-live)** — open an outbound-initiated **NO_ANSWER** row in owner/admin call history → it should show the **initiating agent's name** (`handled_by` is set at insert). If it reads "Unanswered," that's an easy follow-up fix, not a blocker.
9. **Video quality** — judge on the real iPad (hardware H.264). This is the night-1 quality gate.

## What to do with the smoke results (next chat)

### If smoke PASSES → close it out
1. Tag the release milestone: `git tag plan-outbound-video-calls-complete fd3fbdb` (+ push the tag). *(This is a `plan-*` milestone tag, separate from semver; see `docs/VERSIONING.md`.)*
2. Remove the now-merged worktree: `git worktree remove .claude/worktrees/quizzical-lamarr-3dcccc` (its only unique commit `8f28720` is on `main` as `4f897ea`). Then delete the stale local branches `outbound-video-presence-ownership` + `outbound-video-calls` + `fix/flaky-duty-resync-test` if desired.
3. Stamp the plan done (`docs/plans/2026-07-15-outbound-video-calls.md`) and add a CLAUDE.md build-status row.
4. Consider closing the tracked bug **`task_71d65b0a`** (verified fixed in smoke #7).

### If smoke FAILS → rollback + fix
- **Rollback (fast):** Coolify → redeploy the prior deployment on `lc-portal-prod` / `lc-kiosk-prod`. **Or (full):** flip **Twilio voice webhooks** + the **tablet kiosk bookmark** back to the frozen **Vercel/Agora standby** (still live, on `main@f4af480`-era). Migrations **stay** (additive/harmless; the standby ignores `calls.direction` + `kiosks`).
- Then `systematic-debugging` on the failure, fix on a branch, re-verify (local gate + the specific smoke item), re-merge `--no-ff` to `main` (Coolify redeploys). Remember jsdom can't catch CSS-stacking/timing bugs — reproduce on the real device.

## Non-blocking deferred follow-ups (carry forward)
1. **`kiosk/call-ended` presence residual** — when the *guest* hangs up a *connected* call, `kiosk/call-ended` finalizes COMPLETED but doesn't reset the handler's presence, and the reaper only sweeps RINGING/IN_PROGRESS → a narrow case (agent client gone/crashed mid-call, then guest hangs up) stays ON_CALL until the next foreground heartbeat. **`8f28720` did NOT touch `kiosk/call-ended`** — still open. Self-healing. Fuller `task_71d65b0a` closure = add `handled_by_user_id` to its select and reset there.
2. **Tile phase-awareness (M1)** — the DocPiP call tile isn't phase-aware; a "Calling…" state would look connected. **Not reachable in v1** (outbound is overlay-only; `startOutboundVideo` never opens the tile). Only matters if a future task auto-opens the tile for outbound.
3. **Minors** — `CallStartResult` JSDoc in `packages/shared/src/kiosk-api.ts` says "call-started" (now also incoming-call); no page-render test asserts the Kiosk/Connect buttons in `PodCardGrid`'s default slot; `busy`-state mid-flight not test-exercised on the buttons; a `useOutboundVideoAction` hook could DRY `KioskCallButton`/`CallBackShortcut`.

## Repo gotchas (still apply)
- **Never `git add -A`** — `analysis-and-audit-2026_07_11/` stays untracked (prior key-leak). Stage explicit paths.
- Root `pnpm lint` shows errors from `.claude/worktrees/quizzical-lamarr-3dcccc` (the presence worktree) until it's removed — **ignore**; CI runs on a clean checkout. Lint per-workspace (`pnpm -r --parallel lint`).
- `check:routes` is a **root-only** script (`pnpm check:routes`).
- One portal test file: `cd apps/portal && npx vitest run <name>` (node pass) or add `--config vitest.jsdom.config.ts` (component/jsdom pass). The portal `test` script runs both.
- **Blue-green invariants (until decommission):** additive-only migrations; **do NOT rename `agora_channel_name`**; Vercel `AGORA_*` env + the Agora account **stay**; `KIOSK_CONFIG_SECRET` identical across box/Vercel. The DB is shared and never forks.
- Supabase refs: **prod `ztunzdpmazwwwkxcpyfp`**, **staging `cgtvqjxhbojztzumshca`** (both at 0023). Supabase MCP can query/migrate both.
