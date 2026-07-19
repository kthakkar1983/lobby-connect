# Handoff — duty column + call-surface polish: MERGED to main, prod DEPLOYING, smoke pending (2026-07-19)

**START HERE.** The 17-task plan is built, reviewed, and **MERGED to `main` + pushed** (Kumar authorized). Coolify is auto-deploying box-prod now. **Task 17 is the prod smoke — Kumar runs it and returns with findings in a new chat.**

- **`main` = `dfc8700`** (merge commit), pushed to `origin/main`. The feature branch `duty-column-polish` (HEAD `6e57c17`) is merged; its local ref can be pruned whenever.
- **Integrated main's deep-text token darkening** (`1ef6ee8`, the `task_b16b5418` fix from a parallel session): my branch was cut at `2bcb899` before it landed. **Clean merge, zero file overlap** — and it *resolved the two sub-AA contrast items this work had deferred* (softphone accepting pill was 4.03:1, video warning banners), because they are exactly the "colored text on a same-hue tint" case that fix targets. No dark-surface regression: my dark-surface fixes used unchanged *fill* tokens. Three of my contrast comments cited pre-merge token values as current fact — reconciled in `6e57c17` (dropped a stale hex, dated the ratios; decisions unchanged, deep-text tokens still fail on those surfaces even after darkening).
- **Rollback if the smoke fails badly:** `git revert -m 1 dfc8700 && git push` (Coolify redeploys the prior build), or roll back the Coolify deployment. The frozen Vercel/Agora standby (flip Twilio + tablet back) remains the nuclear option for a total box failure — but it runs pre-this-change Agora code.
- **Spec:** [`docs/specs/2026-07-19-duty-column-and-call-surface-polish-design.md`](../specs/2026-07-19-duty-column-and-call-surface-polish-design.md)
- **Plan:** [`docs/plans/2026-07-19-duty-column-and-call-surface-polish.md`](../plans/2026-07-19-duty-column-and-call-surface-polish.md)
- **⚠ Corrections (OVERRIDES the plan):** [`docs/plans/2026-07-19-duty-column-polish-CORRECTIONS.md`](../plans/2026-07-19-duty-column-polish-CORRECTIONS.md) — the plan could not be run literally; this file is why.
- **Predecessor handoff:** [`2026-07-19-duty-column-polish-spec-and-plan-handoff.md`](2026-07-19-duty-column-polish-spec-and-plan-handoff.md)

## Gate (independently verified on the merged tree at `dfc8700`, not just agent claims)

| Check | Result |
|---|---|
| node vitest | **879 / 127** (includes the merged-in token-contrast tests) |
| jsdom vitest | **420 / 34** |
| typecheck · lint · check:routes · build | OK · OK · OK · OK |
| this branch's own `supabase/` + `apps/kiosk/` diff | **empty** (zero-migration holds; the one `apps/kiosk/src/index.css` change on `main` is the merged token work, already deployed) |
| 911 `<AlertDialog>` block vs pre-branch | **byte-identical** (whitespace-normalized diff empty) |
| `lib/remote-access/connect.ts` | **untouched**; `launch-rustdesk.test.ts` 2/2 green |
| hardcoded hex / `as any` / `@ts-ignore` in code | **none** (only inside contrast-calc comments) |

**~+240 tests over the pre-work baseline (node 835/jsdom 241), zero regressions.** Two gotchas hit while integrating and fixed: the merged `competent-williamson-20dc08` **worktree left inside `.claude/worktrees/` broke root `eslint .`** (pruned — that worktree is gone), and `check:routes` does a naive `line.includes("as never")` scan that a reworded comment ("h**as never** rendered") tripped (reworded).

## How it was built

Scout-first, then five subagent-driven Workflow phases (A–F), **two adversarial reviews per task + a verify-before-fixing loop**, closed by a four-lens whole-branch review (life-safety / regression / quality / a11y) and an independent SHIP synthesis. ~14M subagent tokens. The review depth earned its keep: it caught **two live bugs already on `main`** and roughly a dozen defects this change would otherwise have introduced — most of them green-passing, i.e. invisible to the test suite.

## What shipped (matches the spec)

