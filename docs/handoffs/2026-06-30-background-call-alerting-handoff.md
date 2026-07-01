# Handoff — background-tab incoming-call alerting (design in progress) + PIP fix + audio-diag confirm

**Date:** 2026-06-30 · **Branch:** `main` · **Status:** mid-brainstorm on a permanent fix; **direction chosen (Web Push + service worker), design doc NOT yet written**

Single "start here" doc for the next chat. Continues the same day's [`2026-06-30-first-call-audio-debug-handoff.md`](2026-06-30-first-call-audio-debug-handoff.md) (that one = audio-device debug; this one = the background-tab notification regression + its permanent-fix design, plus two smaller items shipped).

---

## TL;DR — three threads

1. **[DONE] Audio-diag log check.** Ran the temp guest-audio diagnostics against prod Sentry. The cold call Kumar reported as working (11:20 UTC, call `2fb21d51`) shows `energy=POSITIVE`, `maxVolume=0.592` (guest's remote track, 0–1 scale), `autoplayBlocked=false` on the confirmed-fresh build (release `cf0c787`). Corroborates the device-switch hypothesis (healthy audio when the phone isn't hijacking the MacBook mic). **Caveat:** no captured *failure* (`energy=ZERO`) exists to contrast — the old failures predate the fresh build — so it's consistent, not airtight. **Keep testing; temp diagnostics STAY IN per Kumar.**
2. **[DONE, shipped] Agent self-view PIP** repositioned bottom-right → **top-right** so the bottom caption band stops covering it (`apps/portal/components/video-call/video-call.tsx`). Committed + pushed to `main` (auto-deploying). 523 + 4 video-call tests + typecheck green. Matches the kiosk's self-view placement.
3. **[IN PROGRESS — resume here] Background-tab "no ring / no notification" regression.** Root-caused; now designing the permanent fix. **Direction locked: Web Push + service worker.** Design doc not yet written.

---

## Thread 3 — the regression + the design

