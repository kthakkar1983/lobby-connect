# UI/UX Stage 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the barebones shadcn skeleton with the locked Lobby Connect brand at the token + shared-primitive layer, so the whole app lifts at once without touching route/business logic.

**Architecture:** Foundation is logic-orthogonal. We (1) self-host the four brand fonts, (2) rewrite the Tailwind v4 `@theme` token layer in both apps to the Stage 0 palette/type/shape/shadow scale, (3) re-skin the shared shadcn primitives at the token + primitive layer (never forking), and (4) wire a shared `Wordmark`/`LogoMark` with the seam motif into the five header/auth spots. Kiosk inline-style color references are repointed from the stray `--kiosk-*` Jazz Club vars to the new brand tokens so the kiosk keeps rendering; the real kiosk repaint is Stage 2.

**Tech Stack:** Tailwind v4 (CSS-first `@theme`), Next.js 15 App Router + `next/font` (portal), Vite + `@font-face`/`@fontsource` (kiosk), shadcn (new-york), `class-variance-authority`, lucide-react.

**Source of truth:** `docs/specs/2026-06-07-ui-ux-stage0-design-direction.md` (LOCKED). All hex/token/type/radius/shadow values come from there — do not invent values.

**Decisions carried in (2026-06-07):**
- Font licensing CONFIRMED by Kumar — self-host the real **Solitude** (display) + **Vonique 43** (label). Source zips: `~/Downloads/solitude-elegant-editorial-font-*.zip` (has `.otf/.ttf/.woff`, **no woff2**) and `~/Downloads/vonique-43-*.zip` (has `webfont/Vonique 43.woff2`). Outfit + JetBrains Mono are free Google fonts.
- `Card` primitive does not exist yet — add it (foundation list item, heavy Stage-2 leverage).
- This ships as **two PRs** off one branch for reviewability: **PR-A = fonts + tokens + kiosk cleanup**, **PR-B = primitive re-skin + logo/wordmark**. Both off `feat/ui-ux-stage1-foundation`.

---

## File structure (what each touched file owns)

**Created**
- `apps/portal/app/fonts/Solitude.woff2`, `Vonique43.woff2` — self-hosted brand faces (local).
- `apps/portal/app/fonts.ts` — central `next/font` declarations (Outfit, JetBrains Mono via google; Solitude, Vonique via local), exporting one `className` to attach to `<html>`.
- `apps/portal/components/ui/card.tsx` — new shared Card primitive (shadcn new-york shape, brand-tokened).
- `apps/portal/components/brand/wordmark.tsx` — shared `LogoMark` (seam "LC" mark) + `Wordmark` (mark + "LOBBY CONNECT" in label font). Logo = home.
- `apps/kiosk/public/fonts/` — `Solitude.woff2`, `Vonique43.woff2`, `Outfit.woff2`, `JetBrainsMono.woff2` (self-hosted; kiosk has no `next/font`).

**Modified**
- `apps/portal/app/globals.css` — rewrite `@theme` to Stage 0 palette/type/shape/shadow; delete `.dark` + `--sidebar-*` cruft + the `@custom-variant dark`.
- `apps/portal/app/layout.tsx` — attach the font `className` to `<html>`; set `lang`.
- `apps/portal/components/ui/{button,input,textarea,badge,table,dialog,alert-dialog,dropdown-menu,sonner,skeleton,switch,select,separator,sheet,tooltip}.tsx` — radius/shadow/color/focus-ring re-skin via tokens.
- `apps/kiosk/src/index.css` — rewrite `@theme` to mirror brand tokens; delete `--kiosk-*` Jazz Club vars; add `@font-face` for all four faces.
- `apps/kiosk/src/screens/{Home,RecordingNotice,Apology}.tsx`, `apps/kiosk/src/ErrorBoundary.tsx` — repoint inline `var(--kiosk-*)` → brand tokens.
- `apps/portal/components/app-sidebar.tsx`, `apps/portal/app/(owner)/layout.tsx`, `apps/portal/app/(agent)/layout.tsx`, `apps/portal/app/(auth)/sign-in/page.tsx`, `apps/portal/app/(auth)/onboarding/onboarding-form.tsx` — swap inline "LC"/"Lobby Connect" text for `<Wordmark>` / `<LogoMark>`.

**Verification reality:** This is visual/CSS foundation work — there are no meaningful unit tests for token *values*. Per the established workflow, each task verifies with `pnpm typecheck` + `pnpm lint` + `pnpm build` (+ existing `pnpm test` staying green) and, where a screen renders, a dev-server eyeball. Do **not** fabricate unit tests for CSS.

