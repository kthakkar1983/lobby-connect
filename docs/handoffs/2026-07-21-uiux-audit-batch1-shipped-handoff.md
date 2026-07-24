# Handoff — Whole-app UI/UX audit + Batch 1 SHIPPED to prod; smoke pending; Batches 2–5 remaining (2026-07-21)

**START HERE** for the next chat.

## TL;DR
Ran a whole-app UI/UX audit (6 parallel agents via the `impeccable` skill), locked the decisions with Kumar, wrote an enforceable UI-copy style guide and a 5-batch implementation plan, then **built + merged Batch 1 (button consistency) to prod** — subagent-driven TDD, per-task review + opus whole-branch = SHIP, CI green. **PR [#47](https://github.com/kthakkar1983/lobby-connect/pull/47) merged, `main` = `e23da69`, Coolify auto-deploying `lc-portal-prod` + `lc-kiosk-prod`.** The one open action is the **live smoke** (Kumar, on prod).

## What shipped (all on `main`/prod)
- **Audit:** `docs/audits/2026-07-20-whole-app-uiux-audit.md` — no P0; foundation strong; the work is reconciliation not redesign; every agent converged on "the shared primitive set is incomplete so call-sites improvise." Includes the sticky-rail answer to the dashboard column and 4 factual defects.
- **UI-copy style guide:** `docs/brand/ui-copy-guide.md` — the enforceable anchor. Lead principle: **talk to the person, not about the interface** (Kumar's "reads like a technical manual" concern — softphone idle "Incoming calls ring here.", chart "Calls you handle will chart here…"). Also: signals/labels overclaiming (Phone-health), terminology glossary, no em dashes, sentence case, numbers-must-be-true.
- **Plan:** `docs/plans/2026-07-21-uiux-polish.md` — Batch 1 detailed to task level; Batches 2–5 scoped (each gets its own plan just-in-time).
- **Batch 1 code (4 tasks):** `a8901d5` button icon size (`sm`/`default` → `size-3.5` to match `text-sm`) · `1f560a0` equal-width Connect/Kiosk (`grid-cols-2` + `w-full`) · `0319fab` unify in-call toggle widths (`w-36`) + captions icon 16→14 · `fee6d67` kiosk control-bar `items-end`→`items-center` + fixed `w-16` label column. Zero migrations/routes/RLS. **Regression guards byte-untouched** (911 machinery, notes handlers, `handleConnect`, `softphone.tsx:587` accept-gate — none in the diff). Portal 439 + kiosk 78 tests green.

## IMMEDIATE NEXT ACTION — smoke Batch 1 on prod
jsdom has no layout engine, so this is the real visual check (the standing house lesson):
- **Dashboard (no call):** property-card icons match their labels (not oversized); **Connect/Kiosk equal width**; nav rail + "New property" icons not oversized.
- **One test video call:** agent in-call bar — Mute/Camera/Captions all one width (`w-36`), icons 14px, End call blaze far-right; **kiosk in-call bar** — no sideways jump when muting / toggling camera, controls centered.
- **Minor to watch:** the captions labelled icon is a fixed 14px while its Mute/Camera neighbors are rem-based (~15.75px at the `lg` scale agents use) → reads ~1.75px smaller. If visible, the fix is a rem-based icon (`className="size-3.5"` instead of `size={14}`) in `caption-toggle.tsx`, per that file's own "rem not px" rule.
- **Rollback if bad:** `git revert -m 1 e23da69 && git push` (Coolify redeploys the prior build). Changes are class-only, so worst case is cosmetic.

## What's next — Batches 2–5 (detail each into its own plan just-in-time)
1. ~~Button consistency~~ **DONE (this session).**
2. **Accessibility** — `focus-visible:ring-2 ring-ring` on every hand-rolled control **incl. both 911 buttons** (`audio-call-overlay.tsx:189`, `call-tile.tsx:229`), tile controls, `CaptionToggle`, softphone Accepting/Go-on-duty, auth submit buttons, owner row/card links, recent-call expand, password toggle; `focus:`→`focus-visible:` on dialog/sheet close. Text/`sr-only` on color-only status (team-on-now presence, status page, owner bottom-nav active). Owner min-44px touch targets + `env(safe-area-inset-bottom)`. Reduced-motion FloatingPaths → full static lines (both apps).
3. **Dashboard layout** — sticky operator rail (`lg:self-start lg:sticky lg:top-6` on the workspace aside); visible **Covering** label on fleet cards; **remove the Phone-health tile + `/admin/phone-health` page + `lib/dashboard/phone-health.ts` (+ tests)** and expand the 3 remaining pulse tiles; optional compact header-band strip. (This is where the dashboard right-column dead-space finally gets fixed.)
4. **Copy** — `impeccable clarify` against the copy guide, **leading with the manual-speak / state-narration class**; em-dash purge; terminology → "Property"; factual fixes (Capped 12h→10h, forgot-password reword, kiosk recording note, users-table enum humanization).
5. **Consolidation + housekeeping** — `Toggle`/`Tabs`/`StatusBadge` primitives + migrate the hand-rolled toggles/tabs/pills; unify CRUD shapes + container/radius; flatten nested cards; delete dead code (`line-beacon`, `greeting-line`, `CallControlTray`); `git clean` the 16 `" 2.tsx"` dupes; fix the stale `property-action-button.test.tsx:436` comment (references `sm`'s old `size-4`); consider a `ButtonGroup` primitive if the equal-width pattern recurred.

## Locked decisions (the spec — don't relitigate)
**6 director:** em-dash purge · side-stripe ban lifted for the status-edge pattern only · Raleway `font-display` + ≥500 on title slots · sticky rail for the column · incidents one tint, keep the red 911 chip, drop the duplicate blaze siren · in-call End-call isolation = 1px divider.
**2 copy:** terminology → **"Property"** everywhere (guest still sees the real name) · **Phone-health tile + page REMOVED** (it fires only on FAILED calls, not missed; already visible under Calls › Failed; 3 pulse tiles expand).

## Method notes (worked well; reuse)
- **Subagent-driven:** implementer (sonnet) + ONE combined spec+quality reviewer (sonnet) per task + **opus whole-branch review** at the end. Provide the full task text in the prompt (don't make subagents read the plan file). Reviewers verify independently (they even browser-measured Task 2).
- **Gates: per-package** (`pnpm -F @lc/portal test|typecheck|lint|build`, `pnpm -F @lc/kiosk test|build`). NOT root `pnpm lint` — a stray `.claude/worktrees/` checkout breaks root eslint with phantom `no-undef`.
- **Ship flow:** branch → `git push` → `gh pr create` → **wait for CI green** (`gh pr checks <n> --watch`) → `gh pr merge --merge` → Coolify auto-deploys.
- jsdom proves classNames, never pixels → the **live smoke is the visual gate** for every batch.

## Git / housekeeping state
- `main` = `e23da69` (Batch 1). Local `main` fast-forwarded; working tree is on `main`.
- Branch `uiux-polish` merged, **un-deleted** (delete when convenient: `git push origin --delete uiux-polish && git branch -d uiux-polish`).
- 16 untracked `" 2.tsx"`/`" 2.ts"` strays still floating (Batch 5 housekeeping: `git clean -n` to preview, then `git clean -f`).
- A stray side-session worktree under `.claude/worktrees/` breaks root eslint (known — use per-package lint).
