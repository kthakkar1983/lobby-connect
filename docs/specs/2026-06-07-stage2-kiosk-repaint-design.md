# UI/UX Stage 2 (Kiosk) — Design

**Created:** 2026-06-07 (session 9). **Status:** LOCKED — ready for `writing-plans`.
**Parent plan:** `docs/plans/2026-06-07-ui-ux-polish-stages.md` (Stage 2, surface 1 of 3).
**Direction source:** `docs/specs/2026-06-07-ui-ux-stage0-design-direction.md` (LOCKED).
**Foundation it builds on:** Stage 1 (`docs/plans/2026-06-07-ui-ux-stage1-foundation.md`, PR #13 merged) —
brand tokens, self-hosted fonts, re-skinned shadcn primitives, `Wordmark`/`LogoMark`.

This is the per-surface repaint of the **kiosk** (`apps/kiosk/`) — the guest-facing tablet,
highest-priority surface (guests see it). It is its own PR. Owner and Agent/Admin repaints are
separate later sessions.

Mockups (gitignored): `.superpowers/brainstorm/43481-1780826191/content/` — `home-A-swapper.html`,
`call-screens.html`, `support-screens-v2.html`, `owner-picker.html`.

---

## 1. Scope

**In scope**
1. Repaint all kiosk screens to the locked brand: **Home, Recording notice, Ringing, Connected,
   Apology**, plus the **Reconnecting overlay** and the **Loading** (config-fetch) state.
2. Remove the deferred hardcoded hex from `Ringing.tsx` / `Connected.tsx` / the
   `ReconnectingOverlay` (`#27272a`, `#b91c1c`, `#000`, `#fff`, raw `rgba`) — route through tokens.
3. **Owner-configurable kiosk Home style** (`kiosk_cta_style`): a 3-way preset the hotel owner
   picks from the owner portal. Ships all three; default **Warm**. This deliberately crosses into
   the owner-portal surface (one card control + one column) — see §4.
4. One **new brand token** for the dark call backdrop (§5).
5. A small **state-machine addition**: close-from-disclosure (§6).

**Out of scope** (later stages / sessions)
- Owner-portal *repaint* (next Stage 2 session) — only the appearance picker control lands now.
- Agent/Admin repaint, agent-side video overlay.
- Any voice/Agora/business-logic change. This is visual + one additive setting. Call routing,
  finalization, presence, emergency — all untouched.

## 2. Locked constraints (from CLAUDE.md / Stage 0)

- **No hardcoded hex** — everything through the kiosk `@theme` tokens in `apps/kiosk/src/index.css`.
- **Tablet, landscape**, single-tenant pilot. Touch targets ≥ 56px (kiosk override).
- Brand: Solitude (display serif, large only), Outfit (UI/body), JetBrains Mono (data/timers),
  Vonique 43 (labels). Seam gradient `navy→mint→coral` as line/ring work only. Coral = action.
- Voice: calm, warm, plain-spoken; never alarmist; never blame the guest.
- Motion: 150–250ms, transform/opacity only, ease-out; **honor `prefers-reduced-motion`**.

## 3. Screen designs

The kiosk is **landscape**. Coral (`--color-accent-strong`, deep coral) is the consistent
**call-action color** across every screen — only the Home panel composition varies by owner preset.

### 3.1 Home  (`screens/Home.tsx`)
**Direction A — Concierge Split, 55 / 45.**
- **Left 55% (info):** `LogoMark` + hotel name (Vonique label), a large **Solitude greeting**
  (the heading), a muted Outfit welcome line, then the hotel-info block pushed to the bottom as a
  quiet **2×2 grid** (no heavy card; label in Vonique micro-caps, value in **JetBrains Mono**).
  Rows render only when their config value is present (existing `Row` null-guard behavior).
- **Right 45% (action):** a full-height panel with the seam hairline along its top edge, a large
  video glyph (lucide), the **"Talk to the Front Desk"** label, and a one-line reassurance sub.
  Tapping anywhere on the panel starts the call (`onCall`). Min height ≥ 56px is trivially met.
- **Seam hairline** runs along the very top of the screen (full width).
- The right panel's fill/text + greeting color are driven by `kiosk_cta_style` (§4):

  | Preset (`kiosk_cta_style`) | Panel fill | Panel text | Greeting color |
  |---|---|---|---|
  | `warm` *(default)* | deep coral | white | navy |
  | `accent` | navy (ink) | base coral | navy |
  | `classic` | navy (ink) | white | deep coral |

  `accent`'s sub-line must use a brightened coral (base `--color-accent`, not deep) or be dropped to
  near-white — deep-coral-on-navy at small size fails AA. Implementation keeps the sub readable.

### 3.2 Recording notice  (`screens/RecordingNotice.tsx`, screen `disclosure`)
- Centered **white card** on the page background, seam hairline at screen top.
- Lucide shield icon (coral), **Solitude** title *"Before we connect you"*, muted body:
  *"Your call with the front desk may be recorded for training and quality. Tap continue when
  you're ready."*
- One primary action: **coral "Continue"** (→ `onAccept`). **No "cancel" text button** (matches the
  original single-button spec).
- A small **X / close** control in the **top-right corner of the screen** (≥ 44px), that closes back
  to Home (→ new `CLOSE_DISCLOSURE`, §6). This is the only escape and is deliberately quiet.

### 3.3 Ringing  (`screens/Ringing.tsx`)
- Full-bleed **self-view** video on the **deep-navy call backdrop** (`--color-call`, §5), slightly
  dimmed by a navy scrim so the overlay reads.
- Centered **calling indicator**: the **seam gradient as a slowly-rotating ring** around a phone
  glyph; **Solitude** *"Ringing the front desk…"*; a **mono** reassurance/elapsed line.
- A small **"You"** label (Vonique micro-caps) marks the self-view.
- **Control bar** (§3.7): Mute · Camera · **Cancel** (coral). Cancel → `onCancel`.
- Seam-ring motion is a slow, fine gradient drift (1–2px effective ring); disabled under
  reduced-motion (falls back to a static seam ring).

### 3.4 Connected  (`screens/Connected.tsx`)
- Full-bleed **agent (remote) video** on the deep-navy backdrop.
- **Seam frame:** a thin (1–2px) seam-gradient border around the whole video area — the "connected"
  motif (the ring from Ringing has *resolved* into a steady frame). Optional very-slow gradient
  drift; static under reduced-motion.
- **Status pill** top-left: soft-pulsing **mint dot** + the word **"Connected"** + agent name +
  **mono** call duration. Connection is signalled three ways (dot + word + name) — never color alone.
- **Self-view PiP** bottom-right: rounded, thin light border, **"You"** label.
- **Control bar:** Mute · Camera · **End** (coral). End → `onEnd`.

### 3.5 Apology  (`screens/Apology.tsx`)
- Centered, calm, seam hairline at top. **Solitude** title *"Sorry to keep you waiting."*, muted
  body: *"The front desk is helping another guest right now. Please try again in a couple of
  minutes."*
- **No phone number, no "reach the hotel directly," no "someone will be with you right away."** Just
  an apology + agent-busy + try-again. (Hotels may post their own physical "emergency number" note;
  not our screen's job.)
- Auto-returns home after the existing 10s timeout, shown as a **visible mono countdown**
  ("Returning to home in 8s…") instead of a silent jump. → `onDone`.
- **Copy source:** default string lives in the kiosk render; `config.apologyMessage`
  (`kiosk_apology_message`, owner-editable) overrides the body when set. `config.phoneNumber` is **no
  longer rendered** on this screen but **stays in `KioskConfig`/schema** (forward-compat).

### 3.6 Reconnecting overlay  (`App.tsx` `ReconnectingOverlay`) & Loading
- **Reconnecting:** brand-navy scrim (`--color-call` at ~66% alpha, **not** pure black) over the live
  call; a fast seam spinner; *"Reconnecting…"* + a quiet reassurance line. Resolves back to the call
  or falls through to Apology (unchanged logic).
- **Loading** (the `if (!config)` branch in `App.tsx`): replaces the bare *"Loading…"* with a
  centered **`LogoMark` + hotel-name** (once known) and a thin **seam shimmer** line. Calm, brief.

### 3.7 Shared control bar
A reusable kiosk control component (new, e.g. `screens/CallControls.tsx`):
- Floating rounded bar, **navy-tinted translucent** background (not decorative glass), centered at
  the bottom.
- Each control = a round **icon button (lucide)** + a small text label beneath. Icon buttons ≥ 56px
  touch target. Tactile `scale(0.96)` on `:active`.
- Two ghost toggles (Mute, Camera — label flips with state, e.g. "Mute"/"Unmute") + one **coral**
  primary (End / Cancel). **Red is reserved for true emergency and is not used on the kiosk.**
- Used by both Ringing and Connected (props decide whether the primary is End vs Cancel).

## 4. Owner-configurable kiosk style (`kiosk_cta_style`)

The owner picks their kiosk Home look from the owner portal. Ships all three presets; resolves the
"which one" question per-hotel rather than globally.

### 4.1 Data — migration `0015_kiosk_cta_style.sql`
- `alter table properties add column if not exists kiosk_cta_style text not null default 'warm'`
  with `check (kiosk_cta_style in ('warm','accent','classic'))` — **text + CHECK**, matching the
  roles convention (locked decision #2), not a Postgres enum.
- **Extend the Plan-7b column guard** `enforce_owner_property_columns()` (migration 0010) to add
  `'kiosk_cta_style'` to **both** whitelist arrays, so an OWNER may write it under RLS (the existing
  `properties_owner_update` row policy already covers the row; the trigger gates columns). Service
  role still skips the guard. Idempotent `create or replace`.
- No new RLS policy needed; no other table touched.

### 4.2 Kiosk wiring
- `KioskConfig` (`apps/kiosk/src/types.ts`) gains `ctaStyle: "warm" | "accent" | "classic"`.
- `app/api/kiosk/config/route.ts`: add `kiosk_cta_style` to the `.select(...)` and return
  `ctaStyle: p.kiosk_cta_style ?? "warm"`.
- `Home.tsx` renders the matching variant from `config.ctaStyle` (table in §3.1). Pure presentational
  switch; no logic branches elsewhere.

### 4.3 Owner portal control
- Add an **"Appearance"** field to the existing **`kiosk-content-card.tsx`** (owner property detail),
  above or below the text fields: three tappable **mini-preview** buttons (Warm / Accent / Classic),
  each a scaled Home thumbnail; selected one ringed in coral. Mobile-first (owner portal is the
  responsive surface).
- Wire through the existing owner save path: extend `lib/owner/kiosk.ts`
  (validate `kiosk_cta_style` ∈ the three) and `updateKioskContentAction` to accept + persist it.
  **Audit-logged** like the other kiosk-content edits (per the audit-every-change convention).
- TDD the validation helper (Vitest) per the `lib/` pattern before wiring the action.

## 5. New token — dark call backdrop

The Stage 0 palette is light-only, but Ringing/Connected/Reconnecting are inherently dark (video).
Add **one** token to `apps/kiosk/src/index.css` `@theme` (and note it in the Stage 0 spec's palette as
a kiosk-only addition):

- `--color-call: #14202F;` — deep navy (brand-tinted, **not** neutral charcoal, **not** `#000`).

Scrims/translucent layers derive from it via alpha. This is the only palette addition; everything
else uses existing brand tokens.

## 6. State-machine change (`state/call-machine.ts`)

Add a single transition so the disclosure X can close to Home:
- New action `{ type: "CLOSE_DISCLOSURE" }` → returns `home()` when `state.screen === "disclosure"`
  (no-op otherwise). Wire the RecordingNotice X to dispatch it (no Agora session exists yet at the
  disclosure step, so no teardown needed — `onAccept` is what starts the session).
- No other transitions change. (Existing `CANCEL`/`END_CALL`/`DISMISS_APOLOGY`/`RING_TIMEOUT`/`ERROR`
  all stay.)

## 7. Motion & accessibility

- **Motion:** seam ring spin (Ringing) and seam-frame drift (Connected) are slow and subtle;
  mint-dot pulse ~2s; button press `scale(0.96)`; loading seam shimmer. All transform/opacity only.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, disable the ring spin, frame drift,
  dot pulse, and shimmer — keep static seam ring/frame and the dot (still shows state). Comprehension
  never depends on motion.
- **Touch targets:** every interactive element ≥ 56px (close X ≥ 44px is acceptable but prefer 56px).
- **Contrast:** coral-on-navy only at large sizes; `accent` preset sub-line uses brightened coral or
  near-white (§3.1). Status/connection always pairs color with text + icon.
- **Kiosk lock behaviors** already in `index.css` (no-select, no tap highlight, `overscroll-none`)
  are preserved.

## 8. Files touched (estimate — finalized in the plan)

**Kiosk** — `src/index.css` (add `--color-call`, any kiosk-specific utility), `src/types.ts`,
`src/state/call-machine.ts`, `src/App.tsx` (Loading + ReconnectingOverlay + dispatch wiring),
`src/screens/{Home,RecordingNotice,Ringing,Connected,Apology}.tsx`, new
`src/screens/CallControls.tsx`. Icons via the kiosk's lucide.

**Portal** — `supabase/migrations/0015_kiosk_cta_style.sql`, `app/api/kiosk/config/route.ts`,
`lib/owner/kiosk.ts`, `app/(owner)/owner/properties/[id]/kiosk-content-card.tsx` +
`actions.ts`, generated TS types if regenerated.

**Docs** — this spec; CLAUDE.md build-status row on completion.

## 9. Verification

Per the established workflow: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; the new
`lib/owner/kiosk` validation unit-tested; no fabricated tests for CSS. Cross-surface eyeball:
`pnpm dev:kiosk` through every screen (drive the state machine), each `kiosk_cta_style` preset on
Home, reduced-motion on. Migration 0015 committed before apply; applied to prod per the deploy
workflow. Final `grep` for stray hex in `apps/kiosk/src` returns only `index.css`.

## 10. Open items carried to the plan

1. Exact lucide icon choices for mic/mic-off, camera/camera-off, phone/phone-off, shield, X.
2. **DECIDED** — the owner "Appearance" picker lives inside the **same Edit/Save toggle** as the text
   fields: one transaction, one audit row. (The picker is read-only display until Edit is pressed,
   selectable while editing, persisted on Save with the text fields.)
3. Final default greeting/welcome copy per preset (kiosk render defaults; owner override unchanged).