---

## Task 0: Branch + capture baseline

**Files:** none (git + screenshots only)

- [ ] **Step 1: Create the Stage 1 branch off the Stage 0 doc branch**

The locked spec lives on `docs/ui-ux-stage0-design`. Branch from it so the spec travels with the work.

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git checkout docs/ui-ux-stage0-design
git pull --ff-only 2>/dev/null || true
git checkout -b feat/ui-ux-stage1-foundation
```

- [ ] **Step 2: Confirm a clean baseline build**

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green. If anything is red **before** touching code, stop and report — it's pre-existing.

- [ ] **Step 3: (Optional) capture before-screenshots**

Run `pnpm dev:portal`, visit `/sign-in` and (signed in) `/admin`, screenshot for a before/after. Not committed; for your own reference.

---

## Task 1: Bring the brand fonts into the repo (PR-A)

**Files:**
- Create: `apps/portal/app/fonts/Solitude.woff2`, `apps/portal/app/fonts/Vonique43.woff2`
- Create: `apps/kiosk/public/fonts/{Solitude,Vonique43,Outfit,JetBrainsMono}.woff2`

- [ ] **Step 1: Unzip the Envato faces to a temp dir**

```bash
mkdir -p /tmp/lc-fonts && cd /tmp/lc-fonts
unzip -o ~/Downloads/solitude-elegant-editorial-font-*.zip -d solitude
unzip -o ~/Downloads/vonique-43-*.zip -d vonique
find . -iname "*.ttf" -o -iname "*.woff2" -o -iname "*.woff"
```
Expected: `solitude/Solitude.ttf` (+ `.otf/.woff`) and `vonique/webfont/Vonique 43.woff2`.

- [ ] **Step 2: Install a woff2 converter (Solitude ships no woff2)**

```bash
python3 -m pip install --user fonttools brotli
```
Expected: installs `fonttools` + `brotli`. (If `pip` is blocked, fall back: `next/font/local` accepts `.ttf` directly — copy `Solitude.ttf` instead and use `.ttf` in Task 3's `src`. Note the fallback in the commit message.)

- [ ] **Step 3: Convert Solitude → woff2**

```bash
cd /tmp/lc-fonts
python3 -m fontTools.ttLib.woff2 compress -o Solitude.woff2 solitude/Solitude.ttf
ls -l Solitude.woff2
```
Expected: `Solitude.woff2` (~25–35 KB).

- [ ] **Step 4: Place the portal faces (local, loaded by `next/font/local`)**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
mkdir -p apps/portal/app/fonts
cp /tmp/lc-fonts/Solitude.woff2 apps/portal/app/fonts/Solitude.woff2
cp "/tmp/lc-fonts/vonique/webfont/Vonique 43.woff2" apps/portal/app/fonts/Vonique43.woff2
```

- [ ] **Step 5: Place the kiosk faces (all four self-hosted)**

Kiosk has no `next/font`, so it self-hosts Outfit + JetBrains Mono too. Pull those two woff2 from the `@fontsource` packages (added in Task 4) or download; simplest is to copy from `@fontsource` after Task 4 installs them. For now place the two brand faces:

```bash
mkdir -p apps/kiosk/public/fonts
cp /tmp/lc-fonts/Solitude.woff2 apps/kiosk/public/fonts/Solitude.woff2
cp "/tmp/lc-fonts/vonique/webfont/Vonique 43.woff2" apps/kiosk/public/fonts/Vonique43.woff2
```
(Outfit.woff2 + JetBrainsMono.woff2 are copied in Task 4, Step 2, from the installed `@fontsource` packages.)

- [ ] **Step 6: Confirm the faces are not gitignored**

```bash
git check-ignore apps/portal/app/fonts/Solitude.woff2 || echo "TRACKED OK"
git check-ignore apps/kiosk/public/fonts/Solitude.woff2 || echo "TRACKED OK"
```
Expected: both print `TRACKED OK`. (woff2 is binary but small — committing it is correct for self-hosting.)

- [ ] **Step 7: Commit (face files land with Task 3/4 wiring; commit together at Task 4 end to avoid an orphan binary commit). Skip standalone commit here.**

---

## Task 2: Rewrite the portal token layer (PR-A)

**Files:**
- Modify: `apps/portal/app/globals.css` (full rewrite of the token section)

