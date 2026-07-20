# Call-control consistency + dashboard-column polish — design

**Date:** 2026-07-20
**Status:** GATED (Kumar approved the plan conversationally 2026-07-20; written spec for review)
**Scope:** UI/UX only. **Zero** migrations, new API routes, or RLS changes. No change to call routing, duty semantics, or 911 machinery. Spans **portal** (most items), **kiosk** (one control-pill tweak), and one **captions** teardown fix.

Follows the duty-column + call-surface polish merged 2026-07-19 (`dfc8700`). Kumar's live prod review found UI/button inconsistencies across the in-call surfaces and the dashboard right column; this pass resolves them.

Mockups: none — every target is an existing shipped surface Kumar annotated directly. Verification is live prod smoke, not mockups (standing lesson: verify UI by looking at + interacting with the real thing, never by reasoning — `[[kiosk-css-animation-reverted]]`).

---

## 1. Why

The 2026-07-19 work extracted `<CallShell>` + `<CallControls>` and normalized the property cards, but a live pass surfaced residual inconsistencies:

- The in-call control bars order and size controls differently across the three surfaces (audio overlay, video overlay, call tile), and the terminating control drifts in label, fill, and position.
- The dashboard right column's cards don't align to the left column's vertical rhythm and collapse when off duty.
- Three smaller items: a card button missing its icon, a status pill that contradicts the duty copy beside it, and a pre-existing captions Sentry error.

None is a functional bug. This is a consistency + polish pass.

## 2. Scope

### In

| # | Area | Change |
|---|---|---|
| A | In-call control bars (both overlays + tile) | One **unified left→right order**; normalize height/radius/icon per surface; no wrapping |
| B | Terminating control | **`End call`, blaze fill, far right on every surface** (video adopts blaze) |
| C | Reopen-tile control | **Round mint-outlined corner icon on both overlays** (audio moves off the bar) |
| D | Video/Chat toggle (tile) | Teal active segment fills its half flush (kill the inner gaps) |
| E | Property card | `Answer` gains an icon so it aligns with its three icon'd siblings |
| F | Dashboard right column | Vertical rhythm vs the left column; cards hold height off duty |
| G | Softphone status pill | Duty-aware — stops claiming "Line ready" while off duty |
| H | Captions teardown | Swallow the async `stopRecognition()` rejection (Sentry noise) |
| I | Kiosk call-control pill | Even the spacing around the pill's rounded ends |

### Out

- Duty semantics, call routing, 911 machinery, playbook content, presence routes — all untouched.
- The softphone card's copy edit (still deferred to a later UX pass, per the 2026-07-19 spec §3.1).
- Converting the softphone's hand-rolled card `<div>` to `<Card>` (still out).
- Any migration / route / RLS change.

### Reconciles (intentionally overrides) three 2026-07-19 decisions

This pass deliberately reverses three decisions from `docs/specs/2026-07-19-duty-column-and-call-surface-polish-design.md`. Each prior rationale is recorded so the reversal is a decision, not drift, and **the prior spec's comments must be updated in the same commit** (see §9):

1. **§5.4 grouped `Connect` + `End call` together, divider-separated from the toggles.** → Now `Connect` and `End call` are the two **bookends** (far left / far right) with the toggles between them (§3).
2. **D11 / `call-controls.tsx` `EndCallButton`: navy on video, blaze on audio.** → **Blaze on both** (§3.3). The audio blaze existed to disambiguate `End call` from the red 911 button that shares audio's surface; video has no 911 anywhere, so it loses nothing but the navy.
3. **§6: audio keeps the reopen control as a bar button "because it has no video stage."** → Audio's call-card panel is a perfectly good corner; the reopen icon goes there, matching video (§3.4).

## 3. In-call control bars

Three surfaces render an in-call bar: the audio overlay (`audio-call-overlay.tsx`), the video overlay (`video-call.tsx`), and the DocPiP call tile (`call-tile.tsx`). They must read as one system.

### 3.1 Unified order (left → right)

