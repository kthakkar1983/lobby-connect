# Handoff — UI/UX Batch 4 (Copy) shipped to prod; smoke pending; resume at Batch 5 (2026-07-24)

**START HERE.** `main` = **`836ac9a`** (PR [#52](https://github.com/kthakkar1983/lobby-connect/pull/52) merged; Coolify auto-deploying to box-prod). **Batch 4 (Copy) of the whole-app UI/UX polish is DONE and merged.** This chat is expected to open with **Kumar's smoke results**. Predecessor handoff: `docs/handoffs/2026-07-23-clocks-tile-finalized-resume-batch4-handoff.md`.

## First action this chat
**Get Kumar's Batch-4 smoke results.**
- If **clean** → proceed to **Batch 5 (Consolidation + housekeeping)**, the final batch (scope below).
- If **findings** → fix them first (new branch off `main`, subagent-driven, same cadence), re-smoke, then Batch 5.

Smoke checklist (also in PR #52 body):
- [ ] Softphone idle (agent + admin, on/off duty): "You're on. We'll ring you." / off-duty "Ready when you are." / "Ready" line pill / admin covering "We'll ring you for any property you're covering." / a reconnect blip shows "Your line dropped. Reload to reconnect."
- [ ] Empty states: a quiet agent/admin dashboard reads calm status (not "will chart here"); owner empties person-facing. (Agent chart + recent-calls now read DIFFERENT lines: "Quiet so far tonight." vs "Nothing yet tonight.")
- [ ] 911 confirm dialog reads clean, no em dashes, wording otherwise unchanged (place a **933** test if handy — display-string change only, machinery byte-identical).
- [ ] Kiosk Ringing screen lays out cleanly with the recording note gone.
- [ ] In-call: "Property local time"; call filters + call-tile chip say "Property."
- [ ] Admin: shifts table "Capped 10h"; users table "On call"/"Available" (not `ON_CALL`); sign-in shows the contact-admin note.

## What shipped this session (Batch 4 — 10 commits, `294b020`→`c42b379`, merge `836ac9a`)
An `impeccable clarify` pass vs `docs/brand/ui-copy-guide.md` ("talk to the person, not the interface") + em-dash purge + terminology + 4 factual fixes. **Zero migrations / routes / RLS / call-logic** — copy strings, one removed kiosk render element, comment refreshes, and tests only.

1. **Softphone idle voice** — 4 state-narration strings → person-facing (softphone.tsx idle captions + LinePill "Line ready"→"Ready"). Regression-guard file: edited caption strings ONLY.
2. **Empty states** — tightened `copy.ts` 7 empties + agent/admin dashboard chart+recent + admin calls filter to calm status. Actionable teaching empties ("Add your first property.") left untouched. **Nit fixed post-review:** agent dashboard chart+recent no longer show the same line twice (`agentCalls` → "Nothing yet tonight.", mirroring admin's deliberate split).
3. **Em-dash purge (portal)** — ~33 sites / 19 files. 911 dialog (`audio-call-overlay.tsx`) + `emergency/route.ts` note = **display strings ONLY**, dispatch/mute/conference logic byte-identical (opus-verified). Exempt: the `"—"` empty-cell placeholder; comments keep their dashes.
4. **Kiosk copy** — 2 em dashes purged + the **stale "Calls may be recorded for quality" note removed** (recording dropped in v1) + its render element in `Ringing.tsx` (and the now-unused `ShieldCheck` import).
5. **Terminology → "Property"** — 9 user-facing "hotel" sites ("Property local time", "this property's PC", filter/chip labels, etc.). Guest still sees the property's real name (kiosk `welcomeHeading` untouched); code identifiers/`data-testid`/comments NOT renamed. `<meta>` → "After-hours front desk, staffed by real people." + a **marketing-site SEO reminder appended to `docs/v2-backlog.md`** (decide "hotels" keyword there, since the portal is auth-gated / no real SEO).
6. **Factual: shift cap 12h → 10h** (`shifts-table.tsx:136,648`, matches `MAX_SHIFT_MS`). The separate `SESSION_MAX_MS = 12h` and its comments correctly left alone.
7. **Sign-in reset note** — "Forgot your password? Contact your administrator." **Already shipped in Plan 9** (`sign-in/page.tsx:83`), so Task 7 added only a regression test to pin it. `/forgot-password` page **left as-is** (orphan, not linked; SMTP + Workspace land in ~1–2 months — Kumar's call).
8. **Users-table enums** — raw `ON_CALL`/`AGENT` → humanized via existing `presenceLabel` + a `ROLE_LABELS` map. **Copy-only**; pill/zebra visual restyle deferred to Batch 5.

Plus a comment-hygiene sweep (`duty-provider.tsx:201`, `shift-card.tsx:30`, `softphone.tsx:819` — comments that quoted pre-batch strings; `presence.test.ts:246` "12h cap" left, it's the session cap).

## Verification (all green)
- **Whole-branch opus review = SHIP.** Regression guards intact across all commits; every multi-task file (audio-call-overlay, softphone, users-table, shifts-table, remote-access-card, copy.ts) confirmed — both tasks present, neither clobbered the other.
- **1456 tests** (portal 488 jsdom + 885 node, kiosk 83) · typecheck both apps · `check:routes` · eslint · portal + kiosk production builds. **CI (`verify`) green on PR #52.**
- Subagent-driven TDD: fresh sonnet implementer + combined spec+quality sonnet reviewer per task; opus whole-branch. Reviews caught 1 real copy defect pre-merge (the redundant "this property's **property** PC" → corrected to "this property's PC").

## Deferred / known (non-blocking)
- **3 code COMMENTS still say "hotel PC"** (`audio-call-overlay.tsx:379`, `video-call.tsx:757`, `call-tile.tsx:396`, the `gate="none"` explainer) — comments are out of the copy guide's scope; fold into a future comment-hygiene sweep if desired.
- **`/forgot-password` page still has its stale "you'll receive a reset link shortly" promise** — deliberately left (orphan page, not linked; the sign-in note gives users the real path). Revisit when SMTP lands.
- The 16 untracked `" 2.tsx"/" 2.ts"` dupes remain (Batch 5 `git clean`s them). ⚠ The `.next/types/* 2.ts` gotcha persists until then: `find apps/portal/.next/types -name "* 2.ts" -delete` before any typecheck/build.

## NEXT — Batch 5 (Consolidation + housekeeping), the FINAL UI/UX batch
Scope (plan `docs/plans/2026-07-21-uiux-polish.md` line 150; gets its own just-in-time plan mirroring Batches 2–4):
- **Primitives:** `Toggle` / `Tabs` / `StatusBadge` (Radix, token-skinned) + migrate the hand-rolled in-call toggles, Playbook⇄Chat / Video⇄Chat / call-filter "tabs" (add `role=tab`), and the 3×-reinvented status pills onto them.
- **Unify:** CRUD shapes (users' Dialog-create + Sheet-edit is the sharpest split), container width/padding + the 4 radius tokens, flatten nested cards (owner Home / property detail wrap `CallRow` in a `Card`).
- **Dead code:** `dashboard/line-beacon.tsx` + `dashboard/greeting-line.tsx` (never rendered; `LineStatusProvider` still mounted + softphone reports phase into it at `softphone.tsx:273` — untangle), `CallControlTray` (`call-controls.tsx:74`, dead after the bar reorder).
- **`git clean` the 16 `" 2.tsx"/" 2.ts"` dupes** (see audit "Dead code"; `git clean -n` first). This ALSO removes the `.next/types/* 2.ts` gotcha at the source.
- Optional `ButtonGroup` primitive if the equal-width pattern has recurred.
- **Note:** Batch 8/users-table pill+zebra visual unification lands here (deferred from Batch 4).

## Method / gotchas (unchanged — keep using)
- **Subagent-driven TDD:** fresh sonnet implementer + combined spec+quality sonnet reviewer per task; opus whole-branch per batch; branch → PR → `gh pr checks <n> --watch` → Kumar (this session authorized me to merge; default is Kumar merges) → prod auto-deploy → Kumar smokes.
- **Test gates:** component tests `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>`; lib `pnpm --filter @lc/portal exec vitest run <substr>`; kiosk `pnpm --filter @lc/kiosk exec vitest run`. **`@testing-library/jest-dom` NOT installed** — `.toBeTruthy()`/`.toBeNull()`, never `.toBeInTheDocument()`. `check:routes` is a ROOT script.
- **Build/typecheck:** `find apps/portal/.next/types -name "* 2.ts" -delete` FIRST (the ` 2.tsx` dupes spawn stale `.next/types/* 2.ts`). **Root `pnpm lint` fails only on a stray `.claude/worktrees/` checkout** — verify with `pnpm exec eslint . --ignore-pattern '.claude/**'` or per-package lint; CI (clean checkout) is unaffected.
- **jsdom judges TEXT fine** (good enough gate for copy), but anything visual/layout still needs Kumar's live prod smoke.

## Housekeeping
- `main` = `836ac9a`. Feature branch `uiux-polish-batch4-copy` merged + deleted (remote). Plan: `docs/plans/2026-07-23-uiux-polish-batch4-copy.md`.
- Batches 1–4 of the 5-batch UI/UX polish (`docs/plans/2026-07-21-uiux-polish.md`) are shipped; **Batch 5 is the last.**
- Untracked and staying (Batch 5 `git clean`s the dupes): the 16 `" 2.tsx"/" 2.ts"` dupes, `analysis-and-audit-2026_07_11/`, `polish-mock.png`, and the handoff docs (incl. this one).
