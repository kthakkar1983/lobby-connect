# Handoff — Outbound-video smoke CLOSED: 3 fixes shipped + verified on prod; kiosk-Safari wrapper queued pre-second-hotel (2026-07-16)

**START HERE.** The real-iPad prod smoke that the [previous handoff](2026-07-15-outbound-video-calls-merged-smoke-pending-handoff.md) was gating on **has been walked**. It surfaced one genuine bug, one suggestion, and (separately) two unrelated finds. **All are fixed, merged to `main`, deployed, and confirmed working by Kumar on prod.** What's left is paperwork (close-out + tag) plus one device-settings check, and a new **pre-second-hotel** item.

- Predecessor: [`2026-07-15-outbound-video-calls-merged-smoke-pending-handoff.md`](2026-07-15-outbound-video-calls-merged-smoke-pending-handoff.md)
- Spec: [`docs/specs/2026-07-15-outbound-video-calls-design.md`](../specs/2026-07-15-outbound-video-calls-design.md) · Plan: [`docs/plans/2026-07-15-outbound-video-calls.md`](../plans/2026-07-15-outbound-video-calls.md)

## Current state

| Thing | State |
|---|---|
| `main` | **`e2385fa`** = merge `fix/signout-redirect-and-kiosk-chat-close`. `origin/main` == `e2385fa`. (The push also carried the previously-unpushed `f42de9c` handoff doc.) |
| Prod | Coolify auto-deployed both `lc-portal-prod` + `lc-kiosk-prod` from `main`. **Kumar verified all three fixes live.** |
| Outbound video calls | **Smoke PASSED** (with the fix below). The feature is done. |
| Tests | kiosk **74** green · portal signout **2/2** · typecheck/lint/build clean on both apps. |
| Frozen Vercel/Agora standby | Still the rollback net (flip Twilio + tablet back). Standby invariants unchanged. |

## What shipped this session (3 merges, all TDD'd)

