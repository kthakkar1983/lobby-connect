# DESIGN.md — Lobby Connect

> Token + component reference for impeccable. Full rationale + accessibility math live in
> [`docs/brand/brand-guidelines.md`](brand/brand-guidelines.md). Tokens are implemented in
> `apps/portal/app/globals.css` (Tailwind v4 `@theme`) and mirrored in `apps/kiosk/src/index.css`.
> **Never hardcode hex** — use the Tailwind token utilities (`bg-live`, `text-accent-text`,
> `border-border`, …).

## Color (brand anchors)

| Role | Token utility | Value |
|---|---|---|
| Text / nav / headers (anchor) | `text-foreground` · `bg-primary` | navy `#0F2D4B` |
| Primary action / connect / live / success | `bg-live` (+ `text-ink`) | mint `#06D6A0` |
| Links / active nav / secondary interactive | `text-accent-text` · `bg-accent` | teal `#2EA6AA`, text `#248386` |
| Needs attention (open incident*, missed, degraded, "new") | `bg-attention` · `text-attention-text` | blaze `#FD6734`, text `#C85129` |
| 911 (live) / destructive / hard errors | `bg-destructive` | red `#C81E1E` (reserved) |
| Focus ring | `ring-ring` | deep mint `#048765` |

`ink #14202F` (`text-ink`) = text/icons on bright (mint/teal/blaze) fills. Deep variants
(`accent-text` / `live-foreground` / `attention-text`) = text/links on white. Soft tints via `/15`
`/10` opacity utilities on an anchor color (e.g. `bg-attention/15`).
\*Incidents currently render **red**, not blaze — see the open decision in brand-guidelines.md §3.2.

## Neutrals (cool, faintly teal)

page `#F4F7F7` · card `#FFFFFF` · muted fill `#E5ECEC` · border `#DBE4E5` · input border `#7F8F90` ·
muted text `#5C6B79`.

## The seam

`--gradient-seam` = `linear-gradient(90deg,#0F2D4B,#2EA6AA,#06D6A0)` (navy→teal→mint, **blaze
excluded**). **Line/ring only** — header hairlines, the ring around a connected caller, active-call
edges. Never a large fill. `.lc-seam-drift` animates the gradient angle on active-call surfaces only.

## Typography

- **Raleway** (variable, self-hosted) — display/headings + all-caps labels (`.12em` tracking). Wired
  via `next/font` (portal) + `@font-face` (kiosk). Default instance is Thin(100), so headings/labels
  set weight ≥500. Vars: `--font-display`, `--font-label`.
- **Outfit** — body / UI / buttons (`--font-sans`).
- **JetBrains Mono** — timers, counts, durations (`--font-mono`).

## Shape · elevation · motion

- Radius: card 12 (kiosk 16) · button 9 (kiosk 12) · input 8 (kiosk 10) · pill full.
- Elevation: navy-tinted shadows, never pure black (`--shadow-sm/md/lg`).
- Motion: 150ms micro / 220ms standard; animate `transform`+`opacity`; ease-out
  `cubic-bezier(0.16,1,0.3,1)`. Mint "connected" pulse; seam drift on active calls. Always honor
  `prefers-reduced-motion`.

## Components / patterns

- **Logo** — `LogoMark` (mark) + `Wordmark` (full lockup) in
  `apps/portal/components/brand/wordmark.tsx`; both render the SVGO-optimised
  `/public/brand/{mark,wordmark}.svg` via `<img>`. Logo = home (callers wrap in the home link).
  Portal only — never the kiosk. The sidebar swaps wordmark↔mark on collapse.
  Re-optimise after a re-export: `pnpm -F @lc/portal optimize:svg`.
- **Button** (`components/ui/button.tsx`): `default` = mint (primary action) + ink, `neutral` = navy,
  `accent` = teal, `destructive` = red, `outline`/`secondary`/`ghost` = neutral, `link` = deep teal.
- **Badge**: `live` (mint), `accent` (teal), `attention` (blaze), `destructive` (red),
  `secondary`/`outline`.
- Status/call pills + presence dots resolve to brand tokens — `lib/owner/status-pill.ts`,
  `lib/owner/format.ts`.

## Register

product (app UI / dashboards). Design serves the task — see PRODUCT.md.