**`Connect · Mute · [Camera | Video-Chat] · Captions · End call`** — `Connect` is always the left bookend of the control cluster; `End call` is always the far-right bookend. The middle slot is per-surface:

| Surface | Bar contents, left → right |
|---|---|
| Audio overlay | `[Room# + Notes inputs]` · **Connect** · Mute · Captions · **End call** |
| Video overlay | `[Room# + Notes inputs]` · **Connect** · Mute · Camera · Captions · **End call** |
| Call tile (audio) | **Connect** · Mute · Captions · **End call** |
| Call tile (video) | **Connect** · Mute · Video/Chat · Captions · **End call** |

- On the **overlays**, the `Room# + Notes` input group keeps its far-left `flex-1` position; the control cluster packs to the right of it in the order above. A thin divider sits before `End call` so the terminating control reads as isolated (mistap safety), replacing the old Connect/End grouping divider.
- **The `CallControlTray`'s `ml-auto` push is removed** — the input group's `flex-1` already right-packs the cluster, and `ml-auto` on the tray would strand `Connect` on the left with a gap instead of the requested tight sequence. Whether the middle toggles keep a visual group box is an implementation detail, but if one is kept it must **not** reintroduce the `1.08:1` tray-fill contrast question flagged in `call-controls.tsx` (drop the fill; rely on position + the blaze `End call` for separation). Default: drop the tray container, sequence the toggles flat.
- On the **tile** (no inputs), `Connect` is the left bookend and `End call` the right bookend; `End call` is pushed right (`ml-auto` on its wrapper) so a small gap separates it from the toggle cluster.
- The **Camera** toggle exists only on the video *overlay*. The **Video/Chat** segmented toggle exists only on the video *tile*. Audio has neither. This is why the middle slot is described as a per-surface set, not a fixed list.

**Why `Connect` far left, not grouped with `End call`:** Kumar, 2026-07-20 — muscle memory reaches for the far-right control to end a call. `End call` owns the far right on every surface; `Connect` (the "do the work" action) leads on the left. The two most consequential actions sit at opposite, predictable edges.

### 3.2 Normalization

Within each surface, every control in the bar shares one height, one corner radius, and one icon size, and **no control wraps**:

- **Overlays:** already on the shared `<Button>`/`<CallControls>` scale (h-8). The reorder is the only structural change; keep the existing `CallToggleButton` fixed widths (`w-28`) and the caption toggle's fixed box (`w-36`) so nothing reflows on a state change (2026-07-19 §5.3, preserved).
- **Tile:** the bar mixes three sizes today — hand-rolled Mute/Hang up (`px-2 py-1 text-xs`, 13px icons), the `CaptionToggle compact` (`px-2 py-2 text-sm`, **16px** icon → visibly taller), the Video/Chat segmented toggle, and the `PropertyActionButton size="xs"` Connect. Normalize all to **one compact height** (the `text-xs` / `py-1` / 13px-icon scale), **`rounded-button`** on every control, and `whitespace-nowrap shrink-0` so the 380px window can't wrap a label (this is what makes `End call` — longer than `Hang up` — fit without breaking to two lines).
  - The `CaptionToggle compact` branch drops `py-2` → `py-1` and its icon 16 → 13 to match. Colour/contrast logic in `caption-toggle.tsx` is unchanged (it is measured against the navy tile surface; only the box size changes).
- **Corner radius:** unify every tile-bar control on `rounded-button`; the Video/Chat inner segments align to their container's radius (see §3.5). The video *face* keeps `rounded-md` — it is the video element, a different object, not a bar control.

### 3.3 `End call` — blaze, far right, both surfaces