### 1. Kiosk stuck on the incoming screen — **the smoke failure** (merge `8ee3ae5`, commit `1dd964c`)
**Symptom:** agent fires an outbound call, nobody answers → at 30s the agent shows "No answer" and returns home, but the **kiosk hung on "The front desk is calling — Answer" indefinitely**, clearing only when someone tapped Answer (which 409'd).

**Root cause:** the agent side was fine — its 30s window (and Cancel) both call `handleEnd` → `end-video`, which correctly finalizes the row `NO_ANSWER`. The **kiosk** was the problem: its discovery poll was gated `if (state.screen !== "home") return` with dep `[state.screen]`, so the moment the poll flipped the kiosk to `incoming`, the effect's cleanup **cleared the interval**. The incoming screen had *no poll and no timer* → no way to ever notice the call was gone. (Spec §10 *intended* "poll returns null → kiosk returns Home", but §4.2 gated the poll to Home-only. Design/impl gap, not a regression.)

**Fix:** poll continues on the `incoming` screen; a **confirmed-idle** result returns Home (~3s). `fetchIncomingCall` now returns a **discriminated** `{status: "ringing" | "idle" | "error"}` so a *transient error is ignored* and can't drop a live ring. New guarded reducer action `INCOMING_EXPIRED` (fires only from `incoming`). Self-heals even if the agent client crashes without finalizing, via the route's existing 30s `ring_started_at` bound.

### 2. Kiosk incoming ring — **the suggestion** (same merge)
The kiosk now rings the **same `ring.mp3` as the agent** while the incoming screen is up, stopping the instant it leaves (answered → ringing, or gone → home). Primed on touch to unlock autoplay; skipped during a live call so it can't blip over call audio. Asset copied to `apps/kiosk/public/sounds/`. A jsdom media stub (`apps/kiosk/tests/setup.ts` + `setupFiles`) keeps component tests quiet. **Kumar confirmed the ring works on the iPad.**

### 3. Sign-out broken on prod (merge `e2385fa`, commit `b7c840d`)
**Symptom:** clicking Sign out opened `0.0.0.0:3000/sign-in`. Broke at the box cutover; nobody noticed until now.

**Root cause + the durable gotcha:** the route built its redirect from `request.url`. **Behind Traefik, a Next.js _route handler_'s `request.url` is the container's internal bind address `http://0.0.0.0:3000`** — so the browser was 303'd somewhere unreachable. Worked on Vercel (public host). **Middleware is NOT affected** (`middleware.ts` still uses `new URL("/sign-in", request.url)` and works — initial login depends on it — because middleware sees the forwarded host). **Fix:** emit a **relative** `Location: /sign-in`; the browser resolves it against the real origin. Regression test `apps/portal/tests/app/auth-signout.test.ts` pins it. ⚠ **Any future absolute-URL construction in a portal route handler on the box has this trap** — memory: `route-handler-request-url-box`.

### 4. Kiosk chat close button (merge `e2385fa`, commit `bcd1b21`)
An **X** in the chat panel header (`setChatOpen(false)`). Closing only *collapses* — the guest re-opens via the existing **Type** control, and a new agent message still auto-reopens it (chat is never muted). Functional now; **visual placement deliberately rides the UI/UX pass.**

## Verified vs residual

**Kumar confirmed live on prod:** the ring, sign-out, and chat-close.

⚠ **One residual 60-second check:** the **30s idle → kiosk auto-returns Home** path (fix #1) was never *explicitly* re-confirmed in words — Kumar reported "ring works now" and moved to other findings, which implies it, but it wasn't restated. **Fire an outbound call, leave the iPad untouched for ~30s, confirm it returns Home on its own with no tap.** If it does, the outbound-video smoke is unambiguously closed.

## Next actions

### A. Close out outbound-video-calls (paperwork — was gated on the smoke)
1. `git tag plan-outbound-video-calls-complete <commit>` + push. *(Judgment call: the prior handoff said tag `fd3fbdb`, but the feature is only actually-working as of the fix in `8ee3ae5` — tagging the fix merge is more honest.)*
2. Remove the merged worktree: `git worktree remove .claude/worktrees/quizzical-lamarr-3dcccc` (its only unique commit `8f28720` is on `main` as `4f897ea`). Then delete stale local branches `outbound-video-presence-ownership` / `outbound-video-calls` / `fix/flaky-duty-resync-test`.
3. Stamp `docs/plans/2026-07-15-outbound-video-calls.md` done + add a CLAUDE.md build-status row.
4. Consider closing tracked bug **`task_71d65b0a`** (presence stuck ON_CALL after a video call — this feature's shared end-path reset is the fix; smoke item #7).

### B. Kiosk camera/mic prompts — Tier 1 (Kumar, on the pilot iPad, ~5 min)
The guest is intermittently shown iOS's **"Allow camera / Allow microphone"** prompt. **Not per call** — it fires when the **page reloads after the screen goes idle or Safari purges it**. Apply and re-test:
1. **Display & Brightness → Auto-Lock = Never**
2. **Accessibility → Guided Access → Mirror Display Auto-Lock = ON** ← *Guided Access does NOT prevent this by itself; with this OFF, **GA blanks the screen after 20 min** regardless of #1. Suspected actual culprit.*
3. **Settings → Safari → Camera + Microphone = Allow**; on the prompt choose **"Allow for This Website"** (persists), **never "Allow Once"** (resets on reload).
- **Do NOT "Add to Home Screen"** — a PWA is strictly *worse* (iOS doesn't persist camera grants for PWAs).

### C. Safari wrapper — **NEW pre-second-hotel item** (tracked in the migration plan)
Recorded as a Phase-5 step-5 sub-bullet in [`docs/plans/2026-07-01-stack-consolidation-migration.md`](../plans/2026-07-01-stack-consolidation-migration.md), alongside the RustDesk-credential hardening — **both are post-pilot / pre-second-hotel.**

Ship the kiosk inside a thin native iOS **WKWebView** wrapper implementing `webView(_:requestMediaCapturePermissionFor:…:decisionHandler:)` → `decisionHandler(.grant)`. Camera/mic are then granted **once to the app** at install and the web content **never prompts again**, regardless of reload/purge. Also buys URL pinning, auto-reload-on-crash, keep-awake without fighting GA. Cost: Apple Developer account (~$99/yr — *unverified*) + small Swift app + distribution (TestFlight/ad-hoc/MDM). **Why it's not just Tier 1:** Kumar's bar is *"if there is even a 5% chance of customers needing to press allow a couple of times on an iPad they do not own… it will not leave a good impression"* — and Safari was never designed as an unattended kiosk container; every Tier-1 mitigation is settings hygiene a future iPadOS can silently change, on iPads we don't own. Full rationale + sources in the plan bullet. **Own brainstorm→spec→build.**

### D. Carried-forward agenda (unchanged)
- **Tile-polish backlog:** Connect color-split (card navy vs unify teal), quiet the Reopen-tile pill, shared `<ConnectControl>`, disabled-Connect contrast, reopen reposition. Fold in `[[dashboard-layout-rework-deferred]]`. Spec: `docs/specs/2026-07-10-call-tile-polish-batch1-design.md`.
- **Time-tracker UI:** duty-pill polish (b: consistent pill sizing; c: distinct End-shift icon). *Placement change was DECLINED — stays top-right.*
- **Bigger deferred (own brainstorm each):** attention-aware dormant/wake tile · RustDesk true-fullscreen SOP.
- **Open bug (from the tile-polish smoke):** "Reopen tile" crashes the call when the agent's camera is busy (audio-only) — needs a diagnostic build. See `docs/handoffs/2026-07-11-tile-primary-shipped-plus-followups-handoff.md`.

## Gotchas (new + standing)

- 🆕 **Route-handler `request.url` on the box = `0.0.0.0:3000`.** Never build redirects/absolute URLs from it in a portal **route handler**; use a relative `Location` (or `x-forwarded-host`/`-proto`). Middleware is fine. Memory: `route-handler-request-url-box`.
- 🆕 **A screen-gated poll can't notice the state change that should move it *off* that screen.** The kiosk's Home-only poll is exactly why the incoming screen hung. If a screen is entered by a poll result, it needs its own liveness check to leave.
- 🆕 **Distinguish "confirmed empty" from "request failed"** in any poll that drives a UI teardown — collapsing both to `null` would have made a single network blip kill a live ring.
- **Never `git add -A`** — `analysis-and-audit-2026_07_11/` stays untracked (prior key leak). Stage explicit paths.
- Root `pnpm lint` shows errors from `.claude/worktrees/quizzical-lamarr-3dcccc` until it's removed — ignore; lint per-workspace (`pnpm -r --parallel lint`). `check:routes` is root-only. Per-workspace `lint` scopes to `src`/`app|components|lib` — only root `eslint .` lints `tests/`.
- One kiosk test file: `cd apps/kiosk && npx vitest run <name>` (jsdom via per-file `// @vitest-environment jsdom`). Portal: `cd apps/portal && npx vitest run <name>` (+ `--config vitest.jsdom.config.ts` for component tests).
- **Blue-green invariants (until decommission):** additive-only migrations; do NOT rename `agora_channel_name`; Vercel `AGORA_*` env + the Agora account stay; `KIOSK_CONFIG_SECRET` identical. The DB is shared and never forks.
- Supabase refs: **prod `ztunzdpmazwwwkxcpyfp`**, **staging `cgtvqjxhbojztzumshca`** (both at 0023).
- **Prod auto-deploys from `main` on merge (Coolify).** Reload the iPad kiosk after a kiosk deploy — it caches the old Vite bundle.
- **Don't judge video on a Mac** — the iPad's hardware H.264 is the real gate.
