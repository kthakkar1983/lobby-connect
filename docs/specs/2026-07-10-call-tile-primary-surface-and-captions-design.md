# Call tile as the primary call surface + captions in the tile

**Date:** 2026-07-10
**Status:** approved (brainstorm), ready to plan/build
**Surface:** the Document-PiP call tile, the two in-call overlays (`video-call.tsx`, `audio-call-overlay.tsx`), `CallSurfaceProvider`, and the caption enable/wiring.
**Scope discipline:** UI composition + caption-state relocation. **No** call/Twilio/LiveKit/911 logic changes, **no** migrations, **no** new routes, **no** RLS. Two changes reach outside pure UI, both called out: the caption **default** (D7), and an **additive read-only `timezone` select** on the existing `incoming-video` route (D10) — no call/dial logic touched.

**Supersedes:** the "attention-aware tile (Item 4)" deferred in `docs/specs/2026-07-10-call-tile-polish-batch1-design.md` §Deferred and in the handoff/memory. That framing (a *dormant-while-visible / wake-when-hidden* tile driven by the Page Visibility API) is **rejected** here — see §Research.

---

## Why

The tile (`components/call-tile/call-tile.tsx`) is today a **mirror** of the in-tab call surface. On a video call the guest feed plays in **both** the in-tab overlay **and** the always-on-top tile, and the tile floats over whatever the agent is doing. Two live-pilot complaints:

1. "The tile opens on top of what she's working on."
2. "Guest video plays in two surfaces at once."

The tile's real job is modest and **video-forward**: keep the guest present so the agent doesn't vanish on them while heads-down in RustDesk — *"maintain some level of connection with the guest"* (Kumar, 2026-07-10). This spec makes the tile the **primary** call surface while it's open and demotes the in-tab overlay to **playbook-only**, so the guest video and the controls live in exactly one surface at a time.

## Research (verified against primary sources — drives the model choice)

The originally-deferred idea was an attention-aware tile that shrinks/quiets while the portal tab is visible and wakes when it's hidden. Investigating the Document Picture-in-Picture API killed that approach:

- **A PiP window's screen position can never be set by the page.** ([Chrome for Developers — Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/); *"The Picture-in-Picture window position cannot be set by the website."*)
- **`resizeTo()`/`resizeBy()` require a user gesture originating inside the PiP window.** So the tile **cannot** auto-shrink/grow on a `visibilitychange` (that is not a gesture) — automatic behavior could only swap *contents* at a fixed window size, never physically get the window out of the way.
- **`visibilitychange` → `hidden` on full occlusion** works on **Windows** (native window-occlusion tracking) and **macOS** (occlusion → hidden), but **not Linux**. So a visibility-driven design is OS-dependent, and it has a two-monitor blind spot (portal left visible on screen 2 while RustDesk fills screen 1 → tab never "hidden").

**Conclusion:** the visibility-driven model is fragile (OS/monitor-dependent) and can't shrink the window anyway. This spec keys off one deterministic fact instead — *is the tile open?* — which is monitor- and OS-agnostic, and kills the double-video **at the source** rather than detecting and suppressing it.

## The model (the invariant to protect)

**The guest video AND the controls live in exactly one surface at any instant**, keyed on `tileMount != null` (the tile window is open):

- **Tile open** → the tile owns the guest video + basic controls (floating, on top); the in-tab overlay's **left panel collapses** (guest-video stage on video, call card on audio) so the playbook fills it.
- **Tile closed** (native **"Back to tab"** button on the PiP window, or the tile was never opened / DocPiP unsupported) → the overlay is the unchanged **50-50** (guest video + playbook + controls), with the existing **"Reopen tile"** button to re-enter tile mode.

No visibility listener, no dormant state. The reunite action already ships: the browser's native "Back to tab" button (and closing the tile) fire `pagehide` → `onClosed` → `tileClosedByUser` → the existing "Reopen tile" affordance. This feature layers on that existing close↔reopen machinery.

---

## Decisions

**D1 — Tile-primary, keyed on `tileMount != null` (not tab visibility).** Deterministic, monitor/OS-agnostic, removes double-video structurally. Supersedes the dormant/visibility approach (§Research).