- Label **`End call`** everywhere (the tile's `Hang up` is relabelled).
- Fill **blaze** (`bg-attention`) on both overlays and the tile. `EndCallButton`'s `tone` prop already supports this; the video overlay flips `tone="navy"` → `tone="blaze"`. The tile's hand-rolled End button already uses `bg-attention` — it only needs the relabel + reposition.
- Always the far-right control, visually the heaviest in the bar.
- **911 is unaffected.** It never shares the bar: audio's 911 is the header dialog (overlay) / the face-corner two-tap (tile), both isolated from `End call`. Blaze-on-both does not put a CTA-coloured button next to 911 anywhere it wasn't already.

### 3.4 Reopen-tile control — round mint corner icon on both

Video already renders the reopen control as a round mint-outlined ~38px icon button in the bottom-right corner of the guest stage (`video-call.tsx`). **Audio adopts the same treatment**: the reopen control leaves the audio bar and becomes the identical round mint icon in the **bottom-right corner of the audio call-card stage** (the left panel that shows the live pulse + hotel local time). Same icon (`PictureInPicture2`), same `aria-label="Reopen tile"` + `title` tooltip, same mint outline on a scrim.

Only shown when `showReopenTile` is true (the agent closed the tile mid-call). Removing it from the audio bar also frees the space the reorder needs.

### 3.5 Video/Chat toggle fill (tile)

The segmented Video/Chat toggle's active segment currently sits inside a `p-0.5`/`gap-0.5` container with `rounded-[3px]` segments, leaving a visible teal-to-border gap on the active half. Fix so the **active segment fills its half flush** — the teal reaches the container's inner edges, with the container radius and the active-segment radius consistent. No gap around the fill.

## 4. Property card — `Answer` icon (E)

`Answer` (`property-card.tsx`) renders label-only while its three siblings — `Silence` (`BellOff`), `Connect` (`Monitor`), `Kiosk` (screen icon) — lead with an icon, so `Answer`'s text baseline sits off from the others. Give `Answer` a leading `Phone` icon. Applies on both the agent `PodCardGrid` and the admin `FleetBoard` (same slot-based card). No behaviour change.

## 5. Dashboard right column — vertical rhythm + off-duty stability (F)

The home aside (`dashboard-workspace.tsx:88-108`) is `flex flex-col gap-3` inside `grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]`, holding Softphone → Shift → Clocks (+ headless VideoCallHost). `items-start` makes the aside content-height and top-aligned, so it neither fills the column nor tracks the left column's rows, and the Shift card collapses off duty ("Not on duty" is one line).

Kumar's asks (annotated on the screenshots):
1. Softphone + Shift together should read as the left column's first block (their bottom near the left's stats+chart bottom).
2. Clocks pushed down to line up with the bottom of the properties tile.
3. Cards must not shrink when off duty.

**Approach (recommended, robust):**
- Let the aside **stretch to the column height** (`items-stretch` for the home grid, or `self-stretch` + `h-full` on the aside) and make it a full-height flex column.
- **Pin the Clocks card to the bottom** with `mt-auto`, so it aligns to the bottom of the left content (both columns stretch to the same total height) — satisfies (2).
- **Hold Softphone + Shift at the top** as the first block — satisfies (1) as a grouping; the gap opens between Shift and Clocks.
- **Stabilize off duty (3):** give the Shift card a **min-height** so its off-duty "Not on duty" state occupies the same box as its on-duty state, and confirm the Softphone card's off-duty height matches its on-duty height (the ring + copy are near-identical; verify at smoke). Height is a **min**, never a hardcoded fixed pixel value — the root font scales to 112.5% at `lg`, so the reservation must tolerate the type scale (same rule as the 2026-07-19 §3.6b card-row reservation).

**Trade-off (flag for review):** pixel-perfect row alignment across two *content-driven* columns is brittle — the left's stats/chart/properties heights are data-dependent. This approach gets the **rhythm** right robustly (two cards up top, clocks pinned to the bottom edge, no off-duty collapse) without pinning magic heights that drift the moment content changes. If Kumar wants tighter than "reads aligned," the fallback is explicit min-heights on the top block tuned to the current left content — recorded as brittle, to revisit if the left layout changes. **This is the one item where the mechanism is worth Kumar's eye at spec review.**

Applies to the shared aside, so it affects both agent and admin home.

## 6. Softphone status pill — duty-aware (G)

`LinePill` (`softphone.tsx:1030-1059`) is driven purely by the Twilio `phase`; off duty with the device still registered it shows green **"Line ready"** directly beside the card's **"Your line is offline."** — a contradiction.

