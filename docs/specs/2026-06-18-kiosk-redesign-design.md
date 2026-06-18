# Kiosk — LAYOUT redesign — DESIGN (proposed 2026-06-18)

**Status:** Shaped via the brainstorming visual companion; **proposed, pending review.** Not yet built.
**Brand phase:** the layout phase (`docs/brand/brand-guidelines.md` §5) applied to the **kiosk** — the
final brand-revision surface. Sign-in (§5.1), the agent/admin shell (§5.2), dashboards (§5.3), and the
owner portal are already shipped. The kiosk was repainted to brand tokens in **Stage 2** (PR #14); this is
the structural/layout pass that was deferred to "the kiosk page-pass."

**Scope:** the guest-facing kiosk app (`apps/kiosk/`) only — every screen recomposed in the brand's
layout language (the login-style split, drifting connection-lines, the seam), **plus one flow change**:
the blocking recording-consent screen is removed and folded into Ringing. All call/Agora/voice logic is
otherwise preserved. No portal changes except hiding one now-dead owner control (§9).

> **Decisions locked in brainstorming (2026-06-17/18):**
> 1. **Ambition = option C (full reimagining of composition), logic/flow intact.** Same screens, same
>    Agora call machinery; every screen recomposed.
> 2. **Recording notice → folded into Ringing.** No call is recorded in v1 (the `recording_url` column is
>    a dormant seam; `call-detail-body.tsx` says *"dark until call recording ships"*), so the blocking
>    consent screen is removed. Tapping goes straight to Ringing, which carries a quiet *"Calls may be
>    recorded for quality"* line. (Re-introduce explicit consent when recording actually ships.)
> 3. **Home = "tap anywhere to connect."** The whole screen is one call button. A **50/50** login-style split:
>    an **animated navy** invitation side (drifting connection-lines + a pulsing connect beacon + the line
>    *"Tap anywhere to connect with the front desk"*) joined by the **seam** to a **light** side holding the
>    time-aware greeting over a small elevated *Good to know* card.
> 4. **No Lobby Connect logo on the kiosk** — matches brand §2 ("Never on the kiosk"). The LC mark is
>    removed from Home and Loading; the **hotel's own name leads**.
> 5. **Self-view PiP, top-right, every call stage.** The guest's camera is a small PiP (never full-bleed),
>    pinned top-right in both Ringing and Connected.
> 6. **The owner-selectable `ctaStyle` picker (warm/accent/classic) is superseded** by the single fixed Home
>    composition (§9).

---

## 0. What changes vs. the current kiosk

The current kiosk (first build → Stage 2 repaint) has the right **flow** and **brand tokens**, but the
**old layout**: a 55/45 info-left / CTA-right Home, a blocking recording-consent card, a full-bleed
self-view while ringing, and an LC logo on Home + Loading. This redesign keeps the flow and **all call
logic**, and changes **composition + one transition**:

- **Home is fully recomposed** (§3) into the tap-anywhere login-style split with live motion.
- **The recording-consent screen is removed** (§8); the disclosure becomes a quiet line on Ringing.
- **Ringing is rebranded** (§4) — a "connecting" field (connection-lines + seam ring) with the self-view
  demoted to a top-right PiP and the recording line folded in.
- **Connected** keeps its Stage-2 strengths; the self-view PiP moves to **top-right** for consistency (§5).
- **Apology / Loading / Reconnecting** get consistency restyles; **Loading drops the LC logo** (§6).
- The **LC logo leaves the kiosk entirely** (§7).

**Unchanged:** the Vite SPA structure, the Agora client/session lifecycle, `lib/portal-api.ts`,
`lib/agora.ts`, `lib/connection.ts`, presence heartbeat, Sentry, the kiosk↔portal config DTO, and every
existing brand token. Light mode only. **No new kiosk dependency** (the connection-lines are pure CSS, not
the portal's `motion`-based component — §10).

---

## 1. Surface inventory

| Surface | File | Change |
|---|---|---|
| Home | `apps/kiosk/src/screens/Home.tsx` | **Rewrite** — tap-anywhere login-style split (§3) |
| Recording notice | `apps/kiosk/src/screens/RecordingNotice.tsx` | **Delete** — folded into Ringing (§8) |
| Ringing | `apps/kiosk/src/screens/Ringing.tsx` | **Rewrite** — connecting field + seam ring + PiP + recording line (§4) |
| Connected | `apps/kiosk/src/screens/Connected.tsx` | PiP → top-right; minor polish (§5) |
| Call controls | `apps/kiosk/src/screens/CallControls.tsx` | Keep; restyle to match (§5) |
| Apology | `apps/kiosk/src/screens/Apology.tsx` | Restyle (§6) |
| Loading / Reconnecting | `apps/kiosk/src/App.tsx` | Loading drops LC logo; Reconnecting aligned (§6) |
| Call machine | `apps/kiosk/src/state/call-machine.ts` | Collapse `disclosure` state (§8) |
| App orchestration | `apps/kiosk/src/App.tsx` | Wire tap → start call directly; remove RecordingNotice (§8) |
| Brand helpers | `apps/kiosk/src/components/brand.tsx` | Remove `LogoMark`; add `ConnectionLines` (§7, §10) |
| Tokens / motion | `apps/kiosk/src/index.css` | Add navy-panel gradient + connect-beacon / connection-line keyframes (§10) |
| Owner kiosk-content card | `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx` | Hide the now-dead CTA-style picker (§9) |

---

## 2. Layout language (applies to every screen)

Carried verbatim from the brand layout phase so the kiosk reads as one system with the portals:

- **The split** — navy "human/presence" side joined to a light side by a **3px vertical seam**
  (`--gradient-seam`), exactly as sign-in (§5.1).
- **Connection-lines** — a drifting field of faint teal+mint curved strokes on every navy surface (Home
  left, Ringing), echoing the seam (a line joining two points). Pure CSS (§10).
- **The seam** — vertical join on Home; the top hairline on light screens (Apology); the spinning **seam
  ring** on Ringing; the animated **seam frame** on Connected.
- **Type** — Raleway display (greeting/invitation/titles, weight **600** — the old thin "Good evening."
  bug is fixed), Outfit body, JetBrains Mono for info values.
- **Shape/touch** — kiosk radii (card 16 / button 12 / input 10), touch targets ≥56px.
- **Motion** — all new animation honors the existing `prefers-reduced-motion` net already in
  `index.css` (drift/breathe/pulse/spin all zero out under it).

---

## 3. Home — "tap anywhere to connect"

**The entire screen is one `<button>`** (`aria-label="Tap to connect with the front desk"`). Tapping
anywhere starts the call (→ Ringing). A 50/50 split:

**Left (50%) — navy, animated, the invitation:**
- Deep navy gradient panel (§10) carrying the drifting **ConnectionLines** field.
- Top-left: the **hotel name** (`config.welcomeHeading`) as a small uppercase Raleway label, cream —
  **text only**. The kiosk does **not** render `config.logoUrl` on Home (a hotel's own logo may clash with
  the navy panel, and the LC mark is barred by brand §2). The `logoUrl` field stays dormant in the config
  DTO (forward-compat) but is unused on the kiosk.
- Centered invitation block: a **connect beacon** (a 84px mint-ringed video icon with two expanding pulse
  rings), then the line **"Tap anywhere to connect with the front desk"** (Raleway 600, ~36px, "front
  desk" tinted mint), nothing else. (The old "Front desk open now" pill is removed.)
- 3px vertical **seam** down the right edge.

**Right (50%) — light, the reference:**
- Vertically centered column.
- The **time-aware greeting** (`greetingForHour` → "Good evening.", Raleway 600, navy).
- The optional **welcome message** (`config.welcomeMessage`) as a short muted line, if set (preserves the
  owner's custom welcome; omitted when null).
- A small **elevated *Good to know* card** (white, radius 14, `--shadow`-lift, **seam across its top
  edge** — same vocabulary as the sign-in form card). Inside: an uppercase "Good to know" label, then the
  info pairs that exist in config — **Check-in**, **Check-out**, **Wi-Fi** (network), **Password**, and
  **Breakfast** (full-width row). Each is a Raleway-uppercase label + a JetBrains-Mono value. Rows whose
  config value is null are omitted; the card hides entirely if nothing is set.

**Accepted trade-off:** because the whole screen taps, a guest reading the Wi-Fi could start a call by
tapping the card — recoverable in one tap via **Cancel** on Ringing. This is the right default for a
single-purpose lobby kiosk (the point of the device is to reach a person).

---

## 4. Ringing — the connecting field

A rebrand of the connecting moment (same logic: local tracks live, no-answer timer armed on join, Cancel
aborts). On the deep-navy video stage:

- Drifting **ConnectionLines** behind (the call literally "reaching out").
- Centered: a spinning **seam ring** (reuses `.seam-ring` + `.lc-anim-spin`) around a phone glyph; below
  it **"Ringing the front desk…"** (Raleway 600) and **"Someone's almost there"** (mono sub).
- The folded-in disclosure: a quiet **"Calls may be recorded for quality"** line (shield glyph, low-opacity
  white) under the subtitle.
- **Self-view PiP** top-right (§5 placement rule).
- Controls pill bottom-center: **Mute · Camera · Cancel** (Cancel = neutral, not red — red stays 911-only,
  which the kiosk has none of).

> The self-view is a **PiP, not full-bleed** (locked decision #5). The guest sees a branded connecting
> screen with themselves in the corner, rather than staring at their own full-screen camera.

---

## 5. Connected — keep, with PiP top-right

Essentially the Stage-2 screen (it was already strong): remote agent video full-bleed, the animated
**seam frame** (`.lc-seam-drift`), a top-left **"Connected · Front desk · mm:ss"** badge with a pulsing
mint dot, and the controls pill (**Mute · Camera · End**; End = neutral solid on the dark stage).

**Only change:** the **self-view PiP moves to top-right** (today it's bottom-right) so PiP placement is
identical across Ringing and Connected. It balances opposite the top-left status badge. `CallControls`
restyled to match Ringing (shared component, both stages).

---

## 6. Apology · Loading · Reconnecting

- **Apology** (light) — seam top hairline, a calm clock mark, **"Sorry to keep you waiting."** (Raleway
  600) + the existing apology message + the auto-return countdown. Logic unchanged (10s auto-return to
  Home; `ERROR` and `RING_TIMEOUT` both land here).
- **Loading** (`App.tsx`) — **drops the LC `LogoMark`** (brand §2). Becomes a calm centered **seam
  shimmer** (`SeamShimmer`, kept) + "Getting things ready…". `role="status"` kept.
- **Reconnecting** overlay — already a seam spinner over a dimmed dark stage; keep, align styling to the
  Ringing seam ring. `aria-live` kept.

---

## 7. The logo leaves the kiosk

Brand §2 is explicit: *"Never on the kiosk. Guest screens stay logo-free — the hotel's own name leads."*
- Remove `LogoMark` from `components/brand.tsx` and its two uses (Home fallback, Loading).
- Home identity = the **hotel name** (`welcomeHeading`) **as text only**. No image logo on the kiosk —
  not the LC mark (barred by §2) and not the hotel's `logoUrl` (decided 2026-06-18: a hotel's logo may
  clash with the navy panel; the field stays dormant in config, unused on the kiosk).
- `SeamTop` and `SeamShimmer` stay (they're brand-seam motifs, not the logo).

---

## 8. Flow change — remove the recording-consent screen

**Today:** `home --TAP_CALL--> disclosure` (RecordingNotice screen) `--(Continue) onAccept-->`
`ACCEPT_DISCLOSURE --> ringing`; the X fires `CLOSE_DISCLOSURE --> home`. The blocking screen covered the
`startCall`+token+Agora-join latency.

**After:** the tap starts the call immediately and shows the connecting (Ringing) screen during that
latency. Specifically:
- **`call-machine.ts`:** drop the `disclosure` screen from `KioskScreen`; drop the `CLOSE_DISCLOSURE`
  action. **`TAP_CALL` now transitions `home → ringing`** (optimistic "connecting"). Rename
  `ACCEPT_DISCLOSURE → CALL_STARTED` — it now only records `callId`/`channelName` (screen already
  `ringing`, unchanged). `shouldFireRingTimeout` is unchanged (still `screen === "ringing"`).
- **`App.tsx`:** Home's `onCall` dispatches `TAP_CALL` (→ ringing) **and** runs the existing `onAccept`
  async body (startCall → token → `joinChannel`); on success it dispatches `CALL_STARTED` (ids only) and
  arms the 120s no-answer timer **after join, exactly as today**; on failure → `ERROR` → apology. Delete
  the `RecordingNotice` import + the `disclosure` case.
- **Delete** `screens/RecordingNotice.tsx` and the `recording` copy block usage there (the `copy.recording`
  strings can be dropped or kept for the future consent screen — keep, harmless).
- The 120s window still starts at agent-join, so no timing regression. The Cancel path during the connecting
  phase calls the existing `onCancel` (which `endCall(..., "cancelled")` + teardown).

**Tests** (`tests/state/call-machine.test.ts`): rewrite the disclosure cases —
`home → ringing on TAP_CALL`, `CALL_STARTED records ids`, drop the `CLOSE_DISCLOSURE`/`disclosure` cases,
update the "does NOT fire on home/apology" timeout test (no `disclosure`).

---

## 9. The `ctaStyle` picker is superseded

The owner-selectable `kiosk_cta_style` (warm/accent/classic, migration 0015) only varied the **old** Home's
CTA-panel colors. The new Home is a single fixed composition with no such variant, so the kiosk stops
reading `config.ctaStyle`.

- **Kiosk:** `Home.tsx` no longer references `ctaStyle`; the `CTA_STYLES` map is deleted.
- **DB / API:** the `properties.kiosk_cta_style` column and the `config` route field are **left dormant**
  (no destructive migration — consistent with the project's forward-compat seams). The config DTO keeps the
  field; the kiosk simply ignores it.
- **Owner portal:** **hide the CTA-style picker** in `kiosk-content-card.tsx` so owners aren't offered a
  control that no longer does anything. The save action / column / API stay intact (re-enable seam). This is
  the only portal-side edit in this work.

> **Decided (2026-06-18): hide the owner picker now.** Repurposing the three styles for the new design was
> considered and rejected — the composition has no equivalent variation point.

---

## 10. New CSS / component work (no new dependency)

- **`ConnectionLines`** — a new kiosk-local component in `components/brand.tsx`: an `aria-hidden` SVG of a
  few layered curved strokes (teal + mint via the brand hexes) with CSS **drift** + **breathe** keyframes.
  It is the kiosk's dependency-free echo of the portal's `floating-paths.tsx` (which uses the `motion`
  package — **not** added to the kiosk; the kiosk stays lean and the visual is close at tablet scale). Used
  on Home-left and Ringing. Honors the reduced-motion net.
- **Connect beacon** — the Home invitation icon: a mint-ringed core with two expanding **pulse** rings
  (a `@keyframes` scale+fade, like a softened `.lc-anim-pulse`).
- **Navy panel gradient** — a token (e.g. `--gradient-brand-panel`) for the Home-left / video-stage deep
  navy, derived from the brand navy anchors (consistent with the sign-in navy panel and the §5.3 header).
  Exact stops finalized in the plan; intent = deep navy with a faint teal lift.
- **Reused as-is:** `--gradient-seam`, `.seam-ring`, `.lc-anim-spin`, `.lc-seam-drift`, `.lc-anim-shimmer`,
  `--color-call`, all color/shape tokens.

---

## 11. Constraints (carried)

- **Light mode only.** Brand-semantic color: mint = connect/live/primary action, teal = the seam/lines,
  navy = the presence/video stage. **No red** anywhere on the kiosk (no 911 path here). No blaze.
- **No migrations, no RLS changes, no API-route changes** (the config route is untouched; the dormant
  `ctaStyle` field stays). **No Agora/voice/call-lifecycle changes** beyond the §8 disclosure collapse.
- **No new dependency** (connection-lines are CSS, not `motion`).
- The kiosk↔portal config DTO (`@lc/shared/kiosk-api.ts`) is unchanged.

---

## 12. Build order (the plan will detail)

1. Tokens + `ConnectionLines` + connect-beacon keyframes in `index.css` / `brand.tsx`; remove `LogoMark`.
2. Call-machine collapse (`disclosure` → folded) + tests (TDD: rewrite the machine tests first).
3. `App.tsx` rewiring (tap → start; remove RecordingNotice; Loading logo drop).
4. Home rewrite (the split, the tap-anywhere button, greeting/welcome/Good-to-know).
5. Ringing rewrite (connecting field + seam ring + PiP + recording line).
6. Connected PiP → top-right + `CallControls` restyle; Apology + Reconnecting restyle.
7. Owner `kiosk-content-card.tsx` — hide the CTA-style picker.
8. Verify: `pnpm -F @lc/kiosk test` + `build`; portal `test`/`typecheck`/`lint`/`check:routes`; full-flow
   smoke on the Vercel kiosk deploy (Twilio/Agora only work on prod, per the deploy-and-smoke memory).

---

## 13. Decisions resolved in review (2026-06-18)

1. **Owner CTA-style picker** (§9) — **hidden** from the owner portal now.
2. **Hotel logo on Home** — **text name only**; the kiosk does not render `logoUrl` (may clash with navy).
3. **Home split ratio** — **50/50** (the whole screen is a CTA anyway).
