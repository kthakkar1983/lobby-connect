# Lobby Connect — Brand Guidelines

**Status:** Living document · started 2026-06-14 during the system-wide brand revision.
**Purpose:** The single source of truth for the Lobby Connect visual identity — logo, color,
type, layout, and usage rules. Update this as decisions land; it should always describe the
*current* intended brand, with older versions left in git history.

> This revision supersedes the earlier "UI/UX Stage 0" direction
> (`docs/specs/2026-06-07-ui-ux-stage0-design-direction.md`): coral is retired, a four-color
> brand palette (navy / teal / mint / blaze) is adopted, and a real logo replaces the
> "LC" placeholder.

## Section status

| Section | Status |
|---|---|
| 1. Brand thesis | ✅ Locked |
| 2. Logo | ✅ Locked · components built |
| 3. Color | ✅ Locked · tokens implemented |
| 4. Typography | ✅ Locked · fonts wired |
| 5. Layout | ⏸ Deferred to a dedicated follow-up chat |
| 6. Shape · elevation · motion | ◻︎ Baseline carried from current system (revisit if needed) |
| 7. Voice & tone | ✅ Carried (unchanged) |
| 8. Implementation map | ✅ Tracks locked sections |

---

## 1. Brand thesis

Lobby Connect is **a real person reached through a screen** — warm, human hospitality on one
side; calm, dependable technology on the other. The brand lives in the **connection** between
the two: a guest taps a tablet and a real person answers.

**Tone:** calm, trustworthy, professional, quietly warm. Never loud, never cute, never
alarmist. Confidence is carried by clarity and restraint, not decoration.

