# UI/UX Stage 0 — Design Direction

**Created:** 2026-06-07 (session 8). **Status:** LOCKED — ready for Stage 1 (Foundation).
**Parent plan:** `docs/plans/2026-06-07-ui-ux-polish-stages.md` (on `main`).

This is the output the staged plan's Stage 0 calls for: the brand direction + the token
values to apply in Stage 1. Decided through a visual brainstorm (mockups in
`.superpowers/brainstorm/`, gitignored). No code in this stage.

---

## 1. Brand thesis

Lobby Connect is **a real person reached through a screen** — warm analog hospitality on
one side, cool digital automation on the other. The brand lives in the **seam** where the
two meet, and that seam *is* the product's core moment: a guest tapping a tablet and a
human answering. Tone stays **calm, trustworthy, professional** (locked in CLAUDE.md); the
contrast between human and machine is carried by color, type, and one signature motif —
not by being loud.

**Signature motif — the seam.** A warm⇄cool gradient (navy → mint → coral) used as a thin
device: the hairline under the wordmark, the ring around a connected caller, the accent
edge on an active-call card. It is the visual shorthand for "connected." Used as line/ring
work only — never as a large fill.

---

## 2. Color

Single brand accent (coral) + functional semantics (live/mint, emergency/red) on a cool
neutral base. Hex values below are the brand source of truth; Stage 1 sets them as CSS
custom properties in the Tailwind v4 `@theme` layer. **No hardcoded hex in components** —
everything routes through tokens (CLAUDE.md rule).

| Role | Token (proposed) | Value | Usage |
|---|---|---|---|
| Ink / primary | `--color-primary` | `#2C425C` | Headings, body text, nav rail, secondary buttons |
| On-primary | `--color-primary-foreground` | `#FFFFFF` | Text/icons on navy |
| Accent · base | `--color-accent` | `#F0795B` | Coral tints, rings, hover washes, soft borders |
| Accent · deep | `--color-accent-strong` | `#E05A39` | **Filled CTAs, links, coral text on light** (AA-safe) |
| On-accent | `--color-accent-foreground` | `#FFFFFF` | Text on coral fills |
| Live / success | `--color-live` | `#06D6A0` | "Connected", presence dots, positive states |
| Live text-on-light | `--color-live-foreground` | `#048A67` | Mint as readable text/label |
| Emergency / destructive | `--color-destructive` | `#C81E1E` | 911 button, deletes — deliberately distinct from coral |
| Page background | `--color-background` | `#F6F8FA` | App/page surface (cool neutral) |
| Card / surface | `--color-surface` | `#FFFFFF` | Cards, sheets, dialogs |
| Muted fill | `--color-muted` | `#EAEEF2` | Chips, zebra rows, inert fills |
| Muted text | `--color-muted-foreground` | `#64748B` | Labels, secondary text, captions |
| Border / input | `--color-border` / `--color-input` | `#E1E7EC` | Hairlines, input outlines |
| Focus ring | `--color-ring` | `#E05A39` | 2px ring + 2px offset, on every interactive element |
| Seam gradient | `--gradient-seam` | `linear-gradient(135deg,#2C425C,#06D6A0,#F0795B)` | Rings, hairlines, active-call edges only |

**Accessibility notes**
- Coral `#F0795B` fails white-text contrast at body size → that's why fills/links use the
  **deep** coral `#E05A39` (passes AA at button/large scale). Base coral is for tints/rings.
- Color is never the sole signal — pair the mint live-state with the word "Connected" + a
  dot; pair emergency red with an icon + label.

---

## 3. Typography

A display **serif** for warm guest/owner moments against a clean **sans** for all
functional UI — the human/digital duality, in type. Serif is **display-only**; it never
enters dashboard tables.

| Tier | Token | Family | Source | Scope |
|---|---|---|---|---|
| Display | `--font-display` | **Solitude** | Envato (self-host) | Hero lines, big page/section headers (guest + owner) |
| Sans (UI/body) | `--font-sans` | **Outfit** | Google (≈ Google Sans) | All body, UI, tables, buttons, small headers |
| Mono (data) | `--font-mono` | **JetBrains Mono** | Google | Timers, durations, counts, stats |
| Label | `--font-label` | **Vonique 43** | Envato (self-host) | All-caps wordmark + section labels (`.12em` tracking) |

**Rules**
- Section headers ≤ ~20px use **Outfit semibold**, not Solitude — Solitude's hairlines get
  fragile at small sizes (it is high-contrast editorial). Solitude is for large display only.
- Numbers/data use JetBrains Mono everywhere for tabular precision.

**Suggested scale** (Stage 1 refines): display `clamp(2rem,5vw,2.75rem)` · h1 2rem · h2
1.5rem · h3 1.1875rem · body 0.9375rem (kiosk 1rem+) · small 0.8125rem · label 0.6875rem
uppercase. Line-height 1.5–1.6 body; 1.05–1.1 display.