**D2 — Both overlays collapse their left panel to playbook-only when the tile is up.** `video-call.tsx` hides its guest-video stage; `audio-call-overlay.tsx` hides its navy call card. Playbook fills the freed width in both. For video this removes the double-video; for audio there is no guest to keep eye contact with, so the call card is just real estate better given to the playbook — its property / elapsed / hotel-clock info already lives in the tile. Symmetric with the "top and bottom chrome unchanged, middle collapses" model.

**D3 — Collapse via `hidden` (display:none), NOT unmount.** The guest video is attached to the overlay's `remoteRef` element by LiveKit; hiding (not unmounting) the stage keeps that attachment intact — no re-attach churn or races — and the playbook expands via a conditional `basis`. The audio call card hides the same way (`hidden`): it has no attached media, but hiding keeps its self-ticking elapsed timer mounted and matches the video path. In **both** overlays the "Reopen tile" button lives inside the collapsing panel — which is correct, since it's only needed when the tile is *closed* (panel visible again).

**D4 — Tile stays 380×300.** The window is not resized. The vertical space reclaimed by removing the notes row (D5) goes to the guest video (and, when on, the caption band).

**D5 — Tile controls = Mute · Hang up · Connect (unchanged) + the 911 corner chip (audio-only, unchanged) + a new compact caption (CC) toggle. Notes are removed from the tile.** Notes stay in the overlay's control bar (which is always reachable — the overlay's chrome is untouched). Dropping tile notes costs nothing and frees space for the video/caption band.

**D6 — Captions render in the tile.** A caption band sits in the **former notes slot** (below the face, above the control row), shown only when captions are enabled **and** there is caption text; otherwise the face expands to fill (as it does today with no notes). The tile also carries the CC toggle (D5) so the agent can turn captions on **from the tile** (i.e. while in RustDesk) without alt-tabbing to the portal — which is exactly when the "I can't understand this guest" realization happens.

**D7 — Caption ENABLED state moves to `CallSurfaceProvider`; default OFF, non-persistent, reset every call.** Today `useCaptionsEnabled` defaults **ON** and persists to `localStorage`. Because captions bill per audio-minute, a persisted-ON default means an agent who toggled captions once (or never) is billed on every subsequent call for a stream nobody is watching. New behavior: a single `captionsEnabled` boolean in the provider (shared by the overlay toggle **and** the tile toggle), **default OFF**, **no `localStorage`**, and **reset to `false` on every call transition** (`active?.callId` change, including → null). Net: captions run only when the agent deliberately reaches for them, and never carry into the next call. This changes the v1.1 caption default — intentional.

**D8 — Caption TEXT (finals/partial) reaches the tile through an isolated channel, not the main context value.** Partials update several times a second; routing them through `CallSurfaceProvider`'s memoized `value` would re-render every consumer (softphone, cards, video host) on every partial. Instead the provider exposes an external store — `publishCaptions(finals, partial)` / `subscribeCaptions(cb)` / `getCaptionSnapshot()` (refs + a listener set, stable identities) — and the tile's band reads it via `useSyncExternalStore`, so only the tile's band re-renders on partials. `captionsEnabled`/`toggleCaptions` stay in the memoized value (they change rarely — a toggle or a per-call reset). The overlay keeps rendering its **own** local `CaptionBand` from its local `useCaptions` state exactly as today (zero regression); the producer *additionally* calls `publishCaptions` to feed the tile.

**D9 — Graceful standalone.** `video-call.tsx`/`softphone.tsx` read `captionsEnabled`/`toggleCaptions` off `useCallSurfaceOptional()` with an OFF/no-op fallback when the surface is absent (mirrors the existing optional-surface pattern), so the standalone `video-call.test.tsx` mount still renders.

**D10 — Hotel local time shows on the tile for BOTH channels.** Today it renders on the audio face only; the video path publishes `timeZone: null` (`video-call-host.tsx:106`), so the video tile never had a clock. Fix with a small, additive timezone plumb (no call/TwiML/dial change), mirroring the name-join already in the incoming-video route: `app/api/calls/incoming-video/route.ts` adds `timezone` to its existing `properties` select and includes it per call → `IncomingVideoCall` gains `timezone: string \| null` → `video-call-host.tsx` publishes `timeZone: active.timezone ?? null`. The tile **already** computes `localTime = useHotelClock(active?.timeZone)` for both channels (`call-tile.tsx:103`); the video face renders it as a small chip in the **top-left corner** — mirroring the 911 chip at top-right — so it stays clear of the busy bottom (caption band + control row). The existing `property · elapsed` stays in the bottom strip. The chip is hidden when `localTime` is null. Audio is unchanged (already shows the big "Hotel local time" clock).

