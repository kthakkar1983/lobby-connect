# Call-tile polish — batch 1 (911 separation · teal Connect · navy fill)

**Date:** 2026-07-10
**Status:** approved (brainstorm), ready to plan/build
**Surface:** the Document-PiP call tile + (for one consistency touch) the two in-tab in-call overlays
**Scope discipline:** UI-only. No call/Twilio/LiveKit/911 logic changes, no migrations, no routes, no RLS.

## Why

Live-pilot testing (2026-07-10) surfaced five call-tile observations. Three are quick, self-contained fixes and are in scope here. Two are larger and are deferred (see below).

The tile (`components/call-tile/call-tile.tsx`) is a **mirror-only** face rendered inside a 380×300 Document-PiP window. It owns no call state — every control dispatches through `callControls` registered by the live-call owner (Softphone for AUDIO, VideoCall for VIDEO). Nothing in this batch changes that contract; all three fixes are presentational.

## The three fixes

### 1. Move 911 away from Hang up (audio tile only)

Today the tile's control row is `Mute · Hang up · 911 · Connect` — Hang up (blaze) and 911 (red) sit ~6px apart. That is the **opposite** of the full-screen audio overlay, which deliberately isolates 911 (alone, red, top-right) from Hang up (blaze, bottom bar); the overlay even carries a code comment noting *red-next-to-end read as the end-call cue*. The tile never got that treatment.

**Change (`call-tile.tsx`):** remove the 911 `<button>` from the control row (currently L206–214) and re-mount it as an absolutely-positioned red chip in the **top-right corner of the tile face** (`absolute top-2 right-2 z-10`), still gated on `controls.triggerEmergency` (so it stays **audio-only** — video has no emergency path and must never show it). The two-tap arm → "Confirm 911" → 5s auto-revert logic (`handle911Tap`, `armed`, `armTimerRef`, `EMERGENCY_ARM_WINDOW_MS`) is **unchanged** — only the button's DOM position moves.

**Anchor + collision:** the chip is positioned relative to the outer face wrapper (the `flex flex-1 flex-col overflow-hidden p-2` container, L130) — that wrapper gets `relative`. Since 911 renders only on AUDIO (whose face is the centered clock), give the audio face a top inset so the hotel name/clock clears the chip; a long hotel name (e.g. "Super 8 by Wyndham Oklahoma City") wraps **below** the chip line. Confirm no overlap at smoke.

Resulting control row: **Unmute · Hang up · Connect**.

### 2. Connect reads as "remote in" (teal + monitor icon)

Today the tile Connect is a navy-on-navy **outline** button with no icon — near-invisible against the navy tile.

**Change (`call-tile.tsx`):** recolor Connect to `bg-accent text-accent-foreground` (teal `#2EA6AA` fill, ink `#14202F` text — the same token pair the "Reopen tile" pill uses) and add the `Monitor` lucide icon (`size={13}`). Keeps `ml-auto` placement and the `disabled={!active.propertyId}` guard.

**Consistency touch (approved):** the audio + video overlay Connect buttons already use the `Monitor` icon but are bordered — recolor those two to the same `bg-accent text-accent-foreground` so "teal = the remote-in action" reads identically on every call surface. (`audio-call-overlay.tsx` Connect ~L282–289, `video-call.tsx` Connect ~L451–460.)

### 3. Kill the white block (navy fills the window)

**Root cause (confirmed by reading the code, not the screenshots):** it is **not** a video aspect-ratio problem. The PiP `<html>` / `<body>` / mount `<div>` chain has no height set (`pip-document.ts`), so the tile's root `flex h-full` collapses to **content** height and the browser's default **white canvas** shows below it. Two symptoms fall out of that one bug: audio shows a big white gap; video's guest feed never expands to fill.

**Change (`pip-document.ts`):** set the height chain to fill the window — `target.documentElement.style.height = "100%"`, `target.body.style.height = "100%"`, and the mount `div.style.height = "100%"` (body already carries `bg-primary` navy). After this the tile root `h-full` resolves to the full 380×300 window: navy fills everything on audio, and on video the guest `<video>` (already `object-cover`) grows to fill the space above the controls — cropping to fit, never distorting. No aspect-ratio juggling, no per-frame work, no stability risk. `call-tile.tsx` needs no change.

## Verification

- **Fixes 1–2 (behavioral):** extend `apps/portal/tests/components/call-tile.test.tsx` **test-first** — 911 renders only when `triggerEmergency` is present (audio) and is absent otherwise (video); the two-tap arm → confirm still fires `triggerEmergency`; Connect calls `connectToProperty`. Assert the 911 button is not a sibling of Hang up in the control row.
- **Fix 3 (CSS layout inside a real PiP window):** **not** jsdom-testable — the repo's own lesson is *"jsdom can't catch CSS-stacking bugs — only real-browser smoke can."* Verified by Kumar on prod after redeploy.
- Then: `pnpm typecheck` · `pnpm lint` · full portal suite · `next build`.

## Deploy note (blue-green)

Merging to `main` **deploys nothing** — Vercel is the frozen Agora standby and the box prod apps don't auto-deploy from `main`. Seeing these fixes live requires a **Coolify redeploy of `lc-portal-prod`**. Flag at merge time.

## Deferred (tracked, not built here)

- **4 — attention-aware tile:** keep the tile dormant/compact while the portal tab is visible, wake it (guest video + controls) only when the tab goes hidden (agent alt-tabbed to RustDesk). This is the real cure for "the tile opens on top of what she's working on" + "guest video plays in two places at once." Already logged in `docs/handoffs/2026-07-09-ui-polish-and-next-agenda-handoff.md`; gets its own brainstorm → design.
- **5 — RustDesk true-fullscreen hides the tile:** a hard macOS-Spaces limitation (a native-fullscreen app in its own Space is not overlaid by a Chrome Document-PiP window; Chrome has no API to force it, DocPiP can't set its own position — verified against the WICG spec + Chromium tracker). No code fix exists. The operating answer is an SOP (agents run RustDesk **maximized, not fullscreen**) plus the already-built alert layers (Web Push OS notification + Twilio background audio ring, both fire regardless of the Space). Capture as an ops note, not code.
