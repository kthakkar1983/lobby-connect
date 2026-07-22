# Handoff — call-controls + column polish SHIPPED; dashboard right-column layout STILL OPEN (2026-07-20)

**START HERE** for the next session. The call-control-consistency + dashboard-column-polish batch is built, reviewed (whole-branch opus = SHIP), merged, and **deployed to box-prod**. During Kumar's live smoke, the **dashboard right-column layout is still wrong after two attempts** — that is the one open item. Do NOT make a third blind guess: see §2.

## 1. What shipped (done + deployed)

- **PR [#45](https://github.com/kthakkar1983/lobby-connect/pull/45)** (merge `ba19b7a`) — the full batch, subagent-driven TDD (11 tasks, per-task spec + code-quality review, whole-branch opus SHIP). Gate at merge: portal node 880 / jsdom 436, kiosk 74, typecheck/lint/check:routes/build. All 4 regression guards byte-identical (911 / notes / handleConnect / accept-gate). Items A–I + §9 per `docs/specs/2026-07-20-call-controls-and-column-polish-design.md`:
  - In-call bars unified to `Connect · Mute · [Camera/Video-Chat] · Captions · End call` (Connect/End bookends); **blaze End call on all three** (video off navy); audio reopen → round mint call-card corner icon; Video/Chat tile toggle fills flush; property-card `Answer` gets a `Phone` icon; softphone `LinePill` → "Off duty" off duty; captions async `stopRecognition` `.catch()`; kiosk control-pill `px-4`; contrast/comment reconciliation (incl. toggle contrast docblocks recomputed for the `bg-card` surface).
- **PR [#46](https://github.com/kthakkar1983/lobby-connect/pull/46)** (merge `36c0b7d`) — post-deploy smoke fixes:
  - **Kiosk button**: offline kiosks keep the **"Kiosk" label + icon, greyed** (was swapping to "Kiosk offline"); reason rides the hover title. Dropped `unavailableLabel` in `kiosk-call-button.tsx` (the prop stays defined in `property-action-button.tsx`, now unused). **Kumar has not re-confirmed this one yet — verify on next smoke.**
  - **Clocks overshoot** (attempt #2, still wrong — see §2).

## 2. THE OPEN ITEM — dashboard right-column layout (agent + admin home)

The right-column aside is `Softphone → Shift → Clocks` (+ headless `VideoCallHost`), in `apps/portal/components/dashboard-workspace.tsx`, grid `lg:grid-cols-[minmax(0,1fr)_340px]`. Kumar wants the right-column tiles to read as **aligned/balanced with the left column** (softphone+shift ≈ the left's top block; clocks ≈ the properties board). **Two code attempts, both wrong:**

1. **Task 7 (original): `items-stretch` + aside `h-full` + clocks `mt-auto`.** OVER-SHOT — the aside stretches to the *full* main-column height (which includes the whole properties board + recent calls), so `mt-auto` shoved the clocks to the **page bottom**, far below the properties. (This is what Kumar's first screenshots flagged.)
2. **Follow-up (PR #46): reverted to a natural top-aligned stack** (dropped stretch/h-full/mt-auto) → clocks trail right under the shift card. Kumar: **"still all kinds of wrong."**

**Why this keeps failing:** the two columns have **independent content heights**, so pixel-aligning right-column tiles to specific left-column sections is genuinely brittle — AND I've been changing it **without ever seeing the live result** (violating the standing house lesson: verify UI by LOOKING on the real thing, never by reasoning — `[[kiosk-css-animation-reverted]]`, `[[deploy-and-smoke-workflow]]`).

**What the next session MUST do (do NOT skip to a code change):**
1. **See it live.** Either drive the deployed dashboard with the browser tool against Kumar's logged-in session (Claude in Chrome), or have Kumar paste a fresh annotated screenshot of the **current** (natural-stack) state next to a precise target. Measure, don't guess.
2. **Clarify the actual target with Kumar** — this is probably a small **brainstorm/design** decision, not a one-line tweak. Open questions to resolve:
   - "Softphone + shift same height as the two left tiles" — the softphone tile **can't shrink** to a short stat-tile height (it holds the ring + "Go on duty" + copy). What does "same height" mean concretely?
   - Should the clocks be **pinned to align with the properties board** (needs a shared-row grid or a tuned magic-height — brittle), or is a clean self-contained right-column stack acceptable? Or does the whole right column want restructuring (e.g. clocks elsewhere)?
3. **Then make ONE informed change and verify it live before calling it done.**

Relevant files: `apps/portal/components/dashboard-workspace.tsx` (grid/aside), `apps/portal/components/dashboard/shift-card.tsx` (keeps `min-h-[10rem]` for off-duty stability — that part is fine and should stay), `apps/portal/components/dashboard/zone-clocks-card.tsx` (takes no `className` prop — wrap if a margin is needed). Test: `apps/portal/tests/components/dashboard-workspace.test.tsx` (currently a "no overshoot" guard — will change with the real fix).

## 3. Also still pending smoke (Kumar focused on the home column; hasn't checked these)

The **in-call surfaces** — the actual point of the batch — are unverified live: bar order + blaze End call + 911 separation on each surface; audio reopen mint corner; Video/Chat teal flush fill; nothing wrapping in the 380px tile; kiosk control-pill spacing on the real tablet. Two smoke-tuned values may want a nudge: kiosk `px-4`, and (once the layout is settled) any shift-card min-height.

## 4. Housekeeping state

- **Branches** `call-controls-column-polish` and `call-controls-column-polish-followup` are both **merged to `main`**, left un-deleted (delete when convenient: `git branch -d` + `git push origin --delete`). This handoff is committed on the followup branch.
- **16 untracked `"… 2.tsx"/"… 2.ts"` dupes** are stale pre-batch snapshots (safe: `git clean -f -- 'apps/portal/**/* 2.tsx' 'apps/portal/**/* 2.ts'`, preview `-n` first). Left in place (Kumar's untracked files).
- ⚠ **A side-session (`task_334dd625`, spawned by the Task-4 fix agent, still running) keeps RE-CREATING a worktree on branch `claude/goofy-hertz-c9ca0f` under `.claude/worktrees/`.** It breaks root `pnpm lint` with phantom `no-undef` errors on that worktree's `.mjs`/`push-sw.js`. IGNORE it — per-package lint + `eslint . --ignore-pattern ".claude/**"` are clean, and CI's clean checkout is unaffected. Removing the worktree is pointless (it respawns). It should stop once that session ends. See `[[build-quirks]]`.
- **`CallControlTray`** is now dead code (zero callers after the bar reorder) but deliberately kept + documented as unused — possible future deletion.

## 5. Reference

Spec `docs/specs/2026-07-20-call-controls-and-column-polish-design.md` · plan `docs/plans/2026-07-20-call-controls-and-column-polish.md` · prior handoff `docs/handoffs/2026-07-20-call-controls-and-column-polish-spec-and-plan-handoff.md` · predecessor batch `[[duty-column-polish]]`.