Make the pill duty-aware: **when off duty, render the muted "off" style** (the existing `bg-muted`/`text-text-muted` non-`ok` branch) with a label that agrees with the copy — **"Off duty"**. On duty, the existing phase logic stands (`Line ready` / `Incoming` / `On call` / `Connecting` / `Offline`). The softphone already holds `onDuty`/`canWork`; pass it to `LinePill`. In-call cannot occur off duty, so no conflict with the `On call` label.

## 7. Captions teardown — swallow the async rejection (H)

`provider.ts:78` calls `client?.stopRecognition?.({ noTimeout: true })` inside a synchronous `try/catch`. When the Speechmatics WebSocket is still `CONNECTING` (captions toggled on then the call ended before the socket opened), the SDK's `stopRecognition` **rejects asynchronously** (`InvalidStateError: Failed to execute 'send' on 'WebSocket': Still in CONNECTING state`), so the sync `catch` never sees it → unhandled rejection → Sentry (`/admin`, seen 2026-07-19 post-deploy).

Pre-existing (captions v1.1, untouched by the duty work), harmless to the user (captions simply never started), but noisy. **Fix:** attach a `.catch(() => {})` to the returned promise, e.g. `void Promise.resolve(client?.stopRecognition?.({ noTimeout: true })).catch(() => {});` — the vendor's own teardown rejection is expected during a connect-then-abort and is not actionable. Keep the sync `try/catch` for a synchronous throw.

## 8. Kiosk call-control pill — even the corner spacing (I)

`apps/kiosk/src/screens/CallControls.tsx` — the `rounded-pill` container (`px-3 py-2.5`, `items-end`, `gap-3`) holds `size-14` circular buttons; the fully-rounded pill ends crowd the first/last circle so the spacing "feels off." Adjust the container padding so the whitespace around the rounded ends reads even against the inter-button gap. Small visual tune; **kiosk is a separate app** (untouched by the portal branch) and **must be verified on the real tablet**, not reasoned about. Lowest priority in this pass; safe to land last or split out if it needs device iteration.

## 9. Comment / spec reconciliation (do in the same commit)

Because §2 reverses three prior decisions, the load-bearing comments that assert the *old* rationale must be updated so a future reader (or reviewer) doesn't "fix" this back:

- `call-controls.tsx` `EndCallButton` docblock — currently states navy-video/blaze-audio is the deliberate split; rewrite to "blaze on both (2026-07-20); the audio-only 911 disambiguation reason no longer forces a per-surface difference."
- `call-controls.tsx` `CallControlTray` / §5.4 grouping comment — update to the bookend model (Connect left, End call right).
- `audio-call-overlay.tsx` reopen-control comment (the long "audio has no stage, so the bar is the only sane placement" block) — rewrite to the call-card-corner placement.
- The 2026-07-19 spec is **not** edited (git history holds it); this spec's §2 "Reconciles" table is the superseding record, per the repo's "specs evolve in new dated files, not v2 edits" convention for decisions this significant.

## 10. Testing

**jsdom / unit (portal):**
- In-call bar order: assert the DOM order `Connect → Mute → [Camera|Video-Chat] → Captions → End call` on each surface (query by accessible name; assert relative document position).
- `End call`: label is `End call` on all three; blaze fill class present on video (regression on the flipped `tone`); it is the last control.
- Tile normalization: all bar controls share the height/radius class; `CaptionToggle compact` no longer carries `py-2`.
- `Answer` renders its icon.
- `LinePill`: off duty → muted "Off duty"; on duty + ready → "Line ready". This is the load-bearing test for §6.
- Reopen icon: exposes its accessible name on the audio overlay (now icon-only) as it already does on video.
- Existing pins that must stay green (do not break): `call-tile.test.tsx` Connect `bg-accent` + disabled-by-`unavailableReason`; `audio-call-overlay.test.tsx` caption-band `hidden`/`audio-call-card` test-id; `call-shell.test.tsx` split mapping; the `softphone.tsx:587` accept-gate tests (never mock `duty-provider`).