- [ ] **Step 1: Replace `globals.css` with the brand token layer**

Replace the **entire** file contents with the following. This sets the Stage 0 palette, font tokens (consumed in Task 3), radius/shadow scale, focus ring, and removes the `.dark` block, the `--sidebar-*` vars, and the `@custom-variant dark` (light mode only; `next-themes` is gone).

```css
@import "tailwindcss";

/* ============================================================
   Lobby Connect — brand tokens (Stage 1 foundation).
   Light mode only. Source: docs/specs/2026-06-07-ui-ux-stage0-design-direction.md
   No hardcoded hex in components — everything routes through these.
   ============================================================ */
@theme {
  /* Color — see spec §2 */
  --color-background: #F6F8FA;
  --color-foreground: #2C425C;
  --color-card: #FFFFFF;
  --color-card-foreground: #2C425C;
  --color-surface: #FFFFFF;

  --color-primary: #2C425C;
  --color-primary-foreground: #FFFFFF;

  --color-secondary: #EAEEF2;
  --color-secondary-foreground: #2C425C;

  --color-muted: #EAEEF2;
  --color-muted-foreground: #64748B;

  --color-accent: #F0795B;            /* base coral — tints/rings/hover wash */
  --color-accent-strong: #E05A39;     /* deep coral — fills/links/coral text */
  --color-accent-foreground: #FFFFFF;

  --color-live: #06D6A0;              /* connected/success */
  --color-live-foreground: #048A67;   /* mint as readable text */

  --color-destructive: #C81E1E;       /* 911 / deletes — distinct from coral */
  --color-destructive-foreground: #FFFFFF;

  --color-border: #E1E7EC;
  --color-input: #E1E7EC;
  --color-ring: #E05A39;              /* focus ring — deep coral */

  /* Alias kept for existing call sites using text-text-muted */
  --color-text-muted: var(--color-muted-foreground);

  /* Seam gradient — line/ring work only, never a large fill (spec §1) */
  --gradient-seam: linear-gradient(135deg, #2C425C, #06D6A0, #F0795B);

  /* Typography — families set by next/font in Task 3 via these vars */
  --font-sans: var(--font-outfit), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, monospace;
  --font-display: var(--font-solitude), Georgia, "Times New Roman", serif;
  --font-label: var(--font-vonique), var(--font-outfit), system-ui, sans-serif;

  /* Shape — spec §4 (one scale; kiosk rounds a step softer in its own file) */
  --radius-card: 12px;
  --radius-button: 9px;
  --radius-input: 8px;
  --radius-pill: 9999px;
  /* shadcn expects --radius; map it to the button scale */
  --radius: 9px;

  /* Elevation — navy-tinted, never pure black (spec §4) */
  --shadow-sm: 0 1px 2px rgba(44, 66, 92, 0.06);
  --shadow-md: 0 12px 26px -14px rgba(44, 66, 92, 0.16);
  --shadow-lg: 0 18px 40px -16px rgba(44, 66, 92, 0.20);
}

html,
body {
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Verify it compiles and the app still renders**

```bash
pnpm --filter @lc/portal build
```
Expected: PASS. (Tailwind v4 resolves the new `@theme` vars; classes like `bg-primary`, `text-text-muted`, `border-border` keep working with new values. `bg-accent`/`text-accent` now read coral instead of the old near-white — that's intentional and is fixed visually as primitives get re-skinned.)

- [ ] **Step 3: Eyeball the palette shift**

`pnpm dev:portal` → `/sign-in` and `/admin`. Expect navy text on cool-grey bg, coral focus rings. Some primitives still look default — that's Task 5. No layout breakage expected.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/globals.css
git commit -m "feat(ui): apply Lobby Connect brand tokens to portal theme layer

Replace generic shadcn oklch palette with Stage 0 brand tokens (navy/coral/
mint + cool neutrals), navy-tinted shadow scale, radius scale, coral focus
ring, seam gradient, and font-family token slots. Remove dead .dark block,
--sidebar-* vars, and the dark @custom-variant (light mode only).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire the portal fonts via `next/font` (PR-A)

**Files:**
- Create: `apps/portal/app/fonts.ts`
- Modify: `apps/portal/app/layout.tsx`

- [ ] **Step 1: Create the central font module**

`apps/portal/app/fonts.ts`:

```ts
import { Outfit, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

export const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const solitude = localFont({
  src: "./fonts/Solitude.woff2",
  display: "swap",
  variable: "--font-solitude",
});

export const vonique = localFont({
  src: "./fonts/Vonique43.woff2",
  display: "swap",
  variable: "--font-vonique",
});

/** Attach to <html> so every --font-* var (and thus --font-sans/mono/display/label) resolves. */
export const fontVars = [
  outfit.variable,
  jetbrainsMono.variable,
  solitude.variable,
  vonique.variable,
].join(" ");
```

- [ ] **Step 2: Attach the font vars in the root layout**

Modify `apps/portal/app/layout.tsx` — add the import and the `className` on `<html>`:

```tsx
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { fontVars } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lobby Connect",
  description: "After-hours front desk for hotels.",
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVars}>
      <body>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Build + verify the faces load**

