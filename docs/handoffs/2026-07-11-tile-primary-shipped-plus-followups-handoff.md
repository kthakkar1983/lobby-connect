# Handoff — tile-primary + captions SHIPPED; three follow-ups (2026-07-11)

**START HERE for the next chat.** The pilot is live on the box (cutover 2026-07-09). This session shipped the **call-tile-primary + captions-in-tile** feature to prod, Kumar smoke-tested it, and we shipped two small follow-up fixes. One real bug (**A**, a crash) is still **open** and is the main thing to pick up.

## What shipped this session

1. **Tile-primary + captions-in-tile** — merged to `main` `2202ea7`, prod auto-deployed. The Document-PiP call tile is now the **primary call surface while open**: both in-call overlays collapse their left panel to **playbook-only** (keyed on `tileMount`), captions moved **into the tile** (default OFF, non-persistent, per-call reset, isolated `useSyncExternalStore` relay; `useCaptionsEnabled` deleted), tile **notes removed** (+ dead `saveNote`), **hotel clock on both channels** (top-left chip on video via a `timezone` plumb through `incoming-video`). Spec/plan: `docs/{specs,plans}/2026-07-10-call-tile-primary-surface-and-captions*`. Subagent-driven (8 TDD tasks) + whole-branch review; 796 tests.
2. **C — kiosk welcome fill fix** (`da5c811`) — see below.
3. **B — Connect reopens the tile** (`b762884`) — see below.

**Kumar's prod smoke (2026-07-10→11):** the **core feature works as intended** — overlays collapse to playbook-only, captions in the tile, hotel clock, Connect/911/hang-up all good. The three items below came out of that smoke.

---

## A — ⚠ OPEN BUG: "Reopen tile" crashes the call when the agent's camera is busy

**Symptom (Kumar, replicable ~2×):** another app is using the agent's camera → LC connects **audio-only** (the busy-webcam→audio-only fallback; guest hears her, no agent video). This works fine **in the tile** and **after "Back to tab."** But the moment she presses **"Reopen tile," the call crashes and the kiosk drops to its home screen.** With the camera **free**, everything works perfectly.

**What we know (evidence, not yet root-caused):**
- **No Sentry error** for it (only the unrelated max-duration warning `PORTAL-N` fired that day). ⇒ it is **not** a caught JS exception.
- Kiosk goes to **home** (not the *apology* screen). The kiosk shows home on `onAgentLeft` (agent's LiveKit participant **left the room**); a connection-*terminal* would show apology instead. ⇒ **the agent cleanly left the LiveKit room** — i.e. reopening the PiP **dropped the agent's WebRTC** in the audio-only path.
- Same **class** as the Phase-E gotcha already in CLAUDE.md — *"deep-link launches must NEVER navigate the top window while a WebRTC call is live"* — but here the trigger is **`openTileForCall` → `documentPictureInPicture.requestWindow()`** (the "Reopen tile" button), not a deep link. Why it only bites in the **audio-only** path is the open question.

**The one detail still needed from Kumar (he's testing):** when it crashes, **does the tile window actually open first (even for a moment) and then the call drops — or does it drop instantly on click with no tile appearing?** This distinguishes "`requestWindow` itself drops the WebRTC" from "the tile *mounting/rendering* does."

**Suggested next step:** a **targeted diagnostic build** on the agent side — log (a) `requestWindow` start/resolve, (b) LiveKit connection-state changes + disconnect reason, (c) whether `VideoCall` unmounts — deploy, reproduce with the camera busy, read the logs. (There's a debug-instrumentation pattern precedent in `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md`.) Reason further once the timing detail lands.

**⚠ Interaction with B (important):** fix **B** (below) makes **Connect** *also* call `openTileForCall` (reopen the tile) when the tile was closed. That is the **same `requestWindow` path** as the manual "Reopen tile" button. So **if A's root cause is `requestWindow` dropping the audio-only WebRTC, then B's Connect-reopen will hit the same crash in the camera-busy case.** B is safe in the common (camera-free) path; **A is effectively a blocker for the camera-busy edge across BOTH the manual Reopen button and Connect.** Fixing A protects both.

Relevant code: `lib/duty-tile/call-tile-manager.ts` (`openCallTile`/`requestWindow`), `components/dashboard/call-surface-provider.tsx` (`openTileForCall`), `components/video-call/video-call.tsx` (LiveKit session + camera fallback + teardown), kiosk `apps/kiosk/src/App.tsx` (`onAgentLeft`).

---

## B — SHIPPED (verify on prod): Connect reopens the tile so it follows her into RustDesk

**Gap Kumar found:** answer → tile opens → **"Back to tab"** (tile closes) → press **Connect** → RustDesk launches but the **call surface is stranded in the now-backgrounded tab** (no tile). We never designed for "Connect while the tile is closed."

**Fix (`b762884`):** `connectToProperty` now **reopens the tile in the same click** (when a call is live **and** the tile is closed) **before** launching RustDesk, so her guest-video + controls follow her into RustDesk. `openTileForCall` runs **first** because `requestWindow` strictly needs the fresh gesture activation, whereas the `rustdesk://` launch tolerates a spent one (the cache-miss path already launches post-`await`). No-ops when no call is live (a dashboard-card Connect) or the tile is already open. +2 tests.

**Verify on prod:** Back-to-tab → Connect → the **tile reappears** AND RustDesk launches (both, from one click). **Watch the activation caveat:** if RustDesk does *not* launch (only the tile reopens), the `requestWindow`-then-`rustdesk` ordering consumed the activation — swap to launch-then-reopen, or gate the reopen. (Expected to be fine; flagged for completeness.) Also test the **camera-busy** case knowing the **A** interaction above.

---

## C — SHIPPED (verify on the real iPad): kiosk welcome now fills the screen

**Symptom:** on the physical iPad (landscape or portrait), the welcome/home screen only used the **top half**; the bottom half was just the light background.

**Root cause + fix (`da5c811`):** Home's tap-anywhere root was a full-screen **`<button>` used as the flex container**. iOS Safari does not reliably stretch a `<button>` to `height:100%` / flex its children like a `<div>` (the other kiosk screens use `<div>` and fill fine). Converted Home's root to **`<div role="button" tabIndex=0>`** with a keydown (Enter/Space) handler — same tap-anywhere behaviour, reliable full-height. **Not caused by this session's portal work** (Home has been a `<button>` since the kiosk redesign; only surfaced on a physical iPad).

**Verify on the real iPad:** the welcome screen fills the whole screen in both orientations; tap-anywhere still starts a call. (jsdom can't verify iOS layout — device-only.)

---

## Still-open tile-polish backlog (end-of-line pass; not urgent)

Connect color-split (dashboard-card navy vs. in-call teal), quiet the "Reopen tile" pill vs. the teal Connect, shared `<ConnectControl>` to de-triplicate, disabled-Connect contrast, reopen-button reposition. Bigger deferred: **RustDesk true-fullscreen hides the tile** (hard macOS-Spaces limit — SOP, no code fix). See `memory/call-tile-polish.md`.

## Refs

- This feature: `docs/specs/2026-07-10-call-tile-primary-surface-and-captions-design.md` · `docs/plans/2026-07-10-call-tile-primary-surface-and-captions.md`
- Live-prod reference: `docs/handoffs/2026-07-09-cutover-executed-live-handoff.md`
- Memory: `memory/call-tile-polish.md`, `memory/stack-consolidation-direction.md`, `memory/voice-vs-video-incoming.md` (busy-webcam→audio-only), `memory/sentry-observability-access.md` (`pnpm sentry:issues`)
