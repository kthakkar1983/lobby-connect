# Handoff — Merged Duty rail (Proposal B) SHIPPED + live-tuning; Chrome verify pending (2026-07-23)

**START HERE.** The dashboard right-rail restagger is BUILT, MERGED, and DEPLOYED to prod. `main` = **`bda389f`**. Kumar's first-glance on prod = "looks ok." **First action in the new chat: open Kumar's logged-in Chrome (`claude-in-chrome`) to `app.lobby-connect.com/admin` (and `/agent`) and do the real live-verify** (checklist below) — jsdom can't judge pixels, and the softphone-Device no-remount is the one regression that would silently drop the phone line.

## What shipped (two prod deploys today)

The agent/admin dashboard right rail was **merged + aligned** (Proposal B), ending the 3×-failed right-column stagger ([[call-controls-column-polish]] "STILL OPEN", [[dashboard-layout-rework-deferred]], [[duty-column-polish]]).

1. **Merge `25a7cb0`** — the feature. Softphone-idle card + shift card merged into ONE `DutyCard` (`components/dashboard/duty-card.tsx` = `<Card>` wrapping `<Softphone chromeless/>` + divider + `<ShiftCard chromeless/>`). Home layout on a shared **2-row CSS subgrid**: the grid wrapper is 2 rows; `<main>` + `<aside>` each `lg:grid lg:grid-rows-subgrid lg:row-span-2`, so `<main>`'s two page groups and the rail's two tiles (DutyCard row 1, Clocks row 2) land on the SAME row lines → edges align **by construction**. Each home page (`admin/page.tsx`, `agent/page.tsx`) split into two `<div className="flex flex-col gap-4">` groups (admin splits after Tonight; agent after Stats). `lg:sticky` rail REMOVED (a full-height aligned rail can't be sticky; it now scrolls with the page).
2. **Merge `bda389f`** — tuning from Kumar's live smoke (three fixes):
   - **THE gap fix:** the grid wrapper was `lg:grid-rows-2` (= `repeat(2, 1fr)`), which **equalized** the two rows to the taller one, opening a huge empty gap under the short Duty/Clocks tiles. Changed to **`lg:grid-rows-[auto_auto]`** (content-sized rows) → gaps gone, Clocks pull up level with Properties. ⚠ **the standalone subgrid check used `auto auto` and aligned perfectly; the plan mis-specified `grid-rows-2` — do NOT regress to it.**
   - **Softphone header dropped in chromeless** — the "SOFTPHONE" label + line pill are gone inside the DutyCard (redundant; duty/line state reads from the ring + shift row). `softphone.tsx` wraps the header in `{!chromeless && …}`; `softphone.test.tsx` chromeless test updated (header now ABSENT in chromeless, default keeps it).
   - **`shadow-md` on both right cards** (`DutyCard` + `ZoneClocksCard`) to match the page cards.

Zero migrations / API routes / RLS. Built subagent-driven (T1-T5 + a `items-*` guard fast-follow), per-task spec+quality reviews, **opus whole-branch = SHIP**. Plan: `docs/plans/2026-07-23-merged-duty-rail.md`.

## Live-verify checklist (do this on Chrome, admin + agent, off AND on duty)

1. **Alignment:** DutyCard bottom edge ‖ Tonight card bottom (admin) / chart bottom (agent); Clocks ‖ Properties/bottom row; NO floating edges; rail runs full height (no dead-end). Clocks top-aligned (top 2 faces visible, rest below fold = intended).
2. **★ THE regression check — phone line persists:** navigate `/admin → /admin/users → /admin`. The softphone must **NOT** reconnect/drop (Twilio Device is instance-local; a remount re-registers it). Ideally answer a test call — accept-gate, notes, 911 dialog all work as before.
3. **Duty transitions:** Go on duty → the DutyCard fills (Line ready + timer + "On duty since" + Break / End shift). Break / Resume / End shift — the card must not collapse or jump.
4. **Chrome:** both right cards have `shadow-md`; NO "SOFTPHONE" header; mobile/narrow stacks cleanly.

## Not-yet-done / candidate nits (decide on the live look)

- DutyCard internal balance (center the ring vs. pin the shift below the divider) was **deferred** — the card is short so it's probably fine; eyeball it.
- Off-duty the DutyCard/Clocks may still read a touch airy (stretched to row height) — Kumar OK'd the clock length ("falls below fold, which is good"); confirm the Duty card looks intentional too.

## Safety invariant (CARRY FORWARD — a miss silently drops the phone line)

The softphone's **Twilio Device is instance-local to `<Softphone>`** → a remount destroys+re-registers it. `DutyCard` MUST stay a **plain** component (no `React.memo`/`Suspense`/`lazy`, no `key` on `<Softphone>`), rendered **unconditionally** in the always-mounted `<aside>` (toggles only `className`→`"hidden"` off-home). NO memo/Suspense between `DutyProvider` (app-shell.tsx) and the softphone. Verified end-to-end by the whole-branch review.

## Key files

`components/dashboard/duty-card.tsx` (NEW) · `dashboard-workspace.tsx` (subgrid + `grid-rows-[auto_auto]`) · `softphone.tsx` + `dashboard/shift-card.tsx` (`chromeless` prop) · `dashboard/zone-clocks-card.tsx` (shadow) · `app/(admin)/admin/page.tsx` + `app/(agent)/agent/page.tsx` (2-group split). Design mockup (Proposal B): `scratchpad/dashboard-layout-mockup.html` (server was killed).

## Gotchas reused this session (see [[build-quirks]])

- Subgrid rows MUST be `grid-rows-[auto_auto]`, NOT `grid-rows-2` (1fr equalizes → gaps).
- Stray `.claude/worktrees/trusting-solomon-5f3b97` poisons root `pnpm lint` (~39 `no-undef`) → verify with `pnpm exec eslint . --ignore-pattern ".claude/**"`.
- `.next/types/* 2.ts` stale dupes (from the untracked `" 2.tsx"` files) break `typecheck`/`build` → `find apps/portal/.next/types -name "* 2.ts" -delete` first.
- No `@testing-library/jest-dom` (`.toBeTruthy()`, not `.toBeInTheDocument()`); component tests need `--config vitest.jsdom.config.ts`.

## THE BROADER PENDING AGENDA (paused for the rail)

Before the rail question, this session had **started Batch 4 — Copy** of the whole-app UI/UX polish (`docs/plans/2026-07-21-uiux-polish.md`, guide `docs/brand/ui-copy-guide.md`). Progress already made: the **copy change-site inventory is DONE** (all the narration/em-dash/terminology sites + the 4 factual fixes located), and Kumar **decided the forgot-password reword = "point to admin"** (replace the dead email form; email is dormant). **Resume Batch 4 after the rail verifies.** Then Batch 5 (consolidation + the `" 2.tsx"` dupe cleanup). Parent handoff (pre-rail): `docs/handoffs/2026-07-22-uiux-batch2-3-and-card-shipped-smoke-pending-handoff.md`.

## Rollback

`git revert -m 1 bda389f && git push` (tuning) and/or `git revert -m 1 25a7cb0 && git push` (whole feature) — instant, additive-only, prod redeploys.