```bash
pnpm --filter @lc/portal build
```
Expected: PASS (next/font fingerprints the local woff2 at build).

- [ ] **Step 4: Eyeball**

`pnpm dev:portal` → body text should now render in **Outfit** (geometric sans, not system default). In DevTools, `getComputedStyle(document.body).fontFamily` includes `__Outfit`. No display serif visible yet — it's only used by `font-display`, applied to headers in later stages.

- [ ] **Step 5: Commit (with the portal face files from Task 1)**

```bash
git add apps/portal/app/fonts.ts apps/portal/app/layout.tsx apps/portal/app/fonts/Solitude.woff2 apps/portal/app/fonts/Vonique43.woff2
git commit -m "feat(ui): self-host brand fonts in portal via next/font

Outfit (UI/body) + JetBrains Mono (data) via next/font/google; Solitude
(display) + Vonique 43 (label) self-hosted woff2 via next/font/local. Expose
as CSS vars consumed by --font-sans/mono/display/label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite the kiosk token layer + repoint inline styles (PR-A)

**Files:**
- Modify: `apps/kiosk/src/index.css`
- Modify: `apps/kiosk/src/screens/Home.tsx`, `apps/kiosk/src/screens/RecordingNotice.tsx`, `apps/kiosk/src/screens/Apology.tsx`, `apps/kiosk/src/ErrorBoundary.tsx`
- Create: `apps/kiosk/public/fonts/Outfit.woff2`, `apps/kiosk/public/fonts/JetBrainsMono.woff2`

- [ ] **Step 1: Add Outfit + JetBrains Mono as woff2 sources to the kiosk**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm --filter @lc/kiosk add @fontsource/outfit @fontsource-variable/jetbrains-mono
# Copy a representative weight to public/fonts for @font-face self-hosting:
cp node_modules/@fontsource/outfit/files/outfit-latin-400-normal.woff2 apps/kiosk/public/fonts/Outfit.woff2
cp node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2 apps/kiosk/public/fonts/JetBrainsMono.woff2
```
(If a filename differs, `ls node_modules/@fontsource/outfit/files/ | grep 400-normal.woff2` and adjust. We self-host via `@font-face` rather than `@fontsource` CSS imports to keep one consistent mechanism with the local brand faces and avoid bundling many weights.)

- [ ] **Step 2: Rewrite `apps/kiosk/src/index.css`**

Replace the **entire** file. Mirrors the portal brand tokens (so both apps share one brand), applies the kiosk shape overrides (softer radius), self-hosts all four faces via `@font-face`, and **deletes the `--kiosk-*` Jazz Club vars**.

```css
@import "tailwindcss";

/* Brand faces — self-hosted (kiosk has no next/font) */
@font-face {
  font-family: "Solitude";
  src: url("/fonts/Solitude.woff2") format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "Vonique 43";
  src: url("/fonts/Vonique43.woff2") format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "Outfit";
  src: url("/fonts/Outfit.woff2") format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono.woff2") format("woff2");
  font-display: swap;
}

/* ============================================================
   Lobby Connect — brand tokens (kiosk mirror of the portal layer).
   Source: docs/specs/2026-06-07-ui-ux-stage0-design-direction.md
   Kiosk shape overrides: radius rounds one step softer for touch.
   ============================================================ */
@theme {
  --color-background: #F6F8FA;
  --color-foreground: #2C425C;
  --color-card: #FFFFFF;
  --color-surface: #FFFFFF;

  --color-primary: #2C425C;
  --color-primary-foreground: #FFFFFF;

  --color-muted: #EAEEF2;
  --color-muted-foreground: #64748B;

  --color-accent: #F0795B;
  --color-accent-strong: #E05A39;
  --color-accent-foreground: #FFFFFF;

  --color-live: #06D6A0;
  --color-live-foreground: #048A67;

  --color-destructive: #C81E1E;
  --color-destructive-foreground: #FFFFFF;

  --color-border: #E1E7EC;
  --color-ring: #E05A39;

  --gradient-seam: linear-gradient(135deg, #2C425C, #06D6A0, #F0795B);

  --font-sans: "Outfit", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --font-display: "Solitude", Georgia, "Times New Roman", serif;
  --font-label: "Vonique 43", "Outfit", system-ui, sans-serif;

  /* Kiosk shape — one step softer than portal (spec §4) */
  --radius-card: 16px;
  --radius-button: 12px;
  --radius-input: 10px;
  --radius-pill: 9999px;
  --radius: 12px;

  --shadow-sm: 0 1px 2px rgba(44, 66, 92, 0.06);
  --shadow-md: 0 12px 26px -14px rgba(44, 66, 92, 0.16);
  --shadow-lg: 0 18px 40px -16px rgba(44, 66, 92, 0.20);
}

html, body, #root {
  height: 100%;
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  /* Prevent text selection / long-press menus on tablet. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}
```

