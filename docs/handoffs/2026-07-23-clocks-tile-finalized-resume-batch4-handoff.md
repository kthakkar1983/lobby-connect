# Handoff — Clocks tile finalized (content-height); resume UI/UX Batch 4 — Copy (2026-07-23)

**START HERE.** `main` = **`0154ea5`** (pushed; Coolify auto-deploying to prod). This session closed the **last open nit on the merged duty rail** — the world-clocks tile height — so the dashboard right-column saga is now fully settled. **Next work: resume UI/UX Batch 4 (Copy).** Predecessor handoff: `docs/handoffs/2026-07-23-merged-duty-rail-shipped-tuning-handoff.md`.

## What shipped this session (`0154ea5`, one commit, 2 files)

The world-clocks tile (`ZoneClocksCard`) was **ballooning to ~1131px**. Root cause: the merged-duty-rail rework turned the right rail into a 2-row **subgrid** where `<main>` and `<aside>` span both rows with the default `align-items:stretch`, so the clocks card (row-2 item) stretched to the **full row-2 height = the left column's Properties + Team + Recent stack** — four faces pinned to the top over ~800px of dead space. Its height was never set in its own file; it came entirely from the grid stretch.

**Fix:** `lg:self-start` on the clocks `<Card>` — opts *just that one item* out of the subgrid stretch, back to **content-height (~314px), top-aligned on row 2**. This is literally how the clocks read *before* the subgrid (pre-`2e43014` the aside was a plain `flex flex-col` sticky rail = content-height). Top edge still aligns with the Properties card by construction; only the bottom is freed.

- **Files:** `apps/portal/components/dashboard/zone-clocks-card.tsx` (`lg:self-start` + a long why-comment) · `apps/portal/components/dashboard-workspace.tsx` (row-2 comment updated). **Zero** migrations / routes / RLS / call-logic.
- **Tests:** clocks + workspace component tests green (23/23), unchanged.
- **Verified live on prod** by injecting the CSS via JS on `app.lobby-connect.com/admin` and measuring before committing: stretched 1131px → self-start **314px, top y=758** (Properties top also y=758 → tops align).

### Decision history (Kumar drove; each option live-previewed on prod via JS before any commit)
- **Option A — content-height (`lg:self-start`, 314px)** ✅ **CHOSEN.** Kumar: *"there is a reason I liked it from the start."*
- Option B — `lg:self-start lg:min-h-[20.75rem]` (374px = a **one-property Properties card** height; root font is 18px at `lg`, so 20.75rem ≈ 373.5px). Tried, then a `justify-center` (whole-card centre) and a faces-only `lg:my-auto` (label pinned top, faces centred beneath) variant. All **rejected** — "looked a little off"; A was the winner.
- ⚠ **Do NOT re-stretch the clocks card or drop its `self-start`** — either brings the ~800px dead space back. The subgrid's `<main>`/`<aside>` MUST keep the default stretch (they span both rows); only the clocks **card** opts out. Both files carry comments saying so.

## The right-column saga is RESOLVED (context so nobody re-opens it)
This column failed 3+ times ([[call-controls-column-polish]], [[dashboard-layout-rework-deferred]], [[duty-column-polish]]): `mt-auto` stretch (clocks to page bottom), natural stack (trailed), then PR #50's **`lg:sticky` rail** (`252b9bd`) — which the merged-duty-rail work (`25a7cb0`/`bda389f`) **superseded** with the subgrid (sticky can't coexist with a full-height row-aligned rail). Final, stable answer = **subgrid for top-alignment + clocks `self-start` for content-height.** Note the **DutyCard (row 1) still stretches** to the Tonight-card height (Kumar OK with it); I offered to un-stretch it the same way and he did not take it — **leave it unless he asks.**

## Still-pending prod smoke — CONFIRM WITH KUMAR before starting Batch 4
Per the pre-rail handoff `docs/handoffs/2026-07-22-uiux-batch2-3-and-card-shipped-smoke-pending-handoff.md`, two merges were awaiting Kumar's smoke and I have **no record they cleared** (the duty-rail work came after and didn't mention them):
- **#50 (Batch 3, `252b9bd`):** the **sticky-rail item is now MOOT** (subgrid replaced it), but **"Covering" label** on the fleet toggle + **phone-health removal** (`/admin/phone-health` should 404; 3 pulse tiles) still stand → confirm.
- **#51 (property card, `8f7d34d`):** property **local time** before the state + **"Standing by"** idle label. ⚠ "Standing by" may over-claim readiness for an *off-duty* property — **"Clear" is a one-token swap** at `STATE_LINE.quiet` in `apps/portal/components/dashboard/property-card.tsx`.
- **Merged duty rail ★ (if not already):** the softphone's Twilio `Device` must **persist across `/admin → /admin/users → /admin`** (structurally guaranteed — the aside is display-toggled, never unmounted — but the real gate is a live nav; ideally answer a test call). The clocks fix this session doesn't touch that path.