### Root cause (CONFIRMED)
- **Symptom:** when the agent's portal tab is backgrounded / not in view, an incoming **video** call produces **no ring and no tab-title notification**. A regression ("used to work").
- **Confirmed via git:** commit `02f3425 feat(video): Realtime push for incoming-video banner (replaces 3s poll)` (the v1.2 realtime work, 2026-06-28). It replaced an unconditional **3s poll** with **Supabase Realtime push (primary) + a 60s safety poll** (`INCOMING_VIDEO_FALLBACK_POLL_MS = 60_000`) + refetch-on-focus. Site: `apps/portal/components/video-call/incoming-video-banner.tsx`.
- **Mechanism:** the ring and the tab-title flash both gate on `calls` populating via `tick()` (`isRinging = calls.length > 0`). Backgrounded, the Supabase Realtime WebSocket doesn't reliably deliver (heartbeat/reconnect are timer-driven, and hidden-tab timers get throttled, then the tab freezes), and the 60s poll is too slow *and* itself throttled → `calls` never populates → no ring, no title flash. The **old 3s poll degraded gracefully** under background throttling (still fired every few seconds), which is why it "used to work." **No `visibilitychange` handling exists anywhere** to compensate.
- **Key contrast (Kumar's clue):** the **Twilio audio** call **still rings** on a backgrounded tab — because Twilio's Voice SDK holds its own always-alive signaling WebSocket and pushes over it. This **rules out "browsers block background alerts"** and pins the fault specifically on Supabase Realtime's background delivery. The audio path was **not** touched by v1.2.

### Requirements (from Kumar this session)
- Agents **will** leave the portal tab backgrounded for **long** stretches — they operate **RustDesk / remote-desktop to the hotel PC in a separate tab** and won't sit staring at the portal. So a surgical adaptive poll is **insufficient as the permanent fix** (a hidden-tab poll degrades to ~1/min and the tab freezes after ~5 min).
- **Browser/OS: not standardized** across agents → design for the lowest common denominator **and confirm the agents' actual browsers**. (Original bug agent = Windows PC; Kumar tests on a MacBook.)
- **Alert modality: OS-level desktop notification + sound** that pops over other apps (RustDesk), click-to-answer. Not just an in-tab ring.
- **Reach required: tab backgrounded, browser still open.** De-scoped for now: browser fully quit; and the "ring the agent's phone" backstop.
- **Kumar's steer: factor in future upgrades / integrations / changes; go with the MOST ROBUST option.**

### Chosen direction — Web Push + service worker (Approach A)
On an incoming call, the **server pushes** a notification at the trigger points that already exist (kiosk `call-started` webhook for video; Twilio `incoming` webhook for audio) → a **service worker wakes independent of tab state** (throttled / frozen / backgrounded / even the tab closed with the browser open) → shows an **OS notification** (sound, hotel name, click-to-focus-and-answer).
- **Most robust:** sidesteps background throttling/freezing entirely instead of fighting it.
- **Browser-agnostic** across modern desktop browsers (Chrome/Edge/Firefox, Safari 16.4+ — *from prior knowledge; VERIFY against the agents' actual browsers given "not standardized"*).
- **Near-zero idle cost** (no polling; push only on a real call) — improves on today's cost profile and fits the realtime/cost direction ([[realtime-and-cost]]).
- **Forward-compat payoff (why it fits "future integrations"):** a server-side **notification-dispatch layer** + a `push_subscriptions` table generalizes cleanly to multi-device-per-agent, a future mobile/PWA, the phone-backstop layer, admin/ops alerts, PagerDuty (a cut-v1 feature), backup-agent ringing, and the multi-tenant per-operator seam (decision #6).
- **Rejected — Approach B** (keep-alive silent-audio + Notifications API): lighter and reuses the current realtime, but it's a browser-dependent keep-alive *hack*, Safari-flaky, and dies if the tab is closed. Not "permanent."

### OPEN sub-decisions — confirm FIRST next chat
Kumar steered "most robust / future-proof" but didn't explicitly answer these; the lean follows from that steer:
1. **Unify audio + video** under one OS-notification layer (**recommended** — consistent, and audio today only makes a *sound* with no visual pop, so a full-screen-RustDesk agent can still miss it) vs. video-only for now.
2. **Permission onboarding** — each agent grants notification permission once, folded into first login (**recommended**). Confirm acceptable for the known pilot agents.
3. **Verify the agents' actual browsers** (Web Push version support) before locking the LCD.

### Where we are in the flow
Mid `superpowers:brainstorming`. Done: context, clarifying questions, approaches proposed + direction chosen. **NEXT:** confirm the 3 sub-decisions → present design sections (subscription storage + RLS, VAPID keys/env, SW registration + lifecycle, server push in the webhooks, notification UX + click-to-answer, permission onboarding, foreground fallback layering, tests) → write spec to `docs/specs/2026-XX-XX-background-call-alerting-design.md` → self-review → user review → `superpowers:writing-plans`.

---

## Also still open (from the prior handoff, unchanged)
- Temp guest-audio diagnostics **still on `main`** (remove once the audio cause is fully pinned — Kumar is keeping them in while testing). Removal list in [`2026-06-30-first-call-audio-debug-handoff.md`](2026-06-30-first-call-audio-debug-handoff.md) §4.
- Max-call-duration cap built but unmerged (`fix/max-call-duration-cap` @ `abcdcd9`).
- Agora Console checks; GitHub secret-scanning alert.

## Reading order next chat
1. `CLAUDE.md` + `MEMORY.md` (esp. [[realtime-and-cost]], [[voice-vs-video-incoming]]).
2. This handoff.
3. `apps/portal/components/video-call/incoming-video-banner.tsx` (regression site) + `apps/portal/lib/realtime/{broadcast,calls-channel}.ts` + the push trigger points (`app/api/kiosk/call-started/route.ts`, the Twilio `incoming` webhook).
4. Confirm the 3 sub-decisions → resume brainstorming → design doc.