- [ ] **Step 3: Repoint the kiosk inline-style var references**

The 4 screens reference the now-deleted `--kiosk-*` vars. Swap each for the brand token. Exact replacements:

`apps/kiosk/src/screens/Home.tsx`
- `color: "var(--kiosk-muted)"` → `color: "var(--color-muted-foreground)"`
- `background: "var(--kiosk-surface)"` → `background: "var(--color-surface)"`
- `background: "var(--kiosk-navy)", color: "var(--kiosk-cream)"` → `background: "var(--color-primary)", color: "var(--color-primary-foreground)"`

`apps/kiosk/src/screens/RecordingNotice.tsx`
- `background: "var(--kiosk-surface)"` → `background: "var(--color-surface)"`
- `background: "var(--kiosk-navy)", color: "var(--kiosk-cream)"` → `background: "var(--color-primary)", color: "var(--color-primary-foreground)"`

`apps/kiosk/src/screens/Apology.tsx`
- `color: "var(--kiosk-muted)"` → `color: "var(--color-muted-foreground)"`

`apps/kiosk/src/ErrorBoundary.tsx`
- `color: "var(--kiosk-muted)"` → `color: "var(--color-muted-foreground)"`

- [ ] **Step 4: Verify no stray `--kiosk-` references remain**

```bash
grep -rn "kiosk-navy\|kiosk-cream\|kiosk-ink\|kiosk-muted\|kiosk-surface" apps/kiosk/src
```
Expected: **no output**.

- [ ] **Step 5: Build the kiosk**

```bash
pnpm --filter @lc/kiosk build
```
Expected: PASS.

- [ ] **Step 6: Eyeball the kiosk**

`pnpm dev:kiosk` → Home screen renders navy CTA on cool-grey bg, Outfit type. The "Talk to the Front Desk" button is navy with white text (brand primary). No broken/transparent colors (which would mean a missed var).

- [ ] **Step 7: Commit**

```bash
git add apps/kiosk/src/index.css apps/kiosk/src/screens/Home.tsx apps/kiosk/src/screens/RecordingNotice.tsx apps/kiosk/src/screens/Apology.tsx apps/kiosk/src/ErrorBoundary.tsx apps/kiosk/public/fonts apps/kiosk/package.json
git commit -m "feat(ui): mirror brand tokens into kiosk + remove Jazz Club leftovers

Rewrite kiosk @theme to the shared Lobby Connect brand tokens with the kiosk
softer-radius overrides; self-host all four faces via @font-face. Delete the
stray --kiosk-navy/cream/ink/muted/surface vars (Back of House leftovers,
violated no-hardcoded-hex) and repoint the 4 screens' inline styles to brand
tokens.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Full verify gate for PR-A**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green. **This is the end of PR-A.** Open the PR (Task 8 covers the command) titled `feat(ui): Stage 1 foundation — fonts + brand tokens`, or continue to PR-B on the same branch and open one PR per the user's preference.

---

## Task 5: Re-skin the shared shadcn primitives (PR-B)

Re-skin at the token + primitive layer — change radius/shadow/color/focus-ring class strings; **do not fork component logic**. Tailwind v4 maps `rounded-*`/`shadow-*`/`ring-*` utilities to the tokens set in Tasks 2/4, so most lift came for free — these edits fix the spots that hardcode `rounded-md`, `shadow-xs`, `ring-[3px]`, or `dark:` cruft.

**Files:**
- Modify: `apps/portal/components/ui/button.tsx`
- Create: `apps/portal/components/ui/card.tsx`
- Modify: `apps/portal/components/ui/{input,textarea,badge,table,dialog,alert-dialog,dropdown-menu,sonner,skeleton,switch,select,separator,sheet,tooltip}.tsx`

- [ ] **Step 1: Re-skin Button**

In `apps/portal/components/ui/button.tsx`, replace the `buttonVariants` base + variants so the focus ring is the brand 2px+offset (spec §4), the radius uses the button token, the tactile press is added, and `dark:` cruft is dropped. Replace the `cva(...)` call with:

```tsx
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-button)] text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[1px] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive",
        outline:
          "border border-border bg-card shadow-sm hover:bg-muted hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        accent:
          "bg-accent-strong text-accent-foreground shadow-sm hover:bg-accent-strong/90",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-[var(--radius-input)] px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)
