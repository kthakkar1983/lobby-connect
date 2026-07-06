# Handoff — Phase 4 (LiveKit swap) BUILT + STAGING SMOKE PASSED → next = Task 12 Gate 1 (merge) — START HERE

**Written:** 2026-07-06 (end of the Phase-4 build session) · **Supersedes:** `2026-07-05-phase3C-done-staging-notes-phase4-next-handoff.md` · **Branch:** `phase3-workspace` @ `642e800` = **Phase 3C + Phase 4 together**, mirrored to `staging` (box auto-deployed). **PR #29 open to `main` (retitle to "Phase 3C + Phase 4" at merge).** NOT merged; prod untouched and still on Agora.

## TL;DR

Phase 4 went spec → gate → plan → gate → box bring-up → 8 subagent-built code tasks (two-stage reviews; 3 byte-preservation gates held; final whole-branch review = SHIP) → staging deploy → **Kumar's smoke = PASS, all items** — in one session. **Staging is end-to-end testable for the first time** (`VIDEO_PROVIDER=livekit`): kiosk video connects through the box's own LiveKit, captions work, push wakes a minimized browser, busy-webcam degrades to audio-only, duty controls verified — which also completes the parked **Phase-C verification**. Flying-blind is over.

**Docs of record:** spec `docs/specs/2026-07-05-phase4-livekit-swap-design.md` (D1-D15) · plan `docs/plans/2026-07-05-phase4-livekit-swap.md` (STATUS + Task 11 smoke record inline) · runbook §13 (LiveKit ops) + §10 amendment (labels trap).

## What is live where

- **Box (`lc-box-1`):** LiveKit v1.13.3 at `/opt/livekit/` (plain compose, host networking, NO TURN, no Redis; UDP mux 7882-7885; keypairs `lc_prod`/`lc_staging` in `/opt/livekit/livekit.yaml` + Kumar's PM — the transient Mac key file is deleted). `https://livekit.lobby-connect.com/` → `OK` (Coolify Traefik dynamic config → host:7880). Snapshot `pre-phase4-livekit` exists.
- **Staging:** portal env has `VIDEO_PROVIDER=livekit` + LIVEKIT_* (lc_staging); carve-out label includes `/api/video/`; boot log clean of video-provider warnings (D15 proof; the Twilio warning is the known no-Twilio-on-staging state).
- **Prod (Vercel):** completely untouched — still Agora, no new envs yet, 0019 not applied.

## NEXT: Task 12 gates (plan has the full checklist)

1. **Gate 1 — merge (Kumar's call, no urgency):** Claude applies migration `0019_push_subscriptions` to PROD (ref `ztunzdpmazwwwkxcpyfp`) via MCP FIRST (the 0018 lesson) → Claude adds Vercel prod envs (`VIDEO_PROVIDER=agora` **inert**, `LIVEKIT_URL`, `LIVEKIT_API_KEY=lc_prod`, `LIVEKIT_API_SECRET` from PM) → Kumar retitles + merges PR #29 → prod two-call smoke on AGORA (pass = nothing feels different).
2. **Gate 2 — prod flip (Kumar's timing):** Vercel `VIDEO_PROVIDER` → `livekit` + redeploy → one video-call smoke → 1-week real-nights soak. Rollback = flip back (env-only).
3. **Gate 3 — post-soak Agora strip:** concrete file list in plan Task 12; tag `plan-phase4-livekit-complete`; stamp the migration plan Phase-4 DONE.
- **Phase 3 D (call tile, Tasks 16-17) + E (remote access, Tasks 18-20) are UNBLOCKED** — the tile builds on LiveKit and is now fully smokable on staging the day it's built. Can go before or after Gate 1; Kumar picks.

## Smoke finding (resolved — not a bug)

Agent-tab reload mid-call ends the call for BOTH sides. Root-caused: page unload drops the participant → kiosk `onAgentLeft` → `endCall(callId,"completed")` finalizes instantly — **byte-identical v1 semantic on Agora** (not a Phase-4 regression). D9 duplicate-identity = zombie PREVENTION, not resume; SDK-level auto-reconnect (network blip, no reload) is the survival path that exists. Logged: `docs/v2-backlog.md` "Mid-call resume across an agent reload" (design together with the ChunkLoadError reload-guard carry-forward).

## Build gotchas / discipline (carried — load-bearing)

1. **⚠ Coolify "Readonly" labels checkbox REGENERATES/WIPES custom labels when re-checked** (bit us live mid-cutover; restored byte-identical from the pre-captured original). Labels UI = app → **General** → Container Labels (runbook §10 corrected). Keep Readonly UNCHECKED on both apps forever. Wipes only bite at the next deploy — restore from the live container's labels (`docker inspect`) before redeploying.
2. **coolify-proxy network = `10.0.1.0/24`** — NOT Docker's 172.16/12 (a 172.16/12 ufw allow silently dropped Traefik → the 7880 rule targets 10.0.1.0/24; runbook §13).
3. Direct writes to Coolify's DB are off-limits (auto-mode denied it, correctly) — use the UI or the Coolify API (`lc-claude` token in PM) for app config.
4. **⚠ DEP-HYGIENE remains the dominant risk for Phase D** (two prior OOMs): the tile's effects must depend on identity-stable values; Task 10 added refs only, zero new effects — keep that bar.
5. Byte-preservation review gates earn their keep (three held this phase; the reviewer-suggested "attach once per handle" doc line was WRONG and would have misdocumented the seam — screens re-attach across remounts by design).
6. Still-live priors: Claude cannot push `main` (PR; Kumar merges) · pushing `staging`/`phase3-workspace` allowed · `gen:types` needs pinned Supabase CLI 2.101.0 · Coolify Traefik labels verbatim, no `$$` · presence writes stay service-role.
7. Commit trailer this session: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Carry-forward (non-blocking)

- **Phase 1 soak** checkpoint ~2026-07-10 → tag `plan-phase1-box-staging-complete`. **Phase 2 relay** waits on Dilnoza's clean real night → tag `plan-phase2-relay-complete`.
- Temp guest-audio diagnostics still on `main` (die at the Agora strip — Gate 3 includes them) · GitHub secret-scanning alert still open · pilot phone line not transferred · dashboard/softphone-tile layout rework deferred post-migration · AWAY-toggle Twilio-decouple optional one-liner.
- Both `lc-claude` API tokens (DO + Coolify) stay until Phase-5 close, then revoke (register §4).

## Register reminder

Real dialogue, plain English; decide when one answer is sane, converse on genuine forks. Build for the future, not just the pilot. Sourcing discipline on every claim (this phase's spec cites every LiveKit fact to primary sources — keep that bar). Systematic debugging before any fix (the reload "bug" was expected behavior; root-cause first saved a pointless patch). Nights run on proven infrastructure — prod flips only via Kumar's gates. Subagent-driven build with two-stage reviews.