**kiosk:** no logic change; existing `CallControls` tests stay green (padding-only).

**captions (H):** a unit test that `stop()` while `stopRecognition` returns a rejecting promise does **not** produce an unhandled rejection.

**Not jsdom-verifiable — prod smoke required (real hardware):**
- The bar order/spacing/rounding on each surface; `End call` blaze reads unmistakable and 911 still clearly separate (audio).
- Reopen icon in the audio call-card corner (placement, mint outline on the scrim).
- Video/Chat teal fills flush.
- Column rhythm: softphone+shift as the top block, clocks bottom-aligned with the properties tile, **no collapse when toggling off duty** (toggle it live and watch the column).
- Kiosk pill spacing on the tablet.

**Regression guard:** the 911 paths (audio dialog + tile two-tap), notes save, and all emergency/call handlers stay byte-identical — this pass only reorders/restyles controls and flips one fill token; it moves no call logic. Review the touched overlay/tile diffs line-by-line for any handler relocation.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Reordering the bar accidentally relocates a handler or the 911 trigger | Reorder is JSX-position only; byte-review the emergency/notes handlers unchanged. |
| Tile 380px still wraps with `End call` (longer than `Hang up`) | `whitespace-nowrap shrink-0` on every bar control + the compact normalization; verify at smoke in the real PiP window. |
| Column stretch changes the off-home hidden aside or the always-mounted softphone/VideoCallHost lifecycle | Only the *home* grid alignment changes; the `hidden` off-home class and mounted-always invariant (`dashboard-workspace.tsx`) are untouched. |
| Pixel-perfect column alignment proves impossible/brittle | Explicitly scoped to "reads aligned, robustly"; §5 flags the fallback and its cost. |
| Blaze `End call` on video reads as an alert rather than a CTA | Reviewed live at smoke; it is the same fill audio has shipped since 2026-06-18. |
| Kiosk change needs device iteration | Lowest priority; may land last or split out. |

## 12. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Unified bar order `Connect · Mute · [mid] · Captions · End call`, bookended | Kumar 2026-07-20. Muscle memory: End call far right on every surface; Connect leads on the left. Reverses 2026-07-19 §5.4 grouping. |
| D2 | `End call`, blaze, both surfaces | Kumar 2026-07-20. Video has no 911, so the navy/blaze split (2026-07-19 D11) bought nothing; consistency wins. |
| D3 | Reopen = round mint corner icon on both | Kumar 2026-07-20. Audio's call-card is a fine corner; the "no stage" reason (2026-07-19 §6) doesn't hold. |
| D4 | Normalize tile bar to one compact scale | Kumar 2026-07-20 ("caption button bigger", "rounding inconsistent"). |
| D5 | Video/Chat active segment fills flush | Kumar 2026-07-20 ("teal not filling the chat half, gaps all around"). |
| D6 | `Answer` gets a `Phone` icon | Kumar 2026-07-20 ("no icon throws off the alignment"). |
| D7 | Column: stretch aside + `mt-auto` clocks + min-height top block | Kumar 2026-07-20 (three annotations). Robust rhythm over brittle pixel-matching; §5 flags the trade-off. |
| D8 | `LinePill` duty-aware ("Off duty" when off duty) | Noticed 2026-07-20; contradicts "Your line is offline." beside it. |
| D9 | Swallow the captions `stopRecognition` async rejection | Sentry noise, pre-existing, one-line fix. |
| D10 | Even the kiosk control-pill corner spacing | Kumar 2026-07-20; kiosk is a separate app, verify on the tablet. |

## 13. Follow-ups (not this spec)

- Softphone card copy edit (still deferred to a later UX pass).
- Dead code: `ChannelBar` / `ChannelLegend` in `channel-viz.tsx` (zero references) — noted 2026-07-19, still unaddressed.
- Housekeeping: 21 untracked `"… 2.tsx"` duplicate files under `apps/portal` (byte-identical sync artifacts) — safe to delete, unrelated to this work.
