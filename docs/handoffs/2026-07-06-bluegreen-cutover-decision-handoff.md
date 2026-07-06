# Handoff — Phase 4 staging-smoked + BLUE-GREEN CUTOVER DECIDED → next = freeze Vercel, merge, strip Agora — START HERE

**Written:** 2026-07-06 (end of session, after the cutover-model decision) · **Supersedes:** `2026-07-06-phase4-built-staging-smoked-gate1-next-handoff.md` (written earlier the same evening — its Gate-1/2/3 "next" is now obsolete; its box/smoke/gotcha content still stands) · **Branch:** `phase3-workspace` @ HEAD = Phase 3C + Phase 4, mirrored to `staging`. **PR #29 open.** Prod (Vercel/Agora) untouched.

## THE DECISION (Kumar, 2026-07-06, after the staging smoke passed)

**Blue-green at the stack level — prod never flips on Vercel.** The current Vercel deployment FREEZES as a warm standby (still Agora); `main` becomes the clean LiveKit-only trunk; the box becomes prod at a single rehearsed cutover; rollback = swap three pointer sets back to the standby (minutes, total). Rationale + residual risks recorded in the migration plan ("Sequencing rationale — Blue-green amendment") and spec D14 (amended). What this buys: no 1-week prod soak gating anything, Agora deleted from the codebase immediately, all remaining work (Phase 3 D/E + Phase 5 prep) proceeds on one clean trunk. What it trades: cutover night bundles hosting+video+features (standby makes any failure a minutes-scale total rollback); after the strip, video-quality issues have no partial fallback (hence deliberate India test calls night 1).

**The rollback guarantee's foundation: the DB never forks** — both stacks point at prod Supabase and migrations stay ADDITIVE-ONLY (house law; old code ignores new tables). Break that and the standby model breaks.

## Where things stand

- **Phase 4 Tasks 1-11 DONE:** LiveKit v1.13.3 live on the box (`https://livekit.lobby-connect.com/` = OK; no TURN, no Redis; runbook §13); both apps have the provider seam; **staging runs pure LiveKit and Kumar's full smoke PASSED** (video connect + captions + push-wake + busy-cam audio-only + duty controls — Phase C fully verified too). Final whole-branch review = SHIP. One smoke finding = expected v1 semantic (agent-reload ends the call; v2-backlog "Mid-call resume").
- **Amended docs (this session):** migration plan Phase 4 (built; prod tail superseded) + Phase 5 (the 10-step blue-green sequence) + sequencing-rationale amendment · Phase-4 plan Task 12 (superseded banner; its Gate-3 file list = the authoritative Agora deletion list) · spec D14 (amended).

## NEXT SESSION, in order (migration plan Phase 5 steps 1-4)

1. **Freeze Vercel prod deploys** — ignored-build-step (`exit 0`) in the dashboard or `git.deploymentEnabled.main:false`; decide at execution. Verify frozen: push a docs commit to `main` after the merge and confirm NO new Vercel deployment. From this moment the pilot is untouchable.
2. **Kumar retitles + merges PR #29** ("Phase 3C + Phase 4") — deploys nothing anywhere. (0019 does NOT need prod Supabase yet — that moves to cutover-prep, step 5 of the plan.)
3. **Strip Agora on `main`** (own commit series; file list = Phase-4 plan Task 12 Gate 3): `apps/portal/lib/agora/`, `apps/portal/app/api/agora/`, agora CORS line, video-call agora branch + `audioRecoveryRef` agora assignment, `lib/video/diag-audio.ts` + kiosk `[LC DIAG]` block (the 2026-06-30 TEMP diagnostics), `apps/kiosk/src/lib/agora.ts` + `lib/video/agora.ts` adapter, `agora-rtc-sdk-ng` (both apps) + `agora-token`, AGORA_* envs/.env.example, instrumentation fallback → LiveKit-only, tests (`tests/app/agora/`, `tests/lib/agora/`, video-call agora harness folded into the livekit suite, kiosk agora-adapter test + provider-branch agora case), `AgoraTokenResult` folded into `VideoTokenResult`, optional `agora_channel_name` → `video_room_name` rename (decide then; additive-safe = add view/keep column... if renaming, remember the FROZEN Vercel standby still reads `agora_channel_name` — **do NOT rename while the standby is live; keep the column name until decommission**). Full gate after; staging deploy + quick re-smoke (staging is now the only pre-prod proof).
4. **Then Phase 3 D (call tile) on the clean trunk** — fully smokable on staging; Phase E after; then Phase-5 steps 5-10 (box prod apps, custom domains, runsheet + rollback rehearsal, GO LIVE with Dilnoza's India night-1 calls, ~2-week standby window, decommission).

## Build gotchas / discipline (carried — load-bearing)

1. **Additive-only migrations = the standby's lifeline** (see THE DECISION). 0019/0020 apply to prod Supabase at cutover-prep, not before.
2. **The Agora strip must NOT rename/drop columns the frozen standby reads** (`agora_channel_name` stays until decommission).
3. **Coolify "Readonly" labels checkbox WIPES custom labels when re-checked** (bit us live; restored byte-identical). Labels UI = app → General → Container Labels; keep Readonly UNCHECKED (runbook §10). coolify-proxy net = `10.0.1.0/24` (runbook §13). No direct Coolify-DB writes (auto-mode blocks it, correctly) — UI or API token.
4. **⚠ DEP-HYGIENE for Phase D** (two prior OOMs): tile effects depend on identity-stable values; Task 10 added refs only, zero new effects — keep that bar.
5. Claude cannot push `main` (PR; Kumar merges) · pushing `staging`/`phase3-workspace` allowed · `gen:types` = pinned CLI 2.101.0 · presence writes service-role · commit trailer per session harness (this session: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
6. Subagent-driven build with two-stage reviews + byte-gates earned its keep all phase — keep it for the strip (behavior-preserving deletion: the LiveKit path's tests must stay green with zero edits).

## Carry-forward (non-blocking)

- **Phase 1 soak** checkpoint ~2026-07-10 → tag `plan-phase1-box-staging-complete`. **Phase 2 relay** waits on Dilnoza's clean real night → tag `plan-phase2-relay-complete`. (Both independent of the cutover work.)
- GitHub secret-scanning alert still open · pilot phone line not transferred · dashboard/softphone-tile layout rework post-migration · v2-backlog: mid-call resume + ChunkLoadError reload-guard (design together).
- LiveKit keypairs: PM-stored, Mac file deleted (register updated). `lc_prod` gets used at Phase-5 step 5.

## Register reminder

Real dialogue, plain English; decide when one answer is sane, converse on genuine forks (tonight's cutover-model change was a genuine fork — surfaced, argued honestly both ways, Kumar decided). Build for the future, not just the pilot. Sourcing discipline. Systematic debugging before fixes. The standby IS the safety net now — protect the invariants that keep it valid (frozen deploy, additive migrations, shared secrets).