```

(New `accent` variant = the deep-coral CTA from spec §6, used on the kiosk-style primary action and key portal CTAs. `link`/destructive now route through brand tokens.)

- [ ] **Step 2: Create the Card primitive**

`apps/portal/components/ui/card.tsx` (shadcn new-york Card, brand-tokened radius/shadow/border):

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 rounded-[var(--radius-card)] border border-border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-6 pt-6", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-6", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 pb-6", className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
```

- [ ] **Step 3: Re-skin Input + Textarea**

In `apps/portal/components/ui/input.tsx` and `textarea.tsx`, change the radius to the input token and the focus to the brand ring, dropping `dark:` cruft. The base class string in each becomes (merge into the existing `cn(...)`, keep the `data-slot` and other layout classes):

```
"... rounded-[var(--radius-input)] border border-input bg-card ... focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-ring ..."
```
Concretely: replace any `rounded-md` → `rounded-[var(--radius-input)]`, replace the existing `focus-visible:...ring...` segment with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`, and delete `dark:` fragments and `aria-invalid:ring-destructive/20` opacity suffixes (use `aria-invalid:ring-destructive`).

- [ ] **Step 4: Re-skin Badge**

In `apps/portal/components/ui/badge.tsx`, set radius to pill and add brand variants. Replace the `cva(...)` variants block with:

```tsx
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-[var(--radius-pill)] border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-muted text-muted-foreground",
        live: "border-transparent bg-live/15 text-live-foreground",
        accent: "border-transparent bg-accent/15 text-accent-strong",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)
```

(`live` = the mint "Connected" badge from spec §2/§6, always paired with a word — never color-only.)

- [ ] **Step 5: Re-skin the overlay/menu surfaces**

For `dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `sheet.tsx`, `tooltip.tsx`, `sonner.tsx`: in each, change content-panel `rounded-*` → `rounded-[var(--radius-card)]`, panel `shadow-lg`/`shadow-md` → `shadow-md` (token), ensure backgrounds use `bg-card`/`bg-popover`→`bg-card`, borders use `border-border`, and delete any `dark:` class fragments. Do **not** alter Radix structure, `data-slot`s, or animation data-attributes. For `sonner.tsx`, set the Toaster `style` tokens to brand:

```tsx
// in Toaster's style prop object:
"--normal-bg": "var(--color-card)",
"--normal-text": "var(--color-foreground)",
"--normal-border": "var(--color-border)",
```

- [ ] **Step 6: Re-skin Table + Skeleton + Switch + Separator**

- `table.tsx`: header row `text-muted-foreground`, zebra/hover rows `bg-muted/50` on hover, borders `border-border`. Keep structure.
- `skeleton.tsx`: base `bg-muted` with `animate-pulse rounded-[var(--radius-input)]`.
- `switch.tsx`: checked track `data-[state=checked]:bg-live` (mint = on), unchecked `bg-muted`, thumb `bg-card`, focus `ring-2 ring-ring ring-offset-2`.
- `separator.tsx`: `bg-border`.

In each, delete `dark:` fragments and route raw colors through tokens. No logic changes.

- [ ] **Step 7: Build + typecheck**

```bash
pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build
```
Expected: PASS. (Card has no consumers yet — that's fine; it's a foundation primitive for Stage 2. If lint flags it as unused, it's exported so it won't.)

- [ ] **Step 8: Eyeball the primitives**

`pnpm dev:portal` → open `/admin/users` (buttons, table, dialogs, dropdown), `/sign-in` (inputs, button). Confirm: 9px button radius, coral focus rings with offset, navy-tinted shadows, pill badges. Press a button → subtle 1px down nudge.