**Signature motif — the connection.** A line joining two points. It appears two ways:
- In the **logo wordmark**, as the mint dot–line–dot running through "connect".
- In the **UI**, as the *seam*: a thin three-color gradient hairline/ring
  (`navy → teal → mint`) used under headers, around a connected caller, and along an
  active-call edge. Line/ring work only — never a large fill. (Blaze stays out of the seam —
  it's reserved for attention.)

---

## 2. Logo

### Assets
- **Mark** — the icon: an **entrance** — a portal / doorway / gateway — with a **person inside
  it**. Three brand anchors: navy + teal forms shape the opening, a **mint** figure stands
  within. A literal nod to the *lobby*. Colors: navy `#0F2D4B` · teal `#2EA6AA` · mint `#06D6A0`.
- **Wordmark** — "LOBBY" (uppercase) over "connect" (lowercase) in deep navy, with a **mint**
  dot–line–dot connector threading "connect". Colors: navy `#0F2D4B` · mint `#06D6A0`.
- **Repo home:** committed SVGs live at `apps/portal/public/brand/mark.svg` and
  `apps/portal/public/brand/wordmark.svg` (portal only — the kiosk has no logo).

> **Logo SVGs are committed** at `apps/portal/public/brand/{mark,wordmark}.svg` (vector, brand
> palette). The old `artboard 5.svg` (muted teal + grey + uppercase "CONNECT") is superseded.
> **Resolved (2026-06-15):** the wordmark connector is **mint** `#06D6A0`. The partner's
> preferred wordmark (navy letters + mint dot–line–dot) was swapped in during implementation;
> the committed `wordmark.svg` is the source of truth.

### Usage
- **Mark** — tight spots: collapsed icon sidebar, favicon, mobile header, avatars.
- **Wordmark** — roomy spots: expanded sidebar header, sign-in, onboarding, owner header.
- The **logo is the home link** wherever it appears.

### Where the logo appears
- ✅ **Admin, Owner, and Agent portals.**
- ❌ **Never on the kiosk.** Guest screens stay logo-free — the hotel's own name leads; the
  experience belongs to the hotel, not to us.

### Color & backgrounds
- Logo uses its full color (navy + mint) on **light** surfaces only.
- **Dark backgrounds are out of scope for v1.** The mark's navy shapes disappear on navy, and
  we are not shipping a reversed/mono logo now. If/when a dark mode is added, produce a
  one-color reversed mark then. Until then: only place the logo on light surfaces.

### Clear space & minimum size
- Keep clear space around the logo ≥ the height of the mark's central figure.
- Minimum mark size: **24px** (favicon/collapsed). Below that, legibility breaks.

---

## 3. Color

The system is built on **four brand anchors** — navy, teal, mint, blaze — over cool neutrals,
plus a functional red. **No hardcoded hex in components**; everything routes through tokens.

### 3.1 Brand anchors

| Color | Hex | Primary role |
|---|---|---|
| **Deep navy** | `#0F2D4B` | Text, nav, headers — the anchor |
| **Teal** | `#2EA6AA` | Links, nav, secondary / informational |
| **Mint** | `#06D6A0` | Call / connect / live + **all primary action buttons** |
| **Blaze** | `#FD6734` | **Needs attention** — open incidents, missed, degraded, badges |

### 3.2 Role map (how the colors are used)

| Need | Color |
|---|---|
| Primary action / call / connect button | **Mint** fill + **Ink** text |
| Live / connected / success / presence | **Mint** (dot + label) |
| Links, navigation, active nav, secondary interactive | **Teal** (deep teal for text) |
| Needs attention (non-critical): open incident, missed call, degraded status, "new" | **Blaze** |
| Live 911 in progress · destructive (delete) · hard errors | **Red** |
| Body text, headings, nav labels | **Deep navy** |

Mint and teal are close cousins; **mint = act/live, teal = navigate/link** keeps them distinct.
Blaze and red differ by severity: **blaze = needs a look later, red = happening now / irreversible.**

### 3.3 Working values (text, fills, focus)

Bright colors are too light to carry white text or to be read as text on white. So:

| Token | Hex | Use | Contrast |
|---|---|---|---|
| **Ink** | `#14202F` | Text/icons on mint, teal, blaze fills | 5.6–8.7:1 ✅ |
| **Deep teal** | `#248386` | Teal links & text on white | 4.5:1 ✅ |
| **Deep mint** | `#048765` | Mint links & text on white · **focus ring** | 4.5:1 ✅ |
| **Deep blaze** | `#C85129` | Blaze text on white (e.g. "1 open incident") | 4.5:1 ✅ |

Rule of thumb: **bright color → filled surfaces, dots, tints, the seam. Deep variant → text & links.**

### 3.4 Neutrals (cool, faintly teal — part of the family, not generic grey)

| Token | Hex | Use |
|---|---|---|
| Page background | `#F4F7F7` | App / page surface |
| Card / surface | `#FFFFFF` | Cards, sheets, dialogs |
| Subtle surface | `#EEF3F3` | Alt rows, hover, zebra |
| Muted fill | `#E5ECEC` | Chips, inert fills |
| Border | `#DBE4E5` | Hairlines, dividers |
| Input border | `#7F8F90` | Form-control outlines (3:1 ✅) |
| Muted text | `#5C6B79` | Captions, labels, secondary (5.5:1 ✅) |

### 3.5 Soft tints (12% on white) — washes, badges, status pills, active backgrounds

| Tint | Hex | Pair with text |
|---|---|---|
| Navy 12% | `#E2E6E9` | Deep navy |
| Teal 12% | `#E6F4F5` | Deep teal |
| Mint 12% | `#E1FAF4` | Deep mint |
| Blaze 12% | `#FFEDE7` | Deep blaze |
| Red 12% | `#FCEBEB` | Deep red |

### 3.6 Functional red

| Token | Hex | Use |
|---|---|---|
| Red | `#C81E1E` | 911 (live) · destructive · hard errors. Reserved — never decorative. |

Red is **not** a brand anchor, but life-safety needs an unmistakable, distinct red. It stays.

### 3.7 The seam gradient

```
linear-gradient(90deg, #0F2D4B, #2EA6AA, #06D6A0)
```
Three cool anchors in order — **blaze is deliberately excluded** (it's the attention color, not
a decorative thread). **Line/ring only** — header hairlines, the ring around a connected caller,
active-call edges. Never a large fill or background.

### 3.8 Accessibility notes
- Every text/background pairing above meets **WCAG AA** (≥4.5:1 text, ≥3:1 UI/large).
- **Color is never the only signal:** live = mint dot **+** "Connected"; attention = blaze **+**
  icon/label; emergency = red **+** icon/label.
- Focus ring = **deep mint `#048765`**, 2px + 2px offset, on every interactive element.

---

## 4. Typography

**Locked.** Three families — restraint, on brand.

| Tier | Family | Source | Scope |
|---|---|---|---|
| Display / headings / **labels** | **Raleway** | Google — self-hosted variable woff2 (wght 100–900) | Greetings, page & section titles, all-caps labels (`.12em` tracking) |
| UI / body | **Outfit** | Google (unchanged) | Body, tables, buttons, small UI |
| Data | **JetBrains Mono** | Google (unchanged) | Timers, counts, durations |

Changes from current: **Atelier → Raleway** — the display tier moves from a serif to an elegant
sans, resolving the Atelier capital-**W**-reads-as-**V** issue. **Radon retired** — Raleway with
letter-spacing handles the all-caps label tier, so the system is **three fonts, not four**.
Headings lean on Raleway **Medium (500)** and up (Raleway runs slightly light at small sizes).

---

## 5. Layout 🚧

**Deferred to a dedicated follow-up session.** This is the largest, most structural part, and
the user has per-page design notes (`*-design.md`) to bring in — so it gets its own chat.

**Problem statement (user):** the current dashboards look *flat and uninspiring* next to good
dashboard examples. Goal is a more elevated, considered layout with real depth and hierarchy —
not just a re-skin of the existing shells.

**Scope (all of the below):**
- Unify the **agent + admin** shells into one consistent structure.
- Rework navs — admin sidebar, agent right-rail, owner tabs.
- Revisit **density / spacing**, depth, and visual interest.
- Per-page structure changes, driven by the user's per-page design `.md` files.

Current shells (baseline to improve on): admin = collapsed icon sidebar; agent = top header +
right softphone rail; owner = mobile-first top header + bottom tab bar; kiosk = full-screen
state machine.

**Resume checklist for the next session:**
1. Bring the per-page design `.md` files.
2. Confirm logo SVGs are dropped in `apps/portal/public/brand/` (`mark.svg` + `wordmark.svg`),
   and supply the corrected **wordmark as SVG**.
3. Treat logo + color + type (this doc, §1–4) as **locked inputs**; build layout on top.

---

## 6. Shape · elevation · motion (baseline)

Carried from the current system unless revisited:
- **Radius:** card 12px (kiosk 16) · button 9px (kiosk 12) · input 8px (kiosk 10) · pill full.
- **Elevation:** navy-tinted shadows, never pure black —
  `sm 0 1px 2px rgba(15,45,75,.06)` · `md 0 12px 26px -14px rgba(15,45,75,.16)` ·
  `lg 0 18px 40px -16px rgba(15,45,75,.20)`.
- **Motion:** 150ms micro / 220ms standard; `transform`+`opacity`; ease-out
  `cubic-bezier(0.16,1,0.3,1)`. Mint "connected" pulse (~2s); seam ring slow drift on active
  calls. Always honor `prefers-reduced-motion`.
- **Touch/focus:** min target 44px (kiosk ≥56px); visible 2px focus ring + 2px offset.

---

## 7. Voice & tone

Calm, warm, plain-spoken. Never cute, never alarmist, never blame the user.
- **Guest / kiosk:** "Someone's still up. One tap and you're talking to the front desk."
- **Staff / dashboard:** "7 answered · avg pickup 9s · 0 missed."
- **Errors:** "Couldn't reach the front desk just now. Trying again…" (no codes).
- **Emergency:** "Calling 911. Stay on the line."

---

## 8. Implementation map

Tokens live in two mirrored files — `apps/portal/app/globals.css` (Tailwind v4 `@theme`) and
`apps/kiosk/src/index.css`. Both must carry the same brand values. Component code references
tokens only (`bg-primary`, `text-accent`, etc.), never raw hex.

**Target design tokens (this revision):**

| Semantic | Value | Notes |
|---|---|---|
| `--color-foreground` / text | `#0F2D4B` | Deep navy |
| `--color-background` | `#F4F7F7` | Page |
| `--color-card` / surface | `#FFFFFF` | |
| primary action | `#06D6A0` fill / `#14202F` text | Mint + ink |
| `--color-live` | `#06D6A0` | = primary action color (by design) |
| link / secondary | `#2EA6AA` / text `#248386` | Teal / deep teal |
| attention | `#FD6734` / text `#C85129` | Blaze / deep blaze |
| `--color-destructive` | `#C81E1E` | Red |
| `--color-ring` | `#048765` | Deep mint |
| `--color-border` | `#DBE4E5` | |
| `--color-input` | `#7F8F90` | |
| `--color-muted-foreground` | `#5C6B79` | |
| `--gradient-seam` | `linear-gradient(90deg,#0F2D4B,#2EA6AA,#06D6A0)` | Line/ring only; blaze excluded |

> Exact CSS-variable renaming (e.g. how `--color-primary`/`--color-accent` map onto the new
> roles) is finalized in the implementation plan, not here. This table is the design intent.

---

## Change log
- **2026-06-14** — Document started. Locked: brand thesis, logo (incl. no-logo-on-kiosk, dark
  mode deferred), full color system (navy/teal/mint/blaze + ink + deep variants + neutrals +
  tints + functional red + seam). Retired coral. Typography and layout pending.
- **2026-06-14** — Seam reduced to three colors (navy/teal/mint; blaze excluded). Mark meaning
  corrected: an entrance/portal/doorway with a person inside (the *lobby*), not two screens.
  Logo repo home set (`apps/portal/public/brand/`). Type direction set: Atelier→Raleway, Radon
  retired (pending mockup).
- **2026-06-14** — Typography **locked** after in-use mockup: Raleway (headings + labels) /
  Outfit (body) / JetBrains Mono (data); Radon retired. Raleway variable font converted to
  woff2 and staged in `apps/portal/app/fonts/` + `apps/kiosk/public/fonts/` (code wiring during
  implementation).
- **2026-06-14** — Logo SVGs committed (`apps/portal/public/brand/{mark,wordmark}.svg`). Mark now
  navy/teal/mint (teal figure); wordmark navy + teal connector. Doc descriptions corrected to
  match. Open confirm: wordmark connector teal vs mint. Committed to branch `brand-revision`.
- **2026-06-15** — **Implementation (foundation).** Color tokens swapped in both apps
  (`apps/portal/app/globals.css` + `apps/kiosk/src/index.css`): coral retired; navy/teal/mint/blaze
  + ink + deep variants + cool neutrals live. `--color-accent` = teal, new `--color-attention` = blaze,
  primary action = mint. Three fonts wired (Raleway via `next/font` + kiosk `@font-face`; Atelier +
  Radon files removed). Shared `LogoMark`/`Wordmark` rebuilt from SVGO-optimised assets (mark 0.66 KB,
  wordmark 2.1 KB; Adobe PGF metadata stripped; viewBoxes tightened; reproducible via
  `pnpm -F @lc/portal optimize:svg`). Partner's new **mint-connector** wordmark swapped in —
  supersedes the teal-connector note above; the mark's figure is **mint**, the right jamb **teal**.
  Fixed: portal middleware now serves `/brand/*` static assets (was redirecting to /sign-in);
  auth-form primary CTAs → mint; missed / degraded / pending-setup → blaze. Verified: portal
  typecheck + lint + 428 tests + build, kiosk build, sign-in render (logo, Raleway, mint CTA).
  **Deferred to page-by-page passes:** §5 layout; full kiosk repaint + no-logo-on-kiosk; per-surface
  logo sizing; final "end / hang-up" treatment; and the §3.2 "open incident = blaze" remap (still red).
