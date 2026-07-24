# Handoff — UI/UX Batch 2 + Batch 3 + property-card follow-up SHIPPED; smoke pending on #50/#51 (2026-07-22)

**START HERE** for the next chat. This session shipped three things to `main`; Batch 2 is prod-smoked PASS, and **Batch 3 (#50) + the property-card follow-up (#51) are merged + deploying and awaiting Kumar's prod smoke** (he's testing them in the meantime). `main` = `8f7d34d`.

## FIRST THING TO DO in the new chat
Ask Kumar for the smoke results of **#50 (Batch 3)** and **#51 (property card)**. If he found issues, fix them with the same flow that worked all session (subagent-driven TDD: implementer sonnet → combined spec+quality reviewer sonnet → opus whole-branch on a batch → PR → CI → Kumar merges/smokes; per-package gates). The most likely single finding: the property card's idle label **"Standing by"** may read as over-claiming readiness for an off-duty property — **"Clear" is a one-token swap** (`STATE_LINE.quiet` in `apps/portal/components/dashboard/property-card.tsx`). Only after #50/#51 clear, move on to **Batches 4–5** (below).

## What shipped this session (all to `main`)
1. **UI/UX Batch 2 — Accessibility** — PR [#49](https://github.com/kthakkar1983/lobby-connect/pull/49), merged `127f4fe`, **PROD-SMOKED PASS**. 9 TDD tasks, zero migrations/routes/RLS/call-logic:
   - Focus rings on every hand-rolled `<button>`/`<Link>` that lacked one (both 911 buttons, call-tile controls, `CaptionToggle`, softphone Go-on-duty + Accepting, 3 auth submits, CallRow/RecentCallRow/IncidentRow, password toggle); Dialog/Sheet close `focus:`→`focus-visible:`. **Surface-appropriate recipe**: LIGHT `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` · DARK (navy call-tile) `…ring-primary-foreground…ring-offset-primary` · INSET (full-bleed rows) `…ring-2 focus-visible:ring-inset focus-visible:ring-ring`.
   - Color-alone → text: admin Status-page word (OK/Degraded/Down/Unknown), team-on-now presence label (fixes same-grey AWAY/BREAK), owner bottom-nav active `bg-accent/10` fill.
   - Owner bottom-nav `min-h-[44px]` + `pb-[env(safe-area-inset-bottom)]`.
   - Reduced-motion FloatingPaths → full static lines (`pathLength:1`, was 0.3 stub) via a pure `pathMotion` helper (portal `lib/brand/path-motion.ts` + kiosk `src/lib/path-motion.ts`).
   - Plan: `docs/plans/2026-07-22-uiux-polish-batch2-accessibility.md`.
2. **UI/UX Batch 3 — Dashboard layout** — PR [#50](https://github.com/kthakkar1983/lobby-connect/pull/50), merged `252b9bd`, **SMOKE PENDING**. 3 tasks, the locked director decisions:
   - **Sticky operator rail** — the dashboard aside gains `lg:sticky lg:top-6 lg:self-start` (`components/dashboard-workspace.tsx`). This is the deliberate **third approach** to a right-column that failed two prior blind attempts (`mt-auto` stretch → clocks at page bottom; natural stack → trailed): sticky depends on nothing in the left column's height, so it **can't overshoot**. Moves no content; the existing "no overshoot" guard test is intact. **Kumar must live-verify the scroll behavior** (jsdom can't).
   - **Covering label** — the fleet toggle (`AvailabilityToggle`) now shows a visible "Covering" label; aria-label leads with "Covering" (WCAG 2.5.3); toggle logic byte-identical.
   - **Phone-health removed** — deleted the tile + `/admin/phone-health` page + `lib/dashboard/phone-health.ts` (+ its test); the 3 remaining admin pulse tiles now `lg:grid-cols-3`.
   - Plan: `docs/plans/2026-07-22-uiux-polish-batch3-dashboard-layout.md`.
3. **Property-card follow-up** — PR [#51](https://github.com/kthakkar1983/lobby-connect/pull/51), merged `8f7d34d`, **SMOKE PENDING**. From Kumar's live review of the property card:
   - Show the property's **current local time** before the live state on one row (`7:15 AM · Standing by`); time muted, state to its right. New minute-resolution clock ticker (separate from the ring-elapsed ticker), reusing `formatTimeOnly` with a try/catch that hides the time on a bad tz.
   - **"Quiet" → "Standing by"** for the idle live-state. KEY SEMANTIC (settled with Kumar): "Quiet"/"Standing by" is the **line's live idle state (no active call right now)**, NOT a volume judgment — it's separate from the cumulative "N calls tonight". A volume/activity signal was explicitly **declined** (the call count is indicator enough).
   - **Dropped "· last 7:02 AM"** (kept "N calls tonight").

## Smoke checklists (what "pass" means)
**#50 (Batch 3):** (a) scroll admin + agent dashboard home — the right rail follows the scroll, no overshoot, top whitespace reads as an intentional right-rail (the hard-look item); (b) fleet card footer toggle reads "Covering"; (c) admin pulse row = 3 filled tiles, no "Phone health", `/admin/phone-health` 404s.
**#51 (property card):** (a) card status row shows the property's local time before the state, correct for the property's timezone; (b) idle reads "Standing by"; (c) "N calls tonight" stays, "· last …" gone.

## Rollback (each independent)
```bash
git revert -m 1 252b9bd && git push   # Batch 3 (#50)
git revert -m 1 8f7d34d && git push   # property card (#51)
```
(Batch 2 `127f4fe` is smoked-good; leave it.)

## What's next — Batches 4–5 (each gets its own just-in-time plan; see the 5-batch plan `docs/plans/2026-07-21-uiux-polish.md`)
- **Batch 4 — Copy.** `impeccable clarify` against `docs/brand/ui-copy-guide.md`, leading with the manual-speak / state-narration class (softphone idle, the Covering line, "Your line is offline", empty-state narration). Lead rule = **"talk to the person, not the interface."** Centralize strings into `lib/copy.ts` + the kiosk mirror; purge em dashes (the null-`—` cell placeholder is exempt); unify terminology to **"Property"**. Four factual fixes: **Capped 12h→10h** (`shifts-table.tsx` — the real cap is `MAX_SHIFT_MS = 10h`), the forgot-password false-promise reword, the kiosk recording note (recording was removed in v1), users-table raw-enum humanization.
- **Batch 5 — Consolidation + housekeeping.** `Toggle`/`Tabs`/`StatusBadge` primitives + migrate the hand-rolled toggles/tabs/pills; unify CRUD shapes + container/radius; flatten nested cards; delete dead code (`line-beacon`, `greeting-line`, `CallControlTray`); **`git clean` the 16 `" 2.tsx"/" 2.ts"` dupes**; a `ButtonGroup` primitive if the equal-width `grid-cols-2` pattern has recurred enough.

## Method / gotchas (worked all session — keep using)
- **Subagent-driven** per the parent plan's mandate: fresh implementer (sonnet) + combined spec+quality reviewer (sonnet) per task, opus whole-branch review per batch, then branch → PR → `gh pr checks <n> --watch` → Kumar merges (auto-deploys prod) → Kumar smokes.
- **Per-task gates:** component tests need the jsdom config — `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>` (the `test` script is compound `vitest run && vitest run --config vitest.jsdom.config.ts`, so a bare `-F @lc/portal test <substr>` mis-passes args). Lib tests: `pnpm --filter @lc/portal exec vitest run <substr>`. `check:routes` is a **ROOT** script (`pnpm check:routes`). Full gate = `pnpm -F @lc/portal test` (both configs) + typecheck + lint + build + `pnpm check:routes`; kiosk `-F @lc/kiosk test`+`build` only when kiosk files change.
- **`@testing-library/jest-dom` is NOT installed** — use `getByText`/`getByRole` + `.toBeTruthy()`/`.not.toBeNull()`, never `.toBeInTheDocument()`.
- `getByRole` throws inside the call-tile's fake-PiP document — use `pipDoc.body.querySelector('[aria-label="…"]')` / `getByText(...).closest("button")`.
- Kiosk vitest globs only `tests/**`; kiosk unit tests live at `apps/kiosk/tests/lib/**` importing via `@/lib/…` (a `src/**/*.test.ts` is never collected).
- **Regression guards** stayed byte-identical all session: 911 machinery, notes handlers, `handleConnect`, softphone accept-gate (now `softphone.tsx:612`, not the plan's stale `:587`).
- The `admin/page.tsx` team-on-now and the sticky rail are the two things jsdom can't fully prove — **live smoke is the real gate** (standing house lesson).

## Housekeeping state
- `main` = `8f7d34d`. Branches `uiux-polish-batch2-a11y`, `uiux-polish-batch3-dashboard`, `property-card-status-line` all merged + deleted (local + remote).
- The 16 untracked `" 2.tsx"/" 2.ts"` dupes + `analysis-and-audit-2026_07_11/` + `polish-mock.png` + the prior handoff docs are still untracked (Kumar's; Batch 5 `git clean`s the dupes). A stray `.claude/worktrees/` checkout can still trip root `eslint .` — use per-package lint.
- **This handoff is left UNCOMMITTED** (untracked, like the repo's other handoffs) to avoid a redundant docs-only prod deploy on top of the #50/#51 deploys. Commit it whenever convenient.
- Memory: `uiux-polish-batch2` (canonical status incl. Batch 3 + the card) · related `[[uiux-polish-batch1]]`, `[[dashboard-layout-rework-deferred]]`, `[[wcag-enabled-control-exemption]]`, `[[call-controls-column-polish]]`, `[[deploy-and-smoke-workflow]]`.
