# Handoff — call-tile polish batch-1 + the UI/UX polish backlog (2026-07-10)

**START HERE for the next chat.** The pilot is live on the box (cutover done 2026-07-09 — see `docs/handoffs/2026-07-09-cutover-executed-live-handoff.md`). This session was UI polish on the Document-PiP call tile, plus a groomed backlog for the end-of-line UI/UX polish pass.

## Shipped this session

**PR #42 merged** (start of session): notes ⏎/Tab save parity on both in-call overlays + the floating reopen-tile button. → **audio↔video ⏎-notes parity is DONE** (drop it from any older backlog).

**Call-tile polish batch-1** — three UI-only tile fixes from live-pilot testing, spec `docs/specs/2026-07-10-call-tile-polish-batch1-design.md`, branch `polish/call-tile-911-connect-fill`:
1. **911 off Hang up.** Moved from the tile control row (was ~6px from Hang up) to an absolutely-positioned red chip in the **tile-face top-right corner**, audio-only, mirroring the full-screen overlay's deliberate isolation. Two-tap arm/confirm/auto-revert logic **byte-identical** — only the DOM position moved.
2. **Teal Connect.** Recolored Connect to the teal accent (`bg-accent`/`text-accent-foreground`) + `Monitor` icon so it reads as "remote in" — on the **tile AND both in-call overlays** (parity). The dashboard/property-card Connect stays navy (`variant="neutral"`) — the split is a **kept decision**, see backlog.
3. **White block killed.** The PiP `<html>`/`<body>`/mount chain had no height → the tile's `h-full` root collapsed to content height and the browser's white canvas showed below it. Fixed in `lib/duty-tile/pip-document.ts` (chain → `height:100%`). Navy now fills the whole tile; on video the `object-cover` guest feed grows to fill the face.

Test-first (3 new tests), full portal suite + typecheck + lint + build green, **adversarial 3-lens review = SHIP** (911-safety + PiP-fill both 0 findings). CSS placement/fill are **not jsdom-verifiable** → smoke on prod.

## Deploy + smoke (needs a manual step)

Blue-green freeze: **merging to `main` does NOT auto-deploy prod.** The `lc-coolify` GitHub App auto-deploys only the `staging` branch; **`main` → `lc-portal-prod` is a manual Deploy** in the Coolify UI (`https://coolify.lobby-connect.com` → `lc-portal-prod` → **Deploy**), or `POST /api/v1/deploy?uuid=<app>` with the `lc-claude` API token. No env changed here, so a plain rebuild is safe (don't touch the Readonly-labels checkbox — runbook §Traefik).

**Prod smoke checklist** (only exercisable on prod): 911 sits in the tile corner, not beside Hang up · no white block (navy fills, audio + video) · guest video fills the tile on a video call · Connect is teal on the tile + audio overlay + video overlay · Connect still launches RustDesk · 911 two-tap still fires.

## UI/UX polish backlog (fold into the end-of-line polish pass)

- **Connect color split decision** — dashboard-card Connect is navy, in-call Connects are teal. Kept for now (surface-appropriate: teal pops on the dark in-call stages). Decide unify-to-teal (`variant="accent"` on `components/dashboard/connect-button.tsx`) vs keep-split during polish.
- **Nit — two teal actions on one overlay:** teal Connect + the teal "Reopen tile" pill can both be visible; quiet the *passive* Reopen pill to bordered/ghost so only the primary action carries the fill.
- **Nit — Connect markup triplicated** across `call-tile.tsx` + `audio-call-overlay.tsx` + `video-call.tsx`; a shared `<ConnectControl>` (icon + label + className, delegating click) would collapse them (and could fold in the card's error surfacing).
- **Nit — disabled tile Connect low-contrast** on navy (teal@50% ink@50%); only in the `propertyId == null` edge case (≈never on a live call). Lighter disabled treatment if touched.
- **Reopen-tile button** reposition + color (pre-existing polish item).

## Deferred — bigger, each needs its own brainstorm→spec

- **Item 4 — attention-aware tile.** Still open the tile on the Answer gesture, but keep it **dormant/compact while the portal tab is visible**, and wake it (guest video + controls) only when the tab goes **hidden** (agent alt-tabbed to RustDesk). This is the real cure for "the tile opens on top of what she's working on" + "guest video plays in two surfaces at once." Touches `components/dashboard/call-surface-provider.tsx` + `lib/duty-tile/call-tile-manager.ts`.
- **Item 5 — RustDesk true-fullscreen hides the tile.** Hard macOS-Spaces limitation: an app in *native* fullscreen (its own Space) is **not** overlaid by a Chrome Document-PiP window — Chrome has no API to force it, DocPiP can't set its own position (verified vs the WICG spec + Chromium tracker). **No code fix.** Operating answer = SOP: agents run RustDesk **maximized, not fullscreen**, and lean on the already-built alert layers (Web Push OS notification + Twilio background audio ring, both fire regardless of the Space). Capture as an ops note.

## Pre-existing agenda (from the 2026-07-09 handoff, still open)

- **Time-tracking** — go-on-duty/end-shift already = clock in/out → surface shift durations/timesheet (needs a shift-history seam).
- **Outbound calls** on the agent dashboard + pod attribution (which `property_id` the outbound leg bills to) → real brainstorm→design.
- **Copy audit + brand voice.**

## Still-true context

- **Standby invariants hold until decommission** (~2 weeks post-cutover, so ~2026-07-23): additive-only migrations, do NOT rename `agora_channel_name`, Vercel `AGORA_*` + the Agora account stay, `KIOSK_CONFIG_SECRET` identical across apps, Vercel frozen as instant rollback. Then decommission per runsheet §8 + cut tags.
- **Non-blocking bug tracked** (`task_71d65b0a`): agent stuck 'not accepting' after a VIDEO call — `end-video` doesn't reset presence server-side; recovery heartbeat throttled behind foregrounded RustDesk.
- **Credential-hardening** (encrypt `property_remote_access` password at rest + fail-closed issuance audit) = post-pilot / pre-second-hotel (migration plan step 5).
