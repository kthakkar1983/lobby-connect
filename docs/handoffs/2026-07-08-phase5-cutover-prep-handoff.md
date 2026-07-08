# Handoff — Phase-5 pre-cutover tuning + fixes merged; the cutover is what's left — START HERE

**Written:** 2026-07-08. **Supersedes:** `2026-07-07-phase-e-closeout-done-phase5-cutover-next-handoff.md`. **`main` = `b04bbf5`.** Everything below is on the LiveKit-only trunk and **blue-green-safe** — merging to `main` deploys nothing (Vercel is a frozen standby on Agora); it all ships at the Phase-5 cutover.

## What happened this session (2026-07-08)

Three things merged to `main`, all pre-cutover work:

1. **Video-quality tuning — DONE + merged (PR #37, `b04bbf5`).** The migration plan's "video-quality tuning spike." Own spec→plan→subagent-build (4 TDD tasks, per-task two-stage reviews + opus whole-branch = SHIP), then **3 live tuning rounds** against `chrome://webrtc-internals` on staging.
   - Final config (one retune point, `packages/shared/src/video.ts` `LIVEKIT_VIDEO_TUNING`, imported by both adapters via a shared builder): **single-layer H.264, 1080p capture, 3.5 Mbps, `balanced` degradation.**
   - **The lesson that drove it (read before touching video again):** the hotel kiosk is an **iPad → WebKit → hardware H.264 (VideoToolbox)**. **VP9 encode on Safari/iOS is experimental — off the table for the kiosk.** Testing on a **Mac in Chrome is a PESSIMISTIC proxy** — Chrome-on-Mac gives *software* OpenH264 (weak), which looks softer than the iPad's hardware H.264 at the same bitrate. **Do not judge video quality on a Mac.** Round 1 (2-layer simulcast) forced software H.264 AND thrashed; round 2 (single layer) fixed the thrashing; round 3 (1080p + 3.5M + balanced) is the final. It "looked better even on the Mac" — but the **real quality gate is night-1 on the actual iPad**.
   - Rounds recorded in git history (`b032de2`→`381bcf4`); spec/plan: `docs/{specs,plans}/2026-07-07-livekit-video-quality-tuning*`; memory: `video-quality-tuning.md`.

2. **Pre-answer mute/camera fix — merged (PR #38, `2b352d2`), verified on staging.** Root-caused via `systematic-debugging`: the kiosk ringing screen renders the instant the guest taps to call (`App.tsx` `TAP_CALL`), but the local audio/video tracks aren't assigned until the `startCall → token → joinLiveKit` chain resolves (`App.tsx:138-139`). `toggleMute`/`toggleCamera` no-op on the still-`null` track while flipping the UI, so **muting before the agent answered looked muted but left the mic LIVE for the whole call** (camera-off the same). Fix = gate the mic/camera controls on **track readiness** (`localVideo` present) in `Ringing.tsx`/`CallControls.tsx`: greyed while dialing, enabled the moment the tracks exist (still during ringing). Cancel is never gated. TDD: `apps/kiosk/tests/ringing-controls.test.tsx`.

3. **Task-21 close-out docs + credential-hardening RESEQUENCED — merged (PR #36).** The prior session's close-out commit (the START-HERE handoff, CLAUDE.md/MEMORY sync, the credential BLOCKER) was pushed to `phase5-blocker-handoff` but **never merged to `main`** — this session merged it. In the same PR, the **RustDesk-credential hardening was resequenced** (Kumar 2026-07-08): it is **no longer a pre-cutover / pre-go-live blocker**. The pilot's single credential enters box-prod at cutover **as-is** (plaintext at rest, accepted for the on-site pilot); the app-layer-encryption + fail-closed-audit hardening lands **after the pilot is live on the box and before any second hotel is onboarded** — its own brainstorm→spec→build (leaning single-master-key AES-256-GCM; not yet specced). Recorded in migration plan step 5; `docs/security-posture.md` §6.5 reconciled when it lands.

## State of every moving part

- **`main` = `b04bbf5`** — LiveKit-only trunk with the three merges above. No open PRs.
- **Prod pilot:** frozen Vercel standby (still Agora), serving normally, **untouched** all session.
- **Staging (box):** `staging` branch carries the video tuning + mute fix (last push `91daacf`) for verification. Coolify redeploys on push; portal build may hit the transient "Collecting build traces" OOM → manual Redeploy clears it (bump swap 2→4 GB if it recurs).
- **Phase-1 soak:** ~5 clean days banked; **no longer a pre-cutover gate (Kumar 2026-07-08)** — the full-week validation moves to the post-cutover box-prod window; stamp Phase-1 DONE + tag `plan-phase1-box-staging-complete` once that post-cutover week is clean.
- **Phase 2 (RustDesk relay):** built + verified; waits only on Dilnoza's clean real night → stamp DONE + tag `plan-phase2-relay-complete`.
- **White-bar tile bug (open, low-confidence):** on staging the call tile's bottom control dock sometimes renders as a dead white bar, correlated with **switching tabs between kiosk and dashboard**. Best hypothesis: the known **staging softphone focus-flap** (no Twilio on staging → softphone sits in error → focus change flaps its phase → blanks the tile dock) — i.e. a **staging-env artifact** that wouldn't happen on prod (real Twilio). NOT DevTools (ruled out). **Confirm on prod before investigating** — if it never shows on prod, it's staging-only.

## What's next — the Phase-5 cutover (migration plan steps 5–10)

Gated on **Dilnoza's night-1** (BOTH the Phase-2 relay gate AND the video-quality gate) + the cutover-prep being ready. **⚠ RESEQUENCED 2026-07-08 (Kumar): the pre-cutover 1-week soak is NO LONGER a gate** — the box already banked ~5 clean days (staging + relay + LiveKit since 07-03), so the full-week validation **moves to POST-cutover**, run on the box as *prod* during the warm-standby window with the frozen Vercel standby as instant rollback. Sequence:

1. **Stand up box prod apps** (`lc-portal-prod` + `lc-kiosk-prod` on Coolify, prod Supabase env, `lc_prod` LiveKit key, `SPEECHMATICS_API_KEY` + the FULL Vercel prod env checklist-style); apply migrations 0019/0020 to prod Supabase; enter the pilot's RustDesk peer id + unattended password via box-prod admin (as-is — the hardening is now post-cutover); box crons take over (reaper `*/15`).
2. **Custom domains → Vercel first** (`app.`/`kiosk.lobby-connect.com`), repoint the pilot tablet once while behavior is unchanged.
3. **Cutover runsheet + rollback rehearsal** (Twilio webhooks + the two DNS records + Supabase auth URLs), rehearse the rollback direction once.
4. **GO LIVE** (pointers → box). **Night-1: Dilnoza's deliberate India→NYC3 test video calls** = the definitive video-quality read on the real iPad hardware; Kumar smokes voice + video + Connect (incl. Connect from the **AUDIO in-call overlay** — the one Phase-E surface never live-verified).
5. **~2-week warm-standby window** → then **decommission** (Vercel + Agora closed, Supabase Pro, token revocations, tags `plan-phase4-livekit-complete` + `plan-phase5-cutover-complete`).
6. **Post-cutover, pre-second-hotel:** the RustDesk-credential hardening (encrypt-at-rest + fail-closed audit).

**Deferred / v2:** end-of-call "continue remote session / disconnect?" prompt (LC can't programmatically close RustDesk).

## Gotchas / discipline (carried)

1. **Standby invariants:** frozen Vercel deploys nothing · ADDITIVE-ONLY migrations · `agora_channel_name` unrenamed · Vercel `AGORA_*` + the Agora account stay until decommission.
2. **Don't judge video quality on a Mac** (software OpenH264 ≠ the iPad's hardware H.264). Night-1 on the real iPad is the gate.
3. **Deep-link launches must NOT navigate the top window** while a WebRTC call is live (hidden iframe — the Phase-E launch bug).
4. **Staging is a throwaway deploy-pointer branch** — advance it via a non-ff merge of the feature branch (force-push is blocked); it can carry multiple in-flight features (they don't interact). Prod cannot be affected by any staging/main push (Vercel is git-disconnected).
5. Claude merges PRs on Kumar's explicit go; commit trailer `Co-Authored-By`; no emojis; `main` is push-protected (merge via `gh pr merge`).
6. Live smoke of voice/video/RustDesk only works on deployed envs; the sandbox can't place a call.