- **Dashboard column:** dead 340px aside now carries a **ShiftCard** (clock, break, end-shift, mid-call rules, the re-homed notifications-blocked hint) and a **ZoneClocksCard** (four analog faces, day/night tinted). Softphone card unchanged in place.
- **Softphone ring** is the **go-on-duty control** off duty; accepting toggle reads `Not accepting calls` and routes through the guard.
- **Header emptied** of duty chrome; `DutyControl` + `DutyMenu` deleted. Absorbs both time-tracker polish items (pill-size mismatch, End-shift icon).
- **Off-duty guard:** gated controls stay **enabled and intercept** with a prompt, never HTML-`disabled`. On break it offers **Resume**, not Start-my-shift.
- **Property card:** one duty gate for Answer (both channels + the unmatched-ring fallback); four actions normalized to `h-8`; reserved ringing row so a ring never resizes the card; bottom-anchored actions.
- **Call surfaces:** shared **`<CallShell>`** (audio playbook 70%, video 60%, as explicit props); Hold/Swap removed from video; both terminating controls read **`End call`** (video navy, **audio blaze** — Kumar's call, punch-list B1 preserved); fixed-width toggles; reopen control is a round mint-outlined corner button on video / a bar button on audio.
- **Shared `PropertyActionButton`** replaces five hand-rolled Connect-shaped copies.
- **`RoomEvent.Disconnected` → Sentry** with `visibilityState`, gated on our own `leave()` flag (never on `DisconnectReason`, because the SDK's page-lifecycle path reports `CLIENT_INITIATED` identically).

## ⚠ TWO LIVE BUGS ON `main` this branch fixes incidentally

Worth knowing independently of whether you ship this branch — both are real on prod today:

1. **`goOnDuty()` fails silently** (`f2f21b7`). `ensurePushSubscription` wraps only `subscribe()`; `Notification.requestPermission()` and `pushManager.getSubscription()` are unguarded, so a rejection aborts `goOnDuty` *before* the state flip and the POST. Every caller invokes it as `void goOnDuty()`, so nothing observes it: the UI settles as "on duty" while she is still off duty and the server was never told.
2. **The go-on-duty POST response was never inspected** (`8db13e9`). A 500 / dropped connection left her reading "on duty" with the clock running while the server left her `OFFLINE` — **out of the dial set, unaware**. Now rolls the optimistic flip back; the ring reappearing is the retry affordance. Same commit adds a re-entrancy lock (a rapid double-click during the permission prompt split one night into two shift rows via `openShift`'s close-then-insert).

## The single most important build finding (corrects an earlier claim)

The three in-call Connects were believed "gate-unreachable" (a shift can't end mid-call). **False across tabs** (`89997dc`): `end-shift` flips OFFLINE with no `ON_CALL` guard, and the shift card's mid-call suppression is per-tab — so End shift in a *second* tab gates the first within a heartbeat. Task 14, by correctly moving those Connects onto the shared button, gave them a duty gate they never had — and **on the tile it withholds the click invisibly** (the prompt is an AlertDialog in the backgrounded main document). Fixed with `gate="none"` at those three sites: remoting into the hotel PC during a connected call is not an off-duty action.

## A systemic finding for spec reconciliation: D8 forfeits WCAG's inactive-element exemption

Making a control **enabled** removes WCAG's contrast exemption for inactive/decorative elements. This produced **six** separate contrast regressions during the build, each green-passing, two of them hidden behind **doc comments that falsely certified a passing ratio**:

| # | Control | Was | Needs | Commit |
|---|---|---|---|---|
| 1 | gated button labels | 4.01:1 | 4.5:1 (1.4.3) | `83a8a7e` |
| 2 | softphone ring mint boundary | 1.886:1 | 3:1 (1.4.11) | `8db13e9` |
| 3 | control-bar toggle pressed label (comment lied) | 3.81:1 | 4.5:1 | `7798147` |
| 4 | CaptionToggle in tray | 3.81:1 | 4.5:1 | `7798147` |
| 5 | reopen-button scrim | 2.33:1 worst-case | 3:1 | `3b75cce` |
| 6 | compact CaptionToggle icon on tile (comment lied "3.12:1") | 2.68 / 2.56:1 | 3:1 | `3c698c1` |

**Reconcile into D8 / §3.4:** "because these controls are enabled, every gated/greyed state must clear AA contrast; the disabled-exemption no longer applies." Also caught: an **inverted `aria-pressed`** (Camera announced "pressed" when the camera was *off*), fixed in `7798147`.

## Other spec gaps the build revealed (reconcile the spec doc)

- **§3.4 never handled the ON-BREAK state.** The gate fires whenever `!canWork`, and `canWork = onDuty && !onBreak`, so a control is intercepted on break too — but §3.4 only specifies off-duty copy. The build added a Resume-on-break variant (`1b4a156`); **without it, an on-break agent clicking a gated control would have been routed to `goOnDuty()`, which closes her live shift and inserts a second row — corrupting the timesheet shipped 2026-07-13.** Document both dialog variants.
- **§3.4's "Applies to" list omits the UnmatchedRingCards fallback Answer** (both channels), which also needed gating (corrections §3b).
- **The plan's Task-17 smoke "single most important check" encodes the wrong 911 mechanism** — "arms on first tap, fires on second" is the *tile's* two-tap (`call-tile.tsx`, never touched here). Audio's 911 is an AlertDialog (tap → confirm dialog → "Yes — call 911"). Fixed in the smoke list below.

## Deferred contrast items — RESOLVED by the token merge (`task_b16b5418`)

The two sub-AA contrasts this build flagged as deferred were fixed **app-wide** by the parallel `task_b16b5418` session (merged here as `1ef6ee8`), which darkened `--color-{live-foreground,accent-text,attention-text}` one shade so colored text clears 4.5:1 on its own same-hue tint:
- Softphone accepting-toggle **"Accepting calls"** (was 4.03:1) — fixed by the darker `--color-live-foreground`.
- `call-filters.tsx` active tab (was 3.81:1) — fixed by the darker `--color-accent-text`.

Its regression guard `tests/theme/token-contrast.test.ts` now enforces the rule and runs in this gate. **Standing rule for a new `text-*` token: it must clear 4.5:1 on its own darkest tint, not just on white** — see the `wcag-deep-text-token-on-tint` and `wcag-enabled-control-exemption` memories.

## TASK 17 — the prod smoke (yours; merging auto-deploys prod)

jsdom has **no layout engine**, so all geometry is unverified. Merge, wait for Coolify healthy, hard-refresh, then walk this — it is the *corrected* list, not the plan's:

**Dashboard**
- [ ] Off duty: ring glows and is clickable; caption `Go on duty`; sub-copy `Your line is offline.`; accepting reads `Not accepting calls`.
- [ ] Off-duty click on greyed `Connect` / `Kiosk` / accepting / card `Answer` → prompt opens; `Start my shift` starts the shift and the page comes alive; `Not yet` dismisses.
- [ ] **On BREAK**, a gated click offers **`Resume`**, not "Start my shift" / "You're off duty".
- [ ] **Offline kiosk** stays genuinely disabled (`Kiosk offline`) and does **NOT** open the prompt.
- [ ] **Double-click the ring** during the notification-permission window → exactly ONE shift row, no 0-second lapse.
- [ ] **go-on-duty POST failure** (go offline, click) → UI rolls back to off-duty, never shows her covered.
- [ ] **Error-phase clock-in:** softphone in `error` (line down) — the ring still clocks her in. Confirm this is the intended "work through an outage" behaviour.
- [ ] Shift card: clock ticks; Break/Resume/End shift work; mid-call End shift disabled ("Finish the call first"); Break hidden mid-call.
- [ ] Clocks: four analog faces; US dark / India light during a night shift.
- [ ] **Card geometry:** all pod cards equal height; a two-line name (`Holiday Inn Express Southgate`) has its buttons level with neighbours; a ring moves **nothing** below it.
- [ ] Header carries no duty chrome and doesn't look broken.

**Cross-tab**
- [ ] Two tabs, on duty; **End shift in tab A → tab B flips off-duty within ~one beat.**

**Video call**
- [ ] No Hold/Swap; `End call` (navy) ends it; toggling Mute/Camera does **not** reflow the row.
- [ ] Reopen control = round mint circle in the true bottom-right corner, not over the guest's face; caption band doesn't run under it.
- [ ] **Connect launches RustDesk and the call SURVIVES** (Phase-E regression); a forced launch failure shows its error line, uncropped, on the card and in-call.
- [ ] **Back-to-back calls:** no stale "Could not fetch credentials" from call A bleeds over call B's guest video.
- [ ] Playbook split looks right at 60/40. Confirm **no 911 control appears anywhere on video.**

**Audio call**
- [ ] Playbook visibly larger than video (70/30); `End call` is **blaze**, 911 red top-right, unmistakable.
- [ ] **911 (the #1 check, corrected):** tap `Call 911` → a confirm dialog opens → `Yes — call 911` fires; `Cancel` aborts with **no POST**. Then fire a real **933** test per existing procedure. Check the emergency-active and dispatch-failed banner copy.
- [ ] Notes save with Enter; the retry banner still appears on a forced failure.
- [ ] Reopen control sits in the control bar.

**After smoke:** record the result; if anything fails, fix on-branch and re-smoke — do not leave a known-broken prod.

## Gotchas carried forward

- **Never add `vi.mock("@/components/dashboard/duty-provider")` to `softphone.test.tsx`** — it renders the real provider on purpose; mocking it makes the `softphone.tsx:587` accept-gate tests (the authoritative audio duty gate, no server fallback) vacuous while green.
- **`softphone.tsx:587`'s `canWorkRef` gate must never be deleted as "duplication"** — the card guard is presentation-only and decides from its last render; a mid-ring flip passes through it (comment corrected in `46eabfa`).
- **`PropertyCard` is slot-based**; the admin `FleetBoard` renders the same `PodCardGrid`, so card changes hit admin too.
- **Never navigate the top window during a live call** — `launchRustdesk`'s hidden-iframe launch is why; don't touch `connect.ts`.
- Standing agenda items from the predecessor handoff (kiosk Tier-1 settings, WKWebView wrapper, credential hardening, Vercel/Agora decommission ~2026-07-23) are unchanged and out of this scope.