---

## Components & data flow

### `CallSurfaceProvider` (`components/dashboard/call-surface-provider.tsx`)

Additive:

- **State:** `captionsEnabled: boolean` (default `false`). `toggleCaptions()` flips it. A `useEffect` on `active?.callId` sets `captionsEnabled = false` on every change (new call **and** call end) — the per-call reset (D7) — **and clears the caption-text store** (below) so a prior call's captions can't linger into the next. No `localStorage`.
- **Caption text store (D8):** `captionStoreRef = useRef({ finals: [], partial: "" })`, a `Set<() => void>` of listeners, and three stable callbacks: `publishCaptions(finals, partial)` (writes the ref, notifies listeners), `subscribeCaptions(cb)` (adds/removes a listener, returns the unsubscribe), `getCaptionSnapshot()` (returns the ref's current value; return a **stable reference** — only allocate a new snapshot object when content actually changes, so `useSyncExternalStore` doesn't loop).
- **`value` memo** gains `captionsEnabled`, `toggleCaptions`, `publishCaptions`, `subscribeCaptions`, `getCaptionSnapshot`. Text is **not** in the value (store only).
- **Cleanup:** `saveNote` on `RegisteredCallControls` was added solely for the tile's notes; with tile notes gone it is dead. Remove `saveNote` from `RegisteredCallControls` and from both registrations (the overlay saves notes through its own `saveNotes`, not via registered controls).

### `video-call.tsx` (producer + collapse)

- Read `captionsEnabled`/`toggleCaptions` from the surface (D9 fallback); drop the local `useCaptionsEnabled`. `useCaptions(captionsEnabled ? guestAudioTrack : null)` unchanged.
- Keep rendering its own `CaptionBand` in the guest stage as today; **additionally** call `surface.publishCaptions(captions.finals, captions.partial)` whenever they change (an effect keyed on those values).
- **Collapse:** take a `collapsed?: boolean` prop (default `false`, symmetric with the audio overlay + testable standalone). When `true`, add `hidden` to the guest-video stage (`<div className="relative basis-2/5 …">`, given a `data-testid="guest-video-stage"`) and pass `PlaybookPanel` a full-width basis; when `false`, the existing `basis-2/5` + `basis-3/5`. `video-call-host.tsx` computes `collapsed = surface?.tileMount != null` and passes it (it already consumes the surface).
- The self-view PiP and caption band live inside the hidden stage, so they're hidden while the tile is up — correct (the tile carries the guest video + captions then).

### `softphone.tsx` (producer, audio)

- Read `captionsEnabled`/`toggleCaptions` from the surface; drop the local `useCaptionsEnabled`. `useCaptions(captionsEnabled ? guestAudioTrack : null)` unchanged.
- `publishCaptions(captions.finals, captions.partial)` on change.
- Pass `collapsed={surface?.tileMount != null}` to `AudioCallOverlay` (the softphone already reads the surface).
- Caption props to `AudioCallOverlay` (`captionFinals`/`captionPartial`/`captionsEnabled`/`onToggleCaptions`) are now sourced from the surface, passed through unchanged.

### `audio-call-overlay.tsx` (collapse)

- Add a `collapsed?: boolean` prop (default `false`, so existing callers/tests render unchanged). When `true`, add `hidden` to the navy call card, give `PlaybookPanel` a full-width basis, **and add `hidden` to the caption band** (symmetric with the video overlay, whose band sits inside the collapsing guest stage — while the tile owns the call surface, captions belong ONLY in the tile, never doubled); when `false`, the existing `basis-[37%]` / `basis-[63%]` and a visible band. The header (911 + property) and control bar are unchanged.

### `video-call-host.tsx` + `incoming-video` (hotel-timezone plumb, D10; + video `collapsed`)