- [ ] **Step 9: Commit**

```bash
git add apps/portal/components/ui
git commit -m "feat(ui): re-skin shared shadcn primitives to brand

Token-layer re-skin (radius/shadow/color/focus-ring) of button, input,
textarea, badge, table, dialog, alert-dialog, dropdown-menu, select, sheet,
tooltip, sonner, skeleton, switch, separator. Add Card primitive. New accent
(deep-coral CTA) + live (mint) variants. Brand 2px+offset focus ring and
tactile press across buttons. No component logic forked; light mode only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Shared logo / wordmark with the seam motif (PR-B)

**Files:**
- Create: `apps/portal/components/brand/wordmark.tsx`
- Modify: `apps/portal/components/app-sidebar.tsx`, `apps/portal/app/(owner)/layout.tsx`, `apps/portal/app/(agent)/layout.tsx`, `apps/portal/app/(auth)/sign-in/page.tsx`, `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`

- [ ] **Step 1: Create the Wordmark/LogoMark component**

`apps/portal/components/brand/wordmark.tsx`. `LogoMark` = the "LC" tile with the seam gradient hairline (spec §1 motif, line-work only). `Wordmark` = mark + "LOBBY CONNECT" in the label font.

```tsx
import { cn } from "@/lib/utils";

/** The "LC" seam mark — navy tile, seam-gradient hairline underneath (motif = "connected"). */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-primary text-primary-foreground text-xs font-semibold",
        className
      )}
      aria-hidden
    >
      LC
      <span
        className="absolute inset-x-1 -bottom-px h-px rounded-full"
        style={{ background: "var(--gradient-seam)" }}
      />
    </span>
  );
}