## RESUME POINT — UI/UX Batch 4 (Copy)
The whole-app UI/UX polish is a 5-batch plan (`docs/plans/2026-07-21-uiux-polish.md`; Batches 1–3 shipped). **Batch 4 is scope-only at plan line 149 and gets its own just-in-time plan** (mirror Batches 2/3, which have dedicated `2026-07-22-uiux-polish-batch{2,3}-*.md` plans). Copy guide: **`docs/brand/ui-copy-guide.md`**. Lead rule: **"talk to the person, not the interface."**

Scope (plan line 149): run `impeccable clarify` against the copy guide, leading with the **manual-speak / state-narration** class (softphone idle, the Covering line, "Your line is offline", empty-state narration); **centralize strings into `lib/copy.ts` + the kiosk mirror**; **purge em dashes** (the null-`—` cell placeholder is exempt); **unify terminology to "Property."** Plus **four factual fixes:**
1. **Capped 12h → 10h** in `shifts-table.tsx` (the real cap is `MAX_SHIFT_MS = 10h`).
2. **Forgot-password reword** — replace the dead email-reset form's false promise. **Kumar already decided the direction: "point to admin"** (email is dormant).
3. **Kiosk recording note** — recording was removed in v1; the note is stale.
4. **users-table raw-enum humanization** (role/status shown as raw enums).

**Progress already banked (from the pre-rail session):** the **copy change-site inventory is DONE** (all narration / em-dash / terminology sites + the 4 factual fixes located), and the forgot-password direction is decided (above). Re-locate the sites quickly (they weren't written to a file) and go.

After Batch 4: **Batch 5 — Consolidation + housekeeping** (plan line 150): `Toggle`/`Tabs`/`StatusBadge` primitives, flatten nested cards, delete dead code (`line-beacon`, `greeting-line`, `CallControlTray`), and **`git clean` the 16 `" 2.tsx"/" 2.ts"` dupes.**

## Method / gotchas (unchanged — keep using)
- **Subagent-driven TDD:** fresh implementer (sonnet) + combined spec+quality reviewer (sonnet) per task; opus whole-branch per batch; branch → PR → `gh pr checks <n> --watch` → Kumar merges (auto-deploys prod) → Kumar smokes.
- **Test gates:** component tests need the jsdom config — `pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>` (a bare `-F @lc/portal test <substr>` mis-passes args to the compound script). Lib tests: `pnpm -F @lc/portal exec vitest run <substr>`. **`@testing-library/jest-dom` is NOT installed** — `.toBeTruthy()`/`.not.toBeNull()`, never `.toBeInTheDocument()`. `check:routes` is a **root** script.
- **Build/typecheck gotchas:** the untracked `" 2.tsx"` dupes spawn `.next/types/* 2.ts` stale dupes that break typecheck/build → `find apps/portal/.next/types -name "* 2.ts" -delete` first. A stray `.claude/worktrees/` checkout trips root `eslint .` → verify with `pnpm exec eslint . --ignore-pattern ".claude/**"` or per-package lint.
- **Regression guards stay byte-identical:** 911 machinery, notes handlers, `handleConnect`, softphone accept-gate. jsdom can't judge pixels — **live smoke on prod is the real gate** for any layout/visual change (this session's clocks fix was validated by live JS injection + measurement, not jsdom).

## Housekeeping
- `main` = `0154ea5`. No open branches from this session (committed straight to `main`, project trunk-flow for a small fix).
- Untracked and staying that way (Kumar's; Batch 5 `git clean`s the dupes): the 16 `" 2.tsx"/" 2.ts"` dupes, `analysis-and-audit-2026_07_11/`, `polish-mock.png`, and the handoff docs (incl. this one — **left untracked to avoid a redundant docs-only prod deploy**; commit whenever convenient).
- Memory updated: `merged-duty-rail.md` (clocks tile finalized to content-height) + this handoff pointer.