- `app/api/calls/incoming-video/route.ts`: add `timezone` to the existing `properties` select (currently `select("id, name")`), build a `tzById` map alongside `nameById`, and include `timezone` in each mapped call.
- `lib/hooks/use-incoming-video-calls.ts`: `IncomingVideoCall` gains `timezone: string | null`.
- `video-call-host.tsx`: publish `timeZone: active.timezone ?? null` (replacing the hardcoded `null` at L106); also compute `collapsed = surface?.tileMount != null` and pass it to `<VideoCall collapsed={…} />`.

### `CallTile` (`components/call-tile/call-tile.tsx`)

- **Remove** the notes row (`room`/`note` inputs, `handleSaveNote`) and its state.
- **Caption slot** in the freed space: render `<CaptionBand>` (reused from `components/call/`) when `captionsEnabled && (finals.length || partial)`. Read `captionsEnabled` from context; read `finals`/`partial` via `useSyncExternalStore(subscribeCaptions, getCaptionSnapshot)`. Constrain to ~2 lines so it doesn't crowd the 380×300 window.
- **CC toggle** in the control row: reuse `CaptionToggle` with a new `compact?: boolean` prop that renders **icon-only** (no "Captions" text label) so it fits the tight 380px row — `<CaptionToggle enabled={captionsEnabled} onToggle={toggleCaptions} compact />`. The overlays keep the full labelled toggle. Resulting tile control row: **Mute · Hang up · CC · Connect** (911 stays the corner chip; audio-only).
- **Hotel local time on the video face (D10):** render `localTime` as a small chip in the **top-left corner** of the video face (`absolute top-2 left-2`), mirroring the 911 chip at `top-2 right-2`; hide the chip when `localTime` is null. The bottom overlay keeps `{propertyName} · {elapsed}`. `localTime` is already computed at `call-tile.tsx:103`. The audio face's existing "Hotel local time" clock is unchanged.
- 911 corner chip, Mute/Hang up/Connect, and the guest-video mirror are otherwise unchanged. `useSyncExternalStore` works across the `createPortal` into the PiP document.

### Tile layout (both channels)

```
┌─────────────────────────────┐
│ [face: guest video | clock] │  ← flex-1 (grows when captions off)
│                       (911) │  ← corner chip, audio-only
│─────────────────────────────│
│ caption band (when on&text) │  ← former notes slot; absent when off
│─────────────────────────────│
│ Mute · Hang up · CC · Connect│  ← control row
└─────────────────────────────┘
```

---

## Edge cases

- **DocPiP unsupported / `requestWindow` fails** → `tileMount` stays null → the overlay stays the full 50-50 (automatic fallback); captions render in the overlay as today. The tile remains a bonus, never a dependency.
- **Tile closed mid-call** ("Back to tab" or close) → `tileMount` null → overlay reverts to 50-50 (video panel un-hides) + "Reopen tile". **Reopen** → `tileMount` set → collapse again.
- **Answer moment** → she's on the portal when she answers; the overlay collapses to playbook-only and the tile opens with video. Acceptable — the guest is visible in the tile; she can close the tile for a big in-tab video if she prefers.
- **Captions enabled then call ends** → provider resets `captionsEnabled = false` → next call starts OFF (D7).
- **Guest video track timing** → the tile shows "Connecting video…" until the track arrives; the overlay is already playbook-only. Fine.
- **No focus/visibility flapping** — nothing keys off tab focus, so there's no twitch when she clicks the tile or moves between monitors.

## Verification (test-first)

jsdom-testable (extend the existing suites):