/** Full wordmark: mark + "LOBBY CONNECT" in the label face. */
export function Wordmark({
  className,
  hideTextWhenCollapsed = false,
}: {
  readonly className?: string;
  readonly hideTextWhenCollapsed?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span
        className={cn(
          "text-sm font-semibold tracking-[0.12em] text-foreground uppercase",
          hideTextWhenCollapsed && "group-data-[collapsible=icon]:hidden"
        )}
        style={{ fontFamily: "var(--font-label)" }}
      >
        Lobby Connect
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Wire into the admin sidebar (logo = home)**

In `apps/portal/components/app-sidebar.tsx`, replace the inline `<span>LC</span>` + `<span>Lobby Connect</span>` block inside the home `<Link>` with `<Wordmark hideTextWhenCollapsed />`. Add the import `import { Wordmark } from "@/components/brand/wordmark";`. The `<Link href="/admin">` stays (logo = home, locked decision).

- [ ] **Step 3: Wire into the owner + agent layouts**

- `apps/portal/app/(owner)/layout.tsx`: replace the `<Link href="/owner" ...>Lobby Connect</Link>` text content with `<Wordmark />` (keep the `Link` and its `href="/owner"` — logo = home).
- `apps/portal/app/(agent)/layout.tsx`: replace `<span ...>Lobby Connect</span>` with `<Wordmark />`. (Agent header has no home link today; wrap in `<a href="/agent">` only if a route exists — otherwise leave unlinked to avoid a typed-route error. Check: if `/agent` is the agent index, wrap it.)

Add `import { Wordmark } from "@/components/brand/wordmark";` to each.

- [ ] **Step 4: Wire into the auth screens**

- `apps/portal/app/(auth)/sign-in/page.tsx`: above the `<h1>`, the brand should read as the wordmark. Replace `<h1 className="text-xl font-semibold text-foreground">Lobby Connect</h1>` with `<Wordmark className="mb-1" />` and keep the subtitle `<p>`.
- `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`: leave the human-facing "Welcome to Lobby Connect" heading as prose (it's a sentence, not the brand lockup) — **no change** unless a logo is wanted; add `<LogoMark />` above it only if it reads better. Default: add `<LogoMark className="mb-3" />` above the heading for brand presence.

- [ ] **Step 5: Typecheck + build**

```bash
pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build
```
Expected: PASS. Watch for typed-route errors if you added an `/agent` link — use an existing route or omit the link.

- [ ] **Step 6: Eyeball**

`pnpm dev:portal` → `/sign-in`, `/admin` (expand + collapse the sidebar — wordmark text hides when collapsed, mark stays), `/owner`. The seam hairline (navy→mint→coral) shows under the LC mark. Wordmark text renders in the Vonique label face (all-caps, tracked).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/brand apps/portal/components/app-sidebar.tsx "apps/portal/app/(owner)/layout.tsx" "apps/portal/app/(agent)/layout.tsx" "apps/portal/app/(auth)/sign-in/page.tsx" "apps/portal/app/(auth)/onboarding/onboarding-form.tsx"
git commit -m "feat(ui): shared Wordmark/LogoMark with seam motif

Add brand Wordmark (LC mark + Vonique label-face 'LOBBY CONNECT') and LogoMark
with the navy->mint->coral seam hairline (spec §1 motif). Wire into admin
sidebar, owner + agent headers, sign-in, and onboarding. Logo = home preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification gate (PR-B)

**Files:** none

- [ ] **Step 1: Run the complete gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green (tests should be unchanged — foundation touches no tested logic).

- [ ] **Step 2: Cross-surface eyeball checklist**

`pnpm dev:portal` + `pnpm dev:kiosk`:
- Sign-in: wordmark, Outfit body, coral focus ring on inputs, navy primary button.
- Admin users: table, dialog, dropdown, badges all on-brand; sidebar collapse hides wordmark text.
- Owner home: cards use card radius + navy-tinted shadow.
- Kiosk home: navy CTA, Outfit type, no broken colors.
- `prefers-reduced-motion` is honored by existing utilities (no new always-on animation added in foundation).

- [ ] **Step 3: Confirm no hardcoded hex slipped into components**

```bash
grep -rnE "#[0-9a-fA-F]{6}\b" apps/portal/components apps/portal/app apps/kiosk/src | grep -v "globals.css" | grep -v "index.css"
```
Expected: **no output** (all hex lives in the two token files + the inline seam-gradient var). If the seam gradient appears via `var(--gradient-seam)` that's correct; a raw `#...` in a component is a violation to fix.

---

## Task 8: Open the PR(s)

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ui-ux-stage1-foundation
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(ui): UI/UX Stage 1 — foundation (brand tokens, fonts, primitives, wordmark)" --body "$(cat <<'EOF'
## Summary
Stage 1 of the UI/UX polish (`docs/plans/2026-06-07-ui-ux-polish-stages.md`). Applies the locked Stage 0 brand (`docs/specs/2026-06-07-ui-ux-stage0-design-direction.md`) at the foundation layer — logic-orthogonal, no route/business-logic changes.

- Brand token layer (palette, type, radius, navy-tinted shadows, coral focus ring, seam gradient) in both portal + kiosk.
- Self-hosted fonts: Outfit + JetBrains Mono (Google) + Solitude + Vonique 43 (licensed Envato, self-hosted woff2).
- Re-skinned shared shadcn primitives + new Card; new accent (deep-coral CTA) + live (mint) variants.
- Shared Wordmark/LogoMark with the seam motif; logo = home preserved.
- Removed the Back-of-House "Jazz Club" `--kiosk-*` leftovers; repointed kiosk inline styles to brand tokens.

## Verification
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green. Cross-surface eyeball per plan Task 7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(If shipping as two PRs per the user's preference, push PR-A's commits to the same branch first and open it after Task 4, then stack PR-B — but a single foundation PR is acceptable and simpler given the work is cohesive.)

---

## Self-review notes (author)

- **Spec coverage:** §2 color → Tasks 2/4. §3 type → Tasks 1/3/4. §4 shape/elevation/motion → Tasks 2/4/5 (radius/shadow tokens + tactile press + brand focus ring; full motion choreography is Stage 3 per parent plan). §5 voice → not a foundation concern (Stage 3 copy). §6 per-surface → kiosk softer radius (Task 4), accent/live variants seeded (Task 5); full per-surface repaint is Stage 2. §7 implementation notes → all addressed (kiosk hex removal, `@theme` mirroring, font self-host, primitive re-skin not fork). §8 open items: #1 license resolved (confirmed); #2 label tier — shipping Vonique 43 (decided); #3 shadcn var contract — Card + primitives keep shadcn `data-slot`/var names.
- **Out of scope by design (parent plan):** per-page redesign (Stage 2), motion choreography + empty/error states + a11y/contrast audit + UX copy (Stage 3).
- **Risk:** `bg-accent`/`text-accent` previously resolved to near-white shadcn neutral; now coral. Any component relying on the old near-white accent as a subtle fill will shift to coral — caught in the Task 5/7 eyeball; fix by moving those to `bg-muted`.