**Font licensing — ACTION REQUIRED:** confirm the Envato license for **Solitude** and
**Vonique 43** permits **web embedding / self-hosting** before Stage 1 ships them. Convert
to `woff2`, serve via `@font-face` with `font-display: swap`. If web embedding isn't
covered, fall back to the rendered proxies (Solitude → Playfair Display; Vonique 43 → Jost)
or buy the web license.

---

## 4. Shape, elevation, motion

**Shape — "Balanced"** (one scale; kiosk rounds one step softer for touch).

| Token | Value | Kiosk override |
|---|---|---|
| `--radius-card` | `12px` | `16px` |
| `--radius-button` | `9px` | `12px` |
| `--radius-input` | `8px` | `10px` |
| `--radius-pill` | `9999px` | — |

**Elevation — navy-tinted shadows** (never pure black):
- `--shadow-sm`: `0 1px 2px rgba(44,66,92,.06)`
- `--shadow-md`: `0 12px 26px -14px rgba(44,66,92,.16)`
- `--shadow-lg`: `0 18px 40px -16px rgba(44,66,92,.20)`

**Spacing:** 4px base — 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48. Kiosk leans generous.

**Motion — restrained & purposeful:**
- 150ms micro / 200–250ms standard; `transform` + `opacity` only; ease-out
  (`cubic-bezier(0.16,1,0.3,1)`).
- Signature motions: mint "Connected" dot soft pulse (~2s); seam ring slow gradient drift
  on an active call. No decorative/scroll theatrics.
- **Always honor `prefers-reduced-motion: reduce`** — disable non-essential motion.
- Tactile feedback on press: `scale(0.98)` or `-translate-y-[1px]`.

**Touch / focus:** min target 44px (kiosk ≥ 56px). Visible 2px focus ring + 2px offset on
every interactive element.

---

## 5. UX voice

Calm, warm, plain-spoken. Never cute, never alarmist, never blame the user.

- **Guest / kiosk** — reassuring, human: *"Someone's still up. One tap and you're talking
  to the front desk."*
- **Staff / dashboard** — concise, factual: *"7 answered · avg pickup 11s · 0 missed."*
- **Errors** — honest + actionable, no codes: *"Couldn't reach the front desk just now.
  Trying again…"*
- **Emergency** — direct, unmissable: *"Calling 911. Stay on the line."*

---

## 6. Per-surface art direction

One system, three temperaments. Priority order (who sees it): **Kiosk > Owner > Agent/Admin**.

| Surface | Temperament | Treatment |
|---|---|---|
| **Kiosk** (guest) | Warm, large-touch, calm | Big Solitude greetings, generous space, softer radius, ≥56px targets, seam ring on the connected caller, deep-coral CTA front and center |
| **Owner** (client, mobile) | Premium, trustworthy, glanceable | Solitude headers on glance cards, Outfit body, mint live signals, lots of breathing room, mobile-first |
| **Agent/Admin** (internal) | Dense, operational, quiet | Outfit + JetBrains Mono, serif only in page titles, tight tables, restrained color — function over flair |

---

## 7. Implementation notes for Stage 1

- **Tailwind v4, CSS-first `@theme`.** Tokens live in `apps/portal/app/globals.css` and
  must be mirrored in `apps/kiosk/src/index.css` so both apps share one brand.
- **Remove stray hex from the kiosk.** `apps/kiosk/src/index.css` still carries
  `--kiosk-navy: #0f1f3d` / `--kiosk-cream: #f4ecd8` etc. — leftover "Jazz Club" tokens from
  the *Back of House* project. Delete them; they violate the no-hardcoded-hex rule and are
  unused by this brand.
- **Fonts:** Outfit + JetBrains Mono via `next/font` (portal) and self-host or `@fontsource`
  (kiosk); Solitude + Vonique 43 self-hosted `woff2` once the license is confirmed (§3).
- **shadcn primitives** get re-skinned at the token + primitive layer (radius/shadow/color),
  not forked — per the staged plan. Customize, never ship defaults.
- **Existing tokens** in `globals.css` (generic shadcn blue `--color-primary: oklch(48%...)`,
  the unused `--sidebar-*` / `.dark` block) are replaced/removed by this palette. Light mode
  only; `next-themes` is already gone.

## 8. Open items (carry into Stage 1)

1. Confirm Envato web-embedding license for Solitude + Vonique 43 (blocker for shipping the
   real faces; proxies otherwise).
2. Decide whether Vonique 43 label tier is worth a third self-hosted font for v1, or defer
   labels to Outfit all-caps until post-pilot.
3. Final token names to match shadcn's expected CSS variable contract during the primitive
   re-skin.
