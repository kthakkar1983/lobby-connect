# Handoff — post-cutover UI polish (notes keyboard + reopen button) + forward agenda — START HERE

**Written:** 2026-07-09 (follow-on to the same day's cutover). **Infra source of truth:** `docs/handoffs/2026-07-09-cutover-executed-live-handoff.md` (the pilot is LIVE on the box; stack consolidation is complete). This handoff covers a small UI-polish session and, more importantly, the **agreed forward agenda** so the next chat can pick up cleanly.

## The one-line state

Two isolated UI fixes are code-complete on branch `polish/notes-keyboard-and-reopen-button` (PR + prod deploy pending — see "Immediate next step"). The bigger items (call-tile redesign, copy audit, UI/layout polish) are **designed/agreed but deliberately deferred to their own fresh sessions**.

## What shipped this session (the two "isolated" fixes)

Both are low-risk, no migrations, no call-logic changes. On branch `polish/notes-keyboard-and-reopen-button`.

1. **Notes ⏎ / Tab parity** across both in-call overlays.
   - Audio (`components/softphone/audio-call-overlay.tsx`) already saved notes on **Enter** with an in-field indicator; added **Tab** (saves without blocking focus movement).
   - Video (`components/video-call/video-call.tsx`) had **neither** — ported the whole mechanism: **Enter and Tab** save Room#/Notes, same in-field indicator (⏎ → spinner → ✓ → alert) + `sr-only` live-region status. Also refactored video's `saveNotes` so a mid-call explicit save can NOT trip the teardown "Retry" banner (whose Retry *ends the call*) — that banner stays a teardown-only backstop.
2. **Reopen-tile button reposition** in both overlays.
   - Was a flat grey pill in the header ("easy to miss"). Now a **smaller teal floating pill, bottom-right within the guest-video stage** (audio: bottom-right of the navy call card), seated above the caption band. 911 is now truly alone in the audio header.

**Verification done:** wrote failing tests first (audio Tab-save, video Enter-save + saved-indicator, video Tab-save) → green. Full portal suite (node + jsdom), typecheck, lint, and production build all pass. **NOT yet browser-verified** — jsdom can't check CSS placement, and the reopen pill only appears mid-call after closing the tile.

**Known minor tradeoff:** Tab now fires a save every time you tab out of Room#/Notes (intended, per Kumar's ask). If the redundant saves feel noisy, add a one-line "only if changed since last save" guard.

## Immediate next step (do this first in the new chat)

**Merge the PR → box prod auto-deploys → verify live on prod** (Kumar chose prod-check over staging; note the audio overlay can only be exercised on prod — staging has no Twilio):
- Reopen pill: on a live call, close the tile → the teal pill appears bottom-right over the guest stage (video) / navy card (audio), clears the caption band, reopens the tile on click.
- Notes: **Enter AND Tab** both save on audio + video, with the in-field ✓.
- Then Kumar confirms "looks good" → stamp done / delete this section.

## Deferred to their own fresh sessions (agreed this session)

1. **Call-TILE redesign — attention-aware (agreed direction).** Problem: on answer, the guest video plays in TWO places at once — the fullscreen in-tab overlay AND the always-on-top DocPiP tile — which is distracting and defeats the tile's purpose. Agreed fix: still open the tile on the **Answer gesture** (a DocPiP window can only open from a user gesture — that constraint is why it opens on Answer, not lazily), but keep it **dormant** (compact, no live video) while the portal tab is focused/visible; **wake** it (guest video + controls) the moment the tab goes hidden (agent alt-tabbed to RustDesk). Net: guest video live in exactly ONE surface at a time. Touches `components/dashboard/call-surface-provider.tsx` + `lib/duty-tile/call-tile-manager.ts`. **Own brainstorm → spec → build.**
2. **Copy audit + brand voice.** Lots of app copy reads too technical/generic ("push armed", "go on duty to resume", "incoming calls ring here"). Research finding: **no turnkey codebase-copy-auditor skill exists.** Plan: (a) draft a Lobby Connect voice guide, seeded from `docs/brand/brand-guidelines.md` + `docs/DESIGN.md` via the installed `brand-voice:generate-guidelines`; (b) sweep user-facing strings (grep JSX text / `toast(...)` / labels / placeholders / empty+error states / dialogs — note `apps/portal/lib/copy.ts` + `apps/kiosk/src/lib/copy.ts` exist but most offenders are inline); (c) rewrite with the already-installed `design:ux-copy` as a reviewable diff; (d) wrap it all in a repeatable `.claude/skills/copy-audit` so it's re-runnable as features land. **Own session.**
3. **Broader UI / layout polish.** The deferred dashboard-layout-rework (unified duty card, kill the empty 1/3 column, softphone-tile placement, audio/video surfacing) + call-tile reopen-button color/reposition follow-ups. **Design the layout with explicit seams for the incoming time-tracking + outbound features so it isn't redone.** Kumar brings per-page notes. **Own session.**
4. **Standing cutover agenda** (from the cutover handoff): **time-tracking** (surface shift durations from go-on-duty/end-shift — needs a shift-history table) and **outbound calls + pod attribution** (which `property_id` an outbound leg is billed to). Each = its own brainstorm → design.

## Still in force (from the cutover handoff — don't trip these)

- ~2-week warm-standby window: **additive-only migrations**, do NOT rename `agora_channel_name`, Vercel `AGORA_*` + account stay, `KIOSK_CONFIG_SECRET` byte-identical, Vercel prod frozen. (This session's changes touch none of it.)
- `main` → box-prod auto-deploys (any merge deploys the live pilot). No migrations in this branch.
- Non-blocking bug still tracked: `task_71d65b0a` (agent stuck "not accepting" after a video call — `end-video` doesn't reset presence).
- Credential-hardening (encrypt-at-rest + fail-closed audit for `property_remote_access`) still deferred to pre-second-hotel.
