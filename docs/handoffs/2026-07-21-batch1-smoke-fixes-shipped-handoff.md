# Handoff — UI/UX Batch-1 smoke fixes SHIPPED + prod-smoked PASS; captions were a false alarm; Batches 2–5 remain (2026-07-21)

**START HERE** for the next chat. Supersedes `docs/handoffs/2026-07-21-uiux-audit-batch1-shipped-handoff.md` (that one's context — the whole-app audit + copy guide + 5-batch plan — is still valid; this one carries the state forward).

## TL;DR
Kumar smoked Batch 1 (PR #47) on prod and found 4 minor items. This session built + reviewed + shipped all 4 as **PR [#48](https://github.com/kthakkar1983/lobby-connect/pull/48)** (`main` = `5f8e818`, Coolify auto-deployed both prod apps), and **Kumar re-smoked on prod — all 4 working.** A reported "captions broken" turned out to be a **false alarm** (muted mic during the test — nothing to transcribe; see below, don't re-chase it). Next up: **Batches 2–5** of the UI/UX polish plan.

## What shipped (PR #48, `ce374eb`, merged to `main` `5f8e818`)
Follow-up to Batch 1 from the live smoke — 4 items, TDD, one `feature-dev:code-reviewer` whole-diff pass, all gates green. Zero migrations/routes/RLS. In-call regression guards (911, notes, `handleConnect`, softphone accept-gate `softphone.tsx:587`) byte-untouched.

1. **"New property" button icon shrank.** Batch 1's `[&_svg:not([class*='size-'])]:size-3.5` on the button `default`/`sm` sizes did NOT exclude the toolbar button's `h-4 w-4` icon (no `size-` substring), so it shrank 16→14px while its empty-state twin (`size-4`) stayed 16px. Fixed → `size-4`, dropped redundant `mr-2`. **⚠ GOTCHA:** an icon written `h-4 w-4` (not `size-*`) is NOT protected from that shrink selector — always size button icons with `size-*`. (`properties-table.tsx`)
2. **Answer/Silence didn't align with Connect/Kiosk.** The ringing action row was a `flex` (content-width) vs the Connect/Kiosk `grid-cols-2` (equal cols). Fixed → both rows full-width `grid-cols-2` (true 2×2); `Silence` pinned **`col-start-2`** (review caught: the lone-Silence admin-not-covering case would auto-place under Connect). The `h-8` reservation/geometry invariant is preserved. **Judgment call (Kumar accepted on smoke):** full-width means a very wide single-property card gets large buttons — trivially cappable if it ever bothers. (`property-card.tsx`, `pod-card-grid.tsx`)
3. **PiP tile → icon-only round; kiosk End Call → blaze.** New local `TileIconButton` (round "ghost outline") for Mute/Camera/Chat/Captions; End call → round **blaze** icon; Connect keeps its label + teal. Segmented **Video|Chat → single round Chat toggle** (teal when active + unread dot) — **judgment call, Kumar accepted.** Captions is hand-rolled as a `TileIconButton` (its pressed recipe `bg-accent/10 text-accent` = `CaptionToggle`'s enabled recipe, so navy contrast is preserved). Kiosk `variant="end"` fill `bg-card text-call` → `bg-attention text-attention-foreground` (blaze ≠ red; no kiosk 911). (`call-tile.tsx`, kiosk `CallControls.tsx`)
4. **Camera-off added to the tile.** `RegisteredCallControls` gained optional `toggleCamera?`/`cameraOff?`; `video-call.tsx` registers them (+`cameraOff` in that register-effect's deps so the mirror stays live); the tile renders a Camera round-button **VIDEO-only** (audio softphone registers no camera). Mirrors the existing chat/911 optional-controls seam. (`call-surface-provider.tsx`, `video-call.tsx`, `call-tile.tsx`)

**Gates:** portal 880 node + 447 jsdom + kiosk 79 tests · typecheck · lint · build — green both apps. **Prod smoke: PASS** (all 4 Kumar-verified). Rollback if ever needed: `git revert -m 1 5f8e818 && git push`.

## ⚠ The "captions broken" scare — FALSE ALARM, do not re-chase
During smoke Kumar reported captions not working. Full systematic trace concluded **PR #48 cannot have caused it** — my only caption change was the tile's toggle *button* (`CaptionToggle` → `TileIconButton`), which still calls the same `toggleCaptions` (test-proven); the entire STT/token/publish path (`softphone.tsx:312` / `video-call.tsx:201` `useCaptions` → `/api/captions/token` → Speechmatics → `publishCaptions` → band) is byte-untouched. **Root cause: Kumar's mic was muted during the test** — captions transcribe the *guest's* audio, so a muted guest mic = nothing to transcribe. Captions confirmed working. (Latent note, NOT acted on — Kumar declined: the token route 503s silently on a missing `SPEECHMATICS_API_KEY` and `useCaptions` swallows it to `status:"error"` with no UI. If captions ever ARE dead on prod, the first check is `SPEECHMATICS_API_KEY` on `lc-portal-prod` in Coolify — it was a cutover to-do never in the "verified live" list, and the value lives in `.env.local` / Vercel prod env / Coolify staging per the credentials register. A "Captions unavailable" surface for `status:"error"` is an available-but-declined defensive follow-up.)

## Method notes (worked well)
- **Direct TDD** (not subagent-driven — small batch) + **one `feature-dev:code-reviewer` whole-diff review** — it caught the real lone-Silence `col-start-2` bug, else clean.
- **Visual pre-verified with a static-HTML mock screenshotted via the Playwright MCP** (`mcp__plugin_playwright_playwright__*`). The in-app browser (`mcp__Claude_Browser__*`) **blocks localhost by policy and hung on `file://`** — Playwright MCP handled both; save screenshots under the repo's `.playwright-mcp/` (its only allowed write root) then Read them. The tile/fleet-board can't be seen live without a call/auth, so the faithful mock honored the look-don't-guess house lesson before shipping.
- **Per-package gates** (`pnpm -F @lc/portal test|typecheck|lint|build`, `pnpm -F @lc/kiosk ...`); component tests run under **`vitest.jsdom.config.ts`** (the default vitest config EXCLUDES `tests/components/**`). Per-package `lint` skips `tests/` — lint changed test files explicitly (`pnpm -F @lc/portal exec eslint tests/...`).
- **Ship flow:** branch → push → `gh pr create` → `gh pr checks <n> --watch` → `gh pr merge --merge` → Coolify auto-deploys.

## What's next — Batches 2–5 (detail each into its own just-in-time plan)
Per the audit + plan (`docs/plans/2026-07-21-uiux-polish.md`). Locked decisions in the prior handoff / the `uiux-polish-batch1` memory — don't relitigate.
1. ~~Buttons~~ **DONE** (Batch 1 + these smoke fixes).
2. **Accessibility** — `focus-visible:ring` on hand-rolled controls incl. both 911 buttons + the new tile `TileIconButton`s + `CaptionToggle` + auth submits + owner links; text/`sr-only` on color-only status; owner 44px touch targets + safe-area; reduced-motion FloatingPaths → full static.
3. **Dashboard layout** — sticky operator rail (`lg:self-start lg:sticky lg:top-6`); visible **Covering** label on fleet cards; **remove the Phone-health tile + `/admin/phone-health` + `lib/dashboard/phone-health.ts`**; expand the 3 remaining pulse tiles. (Finally fixes the dead right-column dead-space — see `[[dashboard-layout-rework-deferred]]`.)
4. **Copy** — `impeccable clarify` against `docs/brand/ui-copy-guide.md`, lead rule **"talk to the person, not the interface"**; em-dash purge; terminology → "Property"; factual fixes (Capped 12h→10h, forgot-password, kiosk recording note, users-table enums).
5. **Consolidation** — `Toggle`/`Tabs`/`StatusBadge` primitives + migrate hand-rolled toggles/tabs/pills; unify CRUD shapes/container/radius; flatten nested cards; delete dead code (`line-beacon`, `greeting-line`, `CallControlTray`); `git clean` the 16 `" 2.tsx"` dupes; consider a `ButtonGroup` primitive (the equal-width `grid-cols-2` pattern now recurs on the property cards + Batch-1 wrappers).

## Git / housekeeping state
- `main` = `5f8e818`. Local working tree is on `main` (fast-forwarded).
- Branch `uiux-polish-batch1-smoke-fixes` merged, **un-deleted** (delete when convenient).
- Untracked strays persist (Kumar's — Batch-5 housekeeping): the 16 `" 2.tsx"`/`" 2.ts"` dupes, `analysis-and-audit-2026_07_11/`, `polish-mock.png`, the prior handoff docs.
- A stray `.claude/worktrees/` checkout still breaks root `eslint .` — use per-package lint (CI's clean checkout is unaffected).

## Key references
- Plan: `docs/plans/2026-07-21-uiux-polish.md` · Audit: `docs/audits/2026-07-20-whole-app-uiux-audit.md` · Copy guide: `docs/brand/ui-copy-guide.md`
- This session's ship: PR [#48](https://github.com/kthakkar1983/lobby-connect/pull/48) (`ce374eb`) → `main` `5f8e818`
- Memory: `uiux-polish-batch1` (canonical status) · related `[[call-controls-column-polish]]`, `[[dashboard-layout-rework-deferred]]`, `[[wcag-enabled-control-exemption]]`, `[[deploy-and-smoke-workflow]]`
