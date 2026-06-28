# Handoff — Realtime migration + hosting-cost scaling

**Date:** 2026-06-28 · **Branch:** `main` (all session code merged + deployed) · **Status:** analysis + decision direction only — **no realtime code written yet**

This is the single "start here" doc for the next session. Read this, then pick up at the **brainstorm** for the realtime migration. It's self-contained.

---

## TL;DR

While testing v1.1, two cost signals arrived (Vercel 75% of free Fluid Active CPU; Supabase staging auto-paused). Digging in revealed the real issue: **the app's cost scales with fleet size × idle time, not with actual calls** — because of **polling**. The fix that makes cost track real work is to move the **high-frequency signaling paths from polling to Supabase Realtime (push)**. This deliberately revisits **locked decision #4** ("20s polling, no subscriptions"), which was the correct v1 call but the wrong call at scale.

Nothing is built for this yet. **Next step = brainstorm → spec → plan** for the realtime migration. There's also one **cheap, standalone N+1 fix** (owner home) that can be done independently at any time.

---

## What shipped this session (all on `main`, deployed)

| Commit | What |
|---|---|
| `f5f44d8` | Dashboards auto-refresh (agent+admin) + chart Y-axis + softphone self-heal-on-focus + consistent green line pills |
| `8961d9b` | Invisible remote-audio autoplay recovery on cold first video call (agent + kiosk) — `lib/video/audio-unlock.ts` + kiosk mirror |
| `569dc85` | `@vercel/speed-insights` added to portal layout |

These are unrelated to the realtime work except that the **AutoRefresh added in `f5f44d8` increases the dashboard polling load** (see "stopgaps" below).

---

## The cost findings (measured)

- **Vercel portal Active CPU = 3h 3m over the last 30 days** (free tier cap = 4h). Hit the **75%** warning email; at 100% the projects **auto-pause** (prod phone line goes dark until the monthly reset). Kiosk is a static SPA — all the function/CPU burn is the **portal**.
- **Portal runtime logs, by route** (representative, ~2h retained window):
  | Route | Cadence | Scales with |
  |---|---|---|
  | `/api/kiosk/heartbeat` | every 30s, **24/7** | **# properties** (a no-op in v1: verifies token, returns 204) |
  | `/api/calls/incoming-video` | every **3s** per open agent tab | **# agents × hours online** (the balloon) |
  | `/admin`, `/` (dashboards) | every 20s per open tab (AutoRefresh) | # users × hours (DB-heavy renders) |
  | `/api/presence` | every 20s per portal tab | # users × hours |
- **Honest gap:** Vercel's API gives invocation *frequency*, not CPU-*seconds*. Exact per-route Active-CPU lives only on the dashboard **Usage → Active CPU** page. The above identifies *candidates* by frequency; per-call CPU weight is estimated (heaviest per-call = dashboard renders; most frequent = kiosk heartbeat, which despite being a no-op likely contributes a large share purely via 24/7 per-invocation overhead, incl. middleware running on every request).
- **Supabase staging** (`lobby-connect-staging`, `cgtvqjxhbojztzumshca`) auto-paused after 7 days idle — **harmless**, unpause on demand within 90 days. **Prod** (`ztunzdpmazwwwkxcpyfp`) is unaffected (crons keep it awake).

## Why this matters at scale (the core insight)

Polling means every client constantly asks "anything new?" on a timer, paying per-invocation overhead whether or not anything happened. So cost grows with **how many devices are online and for how long**, *decoupled from actual call volume*. At 20 properties / 5–10 agents this balloons (rough est: the 3s video poll alone ≈ **2.9M DB-querying invocations/month**; 20 always-on kiosks ≈ tens of CPU-hours/month doing nothing).

**Polling double-bills:** every poll is *both* a Vercel function invocation *and* a Supabase query. So it loads the Postgres compute instance too. **Realtime relieves both bills at once.**

## Supabase at scale (separate but related)

