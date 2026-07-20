# Handoff — call-control consistency + dashboard-column polish: SPEC + PLAN GATED, build NOT started (2026-07-20)

**START HERE.** A follow-up UI polish pass to the duty-column work that shipped 2026-07-19 (`dfc8700`). Kumar reviewed the live prod build, found button/UI inconsistencies across the in-call surfaces + the dashboard right column, walked me through 7 annotated screenshots, and approved a spec + plan. **Nothing is built yet.** The build happens in this fresh chat.

- **Branch:** `call-controls-column-polish` (off `main` = `dfc8700`). Spec + plan + this handoff are committed on it; the working tree is otherwise clean.
- **Spec:** [`docs/specs/2026-07-20-call-controls-and-column-polish-design.md`](../specs/2026-07-20-call-controls-and-column-polish-design.md) — GATED (Kumar approved 2026-07-20).
- **Plan:** [`docs/plans/2026-07-20-call-controls-and-column-polish.md`](../plans/2026-07-20-call-controls-and-column-polish.md) — 11 tasks, TDD, self-contained. **Read its "Cross-cutting constraints" section before touching anything.**

## What this is

UI/UX only. **Zero migrations / routes / RLS.** No change to call routing, duty semantics, or 911 machinery. Ten items:

1. **In-call bars (audio overlay, video overlay, call tile)** → one unified order: **`Connect · Mute · [Camera / Video-Chat] · Captions · End call`**. Connect is the far-left bookend; End call the far-right. Normalized height/radius/icon per surface; nothing wraps.
2. **`End call`** → blaze on both surfaces (video flips off navy), far right, relabelled from the tile's "Hang up".
3. **Reopen-tile** → round mint corner icon on **both** overlays (audio moves off the bar to its call-card corner; video already is one).
4. **Video/Chat toggle (tile)** → teal active segment fills its half flush (kills the gaps).
5. **Property card `Answer`** → gains a `Phone` icon so it aligns with Silence/Connect/Kiosk.
6. **Dashboard right column** → aside stretches, clocks pinned to the bottom (line up with the properties tile), cards hold height off duty.
7. **`LinePill`** → duty-aware; shows "Off duty" instead of green "Line ready" while off duty.
8. **Captions Sentry** → swallow the async `stopRecognition` rejection (pre-existing, harmless, one line).
9. **Kiosk call-control pill** → even the corner spacing (separate app; verify on the tablet).

## How to execute

Same discipline as the prior batches: **subagent-driven TDD** (superpowers:subagent-driven-development), fresh subagent per task, two-stage review per task, then a whole-branch review + independent SHIP synthesis before merge. The plan's tasks 1→6 are the in-call surfaces (shared components 1–2 before consumers 3–5); 7–10 are independent; 11 is the whole-gate + cleanup.

**Gate to keep green** (baseline verified at `dfc8700`): node 879 / jsdom 420; typecheck · lint · check:routes · build. Add tests, don't regress.

## The three things most likely to bite (all in the plan, restated because they matter)

1. **Never mock `duty-provider` in `softphone.test.tsx`** (Task 8) — it renders the real provider on purpose; mocking it makes the `softphone.tsx:587` audio accept-gate tests vacuous while green. Drive duty via the file's `hydration` lever inside the `describe("Softphone — D13 duty hydration + gated beats")` block.
2. **Match each test file's real render/mock idiom — verify by reading it first.** The plan's test snippets show INTENT + assertions, not drop-in code. The 2026-07-19 plan needed an entire CORRECTIONS doc precisely because it invented helper names and line refs; that doc (`docs/plans/2026-07-19-duty-column-polish-CORRECTIONS.md`) still documents the real idioms for `property-card.test.tsx`, `call-tile.test.tsx`, `video-call*.test.tsx`, `softphone.test.tsx` — lean on it.
3. **Visual outcomes are smoke-only.** jsdom has no layout engine: the column alignment, corner rounding, the Video/Chat teal fill, exact button-height parity, and the kiosk pill spacing are verified by LOOKING on real hardware. jsdom tests assert order/label/class-presence; the rest is Kumar's prod smoke.

## The one open design call

**§5 column alignment (Task 7)** is the only item where the *mechanism* is a judgment call. The spec chose the **robust** approach — stretch the aside, pin clocks to the bottom with `mt-auto`, hold a `min-h-*` on the shift card — which reads aligned rather than being pixel-matched (pixel-perfect cross-column alignment of two content-driven columns is brittle). The `min-h-*` rem value and the kiosk padding value are **smoke-tuned**, not asserted. If Kumar wants it tighter after seeing it live, the fallback (explicit tuned min-heights) is noted in spec §5.

## Reconciliation — this intentionally reverses three 2026-07-19 decisions

Spec §2 "Reconciles" + §9. The plan updates the load-bearing comments **in the same commits** so a future reader doesn't undo them:
- **Connect+End grouping** (old §5.4) → Connect/End are opposite bookends.
- **End call navy-video/blaze-audio** (old D11) → blaze both (video has no 911 to disambiguate from).
- **Audio reopen as a bar button** (old §6) → call-card corner icon.

The 2026-07-19 spec is not edited (git history holds it); this spec is the superseding record.

## Prod-smoke checklist (Kumar runs, after the build + whole-branch review)

- **Each in-call surface:** order is Connect → … → End call; End call blaze, far right, unmistakable; 911 still clearly separate on audio; nothing wraps in the 380px tile.
- **Reopen:** round mint icon in the audio call-card corner (matches video).
- **Video/Chat:** teal fills its half flush; rounding consistent.
- **Card:** Answer has its icon and the row aligns.
- **Column:** softphone+shift as the top block; clocks bottom-aligned with the properties tile; **toggle duty live — the cards do NOT collapse.**
- **Pill:** reads "Off duty" while off duty.
- **Kiosk:** pill corner spacing on the real tablet.

## Context / invariants still in force

- **Blue-green:** merging to `main` auto-deploys box-prod (Coolify). The frozen Vercel/Agora standby is still the instant rollback until decommission (~2026-07-23 window); this is UI-only + low risk, but additive-only + don't-rename-`agora_channel_name` invariants still hold.
- **21 untracked `"… 2.tsx"` duplicates** under `apps/portal` are byte-identical sync artifacts — ignore or `git clean` (Task 11 step 3).
- Predecessor handoff: [`2026-07-19-duty-column-polish-build-complete-smoke-pending-handoff.md`](2026-07-19-duty-column-polish-build-complete-smoke-pending-handoff.md). Standing agenda items from it (kiosk Tier-1 settings, WKWebView wrapper, credential hardening, Vercel/Agora decommission) are unchanged and out of this scope.