- **Provider** (`call-surface-provider.test.tsx`): `captionsEnabled` defaults `false`; `toggleCaptions` flips it; it resets to `false` when `active.callId` changes and when `active` → null; `publishCaptions` → `subscribeCaptions` listeners fire and `getCaptionSnapshot` returns the new (stable-until-changed) value.
- **`video-call.tsx`** (`video-call.test.tsx`): with the `collapsed` prop true, the guest-video stage (`data-testid="guest-video-stage"`) carries `hidden`; false → visible. (`video-call-host` maps `surface?.tileMount != null` → `collapsed`.)
- **`audio-call-overlay.tsx`**: with `collapsed`, the call card **and the caption band** carry `hidden` and `PlaybookPanel` gets the full-width basis; without, the `37%` / `63%` split and a visible band.
- **`CallTile`** (`call-tile.test.tsx`): notes inputs are gone; the CC toggle is present and calls `toggleCaptions`; the caption band renders only when `captionsEnabled` and there is text, and is absent otherwise; Mute/Hang up/Connect and the audio-only 911 chip are intact; `connectToProperty` still fires; the **video face renders `localTime`** when `active.timeZone` is set and omits it when null (D10).
- **`incoming-video` route** (`incoming-video.test.ts`): the response carries `timezone` per call from the property join (D10).

Not jsdom-testable — **smoke on prod** (the repo's standing lesson: *jsdom can't catch CSS-layout/PiP-window bugs*):

- Tile fills the 380×300 window; on a video call the guest feed fills the face **and a top-left chip shows the hotel local time** (D10, opposite the 911 chip); overlay collapses to playbook-only while the tile is up and returns to 50-50 on "Back to tab".
- Turn captions on from the **tile** → the band appears in the tile (and the overlay); turn off → gone. Captions start **OFF** on each new call.
- RustDesk **Connect** still launches; **911** two-tap still fires; hang-up still ends the call.

Then: `pnpm typecheck` · `pnpm lint` · full portal suite · `pnpm check:routes` · `next build`.

## Deploy

Merging to `main` **auto-deploys prod** (Coolify `lc-coolify` GitHub App → `lc-portal-prod`/`lc-kiosk-prod`). Vercel remains the frozen Agora standby (unaffected). No env changes.

## Non-goals

- No attention-aware / visibility-driven behavior (superseded, §Research).
- No PiP window auto-resize (impossible per the API); a manual in-tile enlarge button (gesture-allowed) is a possible future, not v1.
- No changes to call/Twilio/LiveKit/911 logic, no migrations, no new routes, no RLS (D10 only adds a read-only `timezone` select to the existing `incoming-video` route).

## Files touched

| File | Change |
|---|---|
| `components/dashboard/call-surface-provider.tsx` | caption `enabled`/`toggle` + per-call reset; caption-text external store (`publishCaptions`/`subscribeCaptions`/`getCaptionSnapshot`) cleared per call; drop dead `saveNote` from `RegisteredCallControls` |
| `components/call-tile/call-tile.tsx` | remove notes row; add caption band (former notes slot) + compact CC toggle; render hotel `localTime` as a top-left chip on the video face (D10) |
| `app/api/calls/incoming-video/route.ts` | add `timezone` to the `properties` select + per-call in the response (D10) |
| `lib/hooks/use-incoming-video-calls.ts` | `IncomingVideoCall` gains `timezone: string \| null` (D10) |
| `components/video-call/video-call.tsx` | add `collapsed` prop → hide guest-video stage + full-width playbook; read caption `enabled`/`toggle` from surface; `publishCaptions`; drop local `useCaptionsEnabled`; drop the now-removed `saveNote` from its `registerCallControls` call |
| `components/video-call/video-call-host.tsx` | publish `timeZone: active.timezone ?? null` (D10); compute + pass `collapsed = surface?.tileMount != null` |
| `components/softphone/softphone.tsx` | read caption `enabled`/`toggle` from surface; `publishCaptions`; pass `collapsed` (tile-open) to `AudioCallOverlay`; drop local `useCaptionsEnabled`; drop the now-removed `saveNote` from its `registerCallControls` call |
| `components/call/caption-toggle.tsx` | add a `compact?: boolean` prop (icon-only, for the tile) |
| `lib/captions/use-captions-enabled.ts` | delete (state now lives in the provider) — remove its test |
| `components/softphone/audio-call-overlay.tsx` | add `collapsed` prop — hide the call card + full-width playbook when the tile is up (caption props now sourced from the surface, passed through unchanged) |
| tests | `call-surface-provider.test.tsx`, `video-call.test.tsx`, `call-tile.test.tsx`, an `audio-call-overlay` collapse test, `softphone.test.tsx` (surface-sourced caption props / `collapsed`), `incoming-video.test.ts` (timezone in the response) (+ remove the `use-captions-enabled` test) |