Supabase is the **less scary** half: the app's *data* is tiny (low call volume, **no recordings** in v1, **guests don't authenticate** — kiosk is token-based), so storage/auth/egress/realtime-connections stay cheap for years. The only pressure point is **DB compute under polling load** — which the realtime migration relieves. Supabase Pro ($25/mo) is justified by **backups + no-pause** once real paying-customer data is on prod, **not** by runaway scale cost.

---

## The decision direction (to confirm + scope in the brainstorm)

**Move the high-frequency signaling paths from polling → Supabase Realtime (push).** Supabase Realtime is already in the stack and idle-cheap; at 20 properties + 10 agents ≈ ~30 concurrent connections (free tier allows ~200, Pro ~500), well within limits.

Priority order:
1. **Incoming-call signaling (biggest win)** — replace the 3s `/api/calls/incoming-video` poll with a Realtime push when the kiosk inserts a RINGING video call. Compute then ∝ actual calls. *(Audio incoming already uses Twilio push, not polling.)*
2. **Presence** — replace the 20s `/api/presence` heartbeat with Realtime Presence (the connection itself = liveness).
3. **Kiosk liveness** — replace the 30s heartbeat with a held connection (disconnect = down). Keep the `kiosks.last_seen_at` seam.
4. **Dashboards** — *not* fully-reactive (over-engineering); use **"subscribe + refetch-on-change"**: hold a Realtime subscription, and only `router.refresh()` when an actual change event arrives instead of a blind 20s timer. Idle night = zero queries.

**What stays as-is:** low-frequency request/response (admin CRUD, owner pages, per-call API work). Vercel remains the right home for the app tier — this is *not* a "leave Vercel" move; it's "stop polling on serverless."

**Why we didn't do this in v1 (so the next session doesn't relitigate):** decision #4 (polling) was the correct v1 choice — simpler, stateless, self-healing, far faster to ship solo, and the cost downside doesn't exist at 1 property. Realtime adds connection-lifecycle + channel-auth + missed-event-catchup complexity that wasn't worth paying before the scale that benefits from it. The trigger to flip is **now** (scaling toward 20 properties) + the **usage data above**. This is deferred-optimization done right, not a past mistake.

---

## Cheap standalone win (independent of the realtime work)

**Owner-home N+1.** `apps/portal/app/(owner)/owner/page.tsx:193` fires **2 queries per property** (a count + a last-call) via `props.map(async …)` → ~2N queries per load (40 at 20 properties). The agent + admin dashboards are **not** N+1 (Phase 3 optimized them: one batched fetch + in-memory aggregation). **Fix:** mirror that pattern — fetch today's calls for all properties in one `.in("property_id", propIds)` query, then count + last-call per property in memory → 2N becomes 2. Small, low-risk, matches existing code; safe to do anytime, before or with the realtime work.

## Stopgaps considered and DEFERRED (don't bother if doing the real migration)

- Gate `AutoRefresh` on `document.visibilityState` (skip the 20s refresh on hidden tabs; refresh on return). Real but small; superseded by "refetch-on-change."
- Slow the kiosk heartbeat 30s → 60s/120s. Superseded by moving kiosk liveness to a held connection.

---

## Upgrade posture (decided)

- **Vercel Pro — do soon.** Removes the auto-pause cliff *now* (uptime), and unlocks the warm-pings (cold-start first-call fix) + `*/15` reaper discussed earlier. Billing is Kumar's to action. The realtime migration is what controls the *6-month* cost; Pro is the *immediate* safety.
- **Supabase Pro — defer** until real paying-customer data is live (backups + no-pause), not for scale cost. Staging pausing is harmless.
- Open follow-up if wanted: pin **exact dollar projections** (Vercel Pro included Active-CPU + overage rate — *unverified*; Supabase compute tiers) before committing.

---

## Next session: start here

1. Read this doc + `CLAUDE.md` decision #4 + `docs/specs/2026-05-27-v1-architecture-design.md` (realtime section).
2. Run the **brainstorm** skill on the realtime migration (scope, the decision-#4 reversal, what pushes vs stays polled, migration order, channel-auth/RLS-over-websocket, missed-event catch-up, reconnection).
3. Then spec → plan → subagent build, per the usual cycle.
4. Optionally land the owner-home N+1 fix first as a quick standalone PR.
