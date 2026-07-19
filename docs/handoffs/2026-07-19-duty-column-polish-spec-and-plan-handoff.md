# Handoff — duty column + call-surface polish: spec and plan GATED, build not started (2026-07-19)

**START HERE.** This session ran brainstorm → spec → plan for the UI/UX polish pass. **Nothing has been built.** Two closed bugs came out of it as a bonus.

- **Spec:** [`docs/specs/2026-07-19-duty-column-and-call-surface-polish-design.md`](../specs/2026-07-19-duty-column-and-call-surface-polish-design.md) — GATED by Kumar
- **Plan:** [`docs/plans/2026-07-19-duty-column-and-call-surface-polish.md`](../plans/2026-07-19-duty-column-and-call-surface-polish.md) — 17 TDD tasks, six phases
- Predecessor: [`2026-07-18-tile-reopen-crash-investigation-handoff.md`](2026-07-18-tile-reopen-crash-investigation-handoff.md)

## Current state

| Thing | State |
|---|---|
| `main` | **`ec783c6`** — six docs-only commits this session. `origin/main` may be behind; push if so. |
| Prod | **Untouched.** Nothing built, nothing deployed. |
| Branch | None cut yet. Task 1 starts on a fresh branch off `main`. |
| Untracked | `analysis-and-audit-2026_07_11/` — leave it. Never `git add -A` (prior key leak). |
| Mockups | Dashboard `https://claude.ai/code/artifact/78b99223-36b3-4979-969e-bfdf3e4886ab` · Overlay `https://claude.ai/code/artifact/155ff0d9-e84e-48ae-8c75-d6717b129bf2` |

The mockups are **living artifacts and may drift** — the spec is authoritative. They are useful for seeing the intended result, not for copying markup (they are hand-rolled HTML, not the real components).

## What the change is

**Dashboard.** The 340px right column currently holds one content-height softphone card and ~150px of nothing, because `VideoCallHost` beside it is headless. It gains a **shift card** (clock, break, end shift) and a **world-clocks card** (four analog faces, day/night tinted). The softphone's decorative ring — its own comment calls it *"decorative anchor, not a status light"* — becomes the **go-on-duty control** when off duty. The header empties of all duty chrome. Gated controls stay enabled and **intercept**, offering to start the shift, instead of being HTML-`disabled`.

**Call surfaces.** Extract the `<CallShell>` both overlays' own comments already recommend; remove the permanently-disabled `Hold` and `Swap`; normalize `End` → `End call`; stop the control bar reflowing when toggles change label; move the reopen-tile control **off the guest video** into a round mint-outlined corner button; collapse five hand-rolled Connect-shaped buttons into one `PropertyActionButton`.

**Zero migrations, zero new routes, zero RLS changes, no change to duty semantics or 911.**

## Two bugs CLOSED this session (Kumar tested)

**RustDesk fullscreen occluding the tile — closed.** Kumar tested on the Windows PC: a *fresh* Connect opens RustDesk fullscreen with the tile correctly on top. The tile only ends up behind when a RustDesk session is **already connected** and merely gets raised. This matches the source — `setNewConnectWindowFrame` runs its placement path only `if (preSessionCount == 0)`. **The fix is the SOP that already exists:** disconnect after each guest, which agents are already trained to do. Ops note, not code. LC cannot reach it anyway — the `rustdesk://` scheme parses only `key`, `password`, `switch_uuid`, `relay`.

**Tile-reopen crash — closed, not reproducible.** Repeated attempts on the same setup never reproduced it.

⚠ **The mechanism remains real and latent.** In livekit-client 2.20.0, `disconnectOnPageLeave` defaults `true` and the `freeze` listener is registered **ungated**, both on the main window — so any `pagehide`/`beforeunload`/`freeze` makes the SDK disconnect the room itself, cleanly and silently. That is what made the Phase-E `rustdesk://` gotcha real, and it stays a standing hazard. Task 15 of the plan adds the one durable mitigation: a `RoomEvent.Disconnected` → Sentry handler, because the portal currently drops rooms with **no Sentry, no log, no UI**, which is exactly why a week of investigation produced no evidence.

The local-only branch `debug/tile-reopen-audio-only` is **unpushed**. Deleting it is Kumar's call — if pruned, it's gone.

**Bonus finding worth remembering:** Kumar observed **Windows allowing two applications to hold the webcam simultaneously** (Google Meet and Lobby Connect, both with video and audio flowing). This contradicts the sourced claim that Windows Media Foundation is exclusive-access by default, and it undermines the original crash report's premise that a busy camera forced an audio-only fallback.

## ⚠ Corrected assumption — fix this in CLAUDE.md

`CLAUDE.md` and the business-model memory both describe the agent as *"permanently remote-session-foreground"* with the portal in the background. **That is stale.** Kumar, 2026-07-18: agents are trained to **disconnect RustDesk as soon as the guest is handled**, and during dull time they are parked on the dashboard or another tab. This is not a call centre — volume is low and dull time is long.

