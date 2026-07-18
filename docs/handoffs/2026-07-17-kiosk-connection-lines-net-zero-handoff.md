# Handoff — Kiosk connection-lines animation: NET-ZERO exploration (2026-07-17)

**Read this, then move on.** This session made **no net change to the app.** It explored making the kiosk Home "connection-lines" animation look more organic, tried two approaches on the live kiosk, and reverted both. `apps/kiosk` at `HEAD` (`fbcf426`) is **byte-identical to where the session started** (`f166c34`) — verified (`git diff f166c34 HEAD -- apps/kiosk` is empty).

**For the actual pending agenda, go straight to the predecessor:** [`2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md`](2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md). Nothing in it changed.

## Why `git log` shows ~11 kiosk commits that cancel out

Started from a battery-drain question — a **non-issue** (99% screen-on time over a couple of days incl. video calls + smoke tests; the one real takeaway is operational: keep the kiosk on a charger). Pivoted to a *want*: make the connection lines less "uniform / machined."

Two approaches, both reverted:

1. **Pure-CSS rewrite** — drop `motion`, animate `stroke-dasharray`/`stroke-dashoffset` on `pathLength=1` paths, staggered per-path timing (`a977afd`→`25c5f70`; texture `2e3d92a`→`7835fa9`; re-applied `bcf61c4`→`cf0c885`). **REVERTED** (`06e0306`, `71cd209`). On real hardware it **judders under interaction**: paint-bound stroke-dash on 72 full-viewport SVG paths can't GPU-composite → animation only settles after ~1–2 min, non-deterministic hard-refreshes, flashes + torn-panel artifact on **every mouse move**. Two live-prod incidents on the pilot kiosk.
2. **Organic per-line texture on the MOTION base** — `pathTexture` wobbling static `strokeWidth` ±25% / `strokeOpacity` ±20%, animation byte-identical (`c2f080b`→`1171797`). This one was **smooth — no judder** (confirmed the texture is animation-independent; the judder was purely the CSS stroke-dash *animation*). But Kumar reviewed it live and **preferred the plain, calm, uniform lines** → reverted (`fbcf426`).

**Net:** `apps/kiosk` == `f166c34`. The plain `motion` `FloatingPaths` (`apps/kiosk/src/components/floating-paths.tsx` importing `motion/react`) is the keeper. **The "more organic lines" idea is CLOSED — do not re-pitch it.**

## Lessons (also in memory `[[kiosk-css-animation-reverted]]`)

- **Verify UI by LOOKING *and* INTERACTING on real hardware — never by reasoning or a static screenshot.** This session's root failure: shipped twice on "the static render is byte-identical, so it can't regress" plus a passing Playwright screenshot. Both are blind to animation jank — a still capture has no sustained animation and no pointer movement, so it cannot catch GPU-compositing tears / judder-on-mouse-move. Drive the actual flow before claiming done.
- **The box/Coolify serving layer serves an inconsistent `index.html` + asset mix during a deploy swap.** Observed directly (same `/assets/index-*.js` URL returned different content at different times; a hard-reload *mid-swap* rendered a broken screen — the first incident was two rapid deploys back-to-back). **Deploy ONCE, then verify convergence** — referenced assets self-consistent, a distinctive semantic code marker present/absent (not just the hash, which can differ across build envs), stable across 2 consecutive checks — **before reloading the kiosk.** Reusable poll pattern: `scratchpad/converge-*.sh` (grep the served JS for a marker constant, require 2 stable passes).

## State at handoff

- `main` = `origin/main` = `fbcf426` (+ this handoff's docs commit on top). Kiosk = plain motion, **converged live + confirmed**.
- No open branches or worktrees from this session (all merged + deleted). Only untracked path: `analysis-and-audit-2026_07_11/` — **leave it** (prior key-leak; never `git add -A`).
- Zero migrations / deps / schema / config / RLS touched. Blue-green + standby invariants untouched.

## Next steps = UNCHANGED → the predecessor handoff

Everything substantive is in [`2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md`](2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md): the outbound-video close-out paperwork (tag / worktree removal / plan-stamp / `task_71d65b0a`), the Tier-1 iPad camera-permission settings, the pre-second-hotel **kiosk Safari → native WKWebView wrapper** item, and the standing agenda (tile-polish batch, time-tracker duty-pill UI, outbound-call pod attribution).