It changes design conclusions: the dashboard is a screen she looks at for hours, so dead space is not merely untidy. OS-level alerting is still mandatory, but for a different reason than what's written. Tracked as spec §12; **not yet done.**

## How to start

Read the spec, then execute the plan. Two options:

1. **Subagent-driven (recommended)** — `superpowers:subagent-driven-development`, fresh subagent per task with two-stage reviews. This is how every recent phase of this project shipped, and per-task reviews have caught real defects pre-merge every time.
2. **Inline** — `superpowers:executing-plans`, batch with checkpoints.

### Sequencing that matters

- **Phase A first, always.** Both shared primitives are built and tested before anything consumes them.
- **Task 11 must produce zero visual change.** It relocates the 911 and notes handlers into `<CallShell>`. Its Step 5 is a mandatory line-by-line diff of those paths against `main`. Only then does Task 12 rework the bars — so that if something breaks, the ordering tells you which step did it. The spec names this the highest-risk item in the change (§11).
- **Do not merge until Task 17's smoke passes.** Merging to `main` auto-deploys prod via Coolify.

## Gotchas

- **`PropertyCard` is slot-based.** Reading it tells you what it *can* render, not what it *does* — buttons arrive through `connectSlot`/`footerSlot` from `pod-card-grid.tsx:115-136` and `fleet-board.tsx:84`. This caught me out twice: I first claimed the `Kiosk` button didn't exist, then denied the real one. It starts an **outbound video call to the lobby kiosk** (Task 14 of the outbound-video plan).
- **The admin `FleetBoard` renders the same `PodCardGrid`**, so the property-card tasks change admin too.
- **One convention, three places:** *a state or label change must not change a control's size.* Header, card actions, control bar. Implement once, apply three times — not as unrelated tweaks.
- **`disabled` buttons fire no click event**, so they cannot be intercepted. That is why gated controls stay enabled. But **duty gating and real unavailability are different**: `kiosk-call-button.tsx:39` computes `disabled = !kioskOnline || dutyGated || busy`, and only `dutyGated` gets the prompt. Offering "start your shift" for an offline kiosk would be a lie.
- **Never navigate the top window during a live call.** `launchRustdesk` uses a transient hidden iframe for exactly this reason; `tests/lib/remote-access/launch-rustdesk.test.ts` pins it. Don't touch it.
- **jsdom has no layout engine.** Card heights, button alignment, the corner button over guest video, control-bar reflow — none are verifiable in tests. Task 17 is the only place they get confirmed. Every defect found during design review came from looking at rendered output; none came from reading source.
- **`softphone.test.tsx` has a flake history** (fixed in `fd3fbdb` — a `waitFor` exact-count race). Reuse its harness; don't restructure it.
- Prod auto-deploys from `main` on merge (Coolify). Reload the iPad kiosk after a kiosk deploy — but this change touches no kiosk code.
- Supabase refs: prod `ztunzdpmazwwwkxcpyfp`, staging `cgtvqjxhbojztzumshca`.

## Standing agenda (unchanged, not in this spec)

- **Kiosk camera/mic — Tier 1** (Kumar, pilot iPad, ~5 min): Auto-Lock Never · **Guided Access → Mirror Display Auto-Lock = ON** (GA blanks the screen at 20 min without it) · Safari **"Allow for This Website"**, never "Allow Once" · do **NOT** "Add to Home Screen".
- **Kiosk Safari → native WKWebView wrapper** — pre-second-hotel, migration plan Phase-5 step 5.
- **RustDesk credential hardening** (encrypt-at-rest + fail-closed issuance audit) — post-pilot / pre-second-hotel, same plan step.
- **Vercel/Agora standby decommission** — cutover was 2026-07-09, so the ~2-week window is up around 2026-07-23. Runsheet §8: close Vercel + Agora, revoke the two `lc-claude` tokens, DO auto-backups, Supabase Pro, cut tags, lift the `agora_channel_name`-rename ban. **Until then the standby invariants hold:** additive-only migrations, don't rename `agora_channel_name`, Vercel `AGORA_*` env and the Agora account stay, `KIOSK_CONFIG_SECRET` identical. This change is zero-migration, so it satisfies them trivially.
- **Bigger deferred (own brainstorm each):** attention-aware dormant/wake tile.

## Follow-ups recorded in spec §12 (deliberately out of scope)

- Correct the stale remote-session-foreground framing in `CLAUDE.md`.
- Dead `ChannelBar` / `ChannelLegend` in `components/dashboard/channel-viz.tsx` — zero references repo-wide.
- Stale `docs/v2-backlog.md:108` — describes `IncomingCallToast` and a persistent right-column Video card as current; both deleted in Phase 3.
- Convert the softphone's hand-rolled card `<div>` (`softphone.tsx:774`) to `<Card>` — the only major dashboard panel that isn't.
