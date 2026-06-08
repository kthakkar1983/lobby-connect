# UI/UX Stage 3 — States · Motion · Accessibility · Copy

**Created:** 2026-06-08 (session 12). **Status:** LOCKED — ready for `writing-plans`.
**Parent plan:** `docs/plans/2026-06-07-ui-ux-polish-stages.md`
**Design direction:** `docs/specs/2026-06-07-ui-ux-stage0-design-direction.md` (brand tokens, type, seam motif, motion stance, UX voice)
**Precedents:** Stage 1 foundation + the three Stage 2 surface repaints (kiosk, owner, agent/admin — all merged + prod-deployed).

This is the **final UI/UX phase**. The brand token layer, fonts, re-skinned shadcn
primitives, and all three per-surface repaints have shipped. Stage 3 is the cross-cutting
polish pass that the per-surface work deliberately deferred: the **states** between the happy
paths (empty / loading / error), **motion** consistency, a **formal accessibility** pass, and a
**copy** pass. It touches every surface but adds no features, routes, migrations, or business
logic.

---

## 1. Scope

**Cross-cutting polish only.** Four tracks, one PR (subagent-driven, like the Stage 2 repaints).

**In scope:**
- **States** — a reusable on-brand `EmptyState` component wired into every zero-item case; on-brand
  error surfaces (`global-error`, route `error.tsx`, kiosk error/reconnect); brand-timed `Skeleton`;
  a kiosk first-load screen.
- **Motion** — shared motion tokens (easing + duration) mirrored portal⇄kiosk; the Stage 0 **seam
  drift** finally implemented on connected/active states; press feedback on all pressables;
  universal `prefers-reduced-motion` coverage (a global safety net + fixing ad-hoc utilities).
- **Accessibility** — a **formal WCAG 2.1 AA audit** producing a written conformance report, then
  remediation of every Level A/AA finding (kiosk `aria-label`s, `sr-only` context, toast
  announcement, brand-token contrast, focus order, touch targets, label association).
- **Copy** — a **light shared copy module** (`lib/copy`) for high-traffic user-facing strings
  (auth/sign-in errors, empty states, error pages, common toasts, emergency confirm, kiosk
  screens), voiced per Stage 0 §5. Deep page-specific strings stay inline.

**Out of scope (non-goals):**
- **No features, no migrations, no new API routes, no business-logic / routing / call-handling
  changes.** Softphone, video, Twilio/Agora, presence, finalization, RLS — all untouched.
- **No i18n framework.** The shared copy module is a plain TS object, not `next-intl`/message
  catalogs. (Forward-compat seam only; multi-language is a v2 concern — CLAUDE.md tenancy note.)
- **No dark mode** (light only — locked) and no new color tokens beyond motion easing/duration.
- The Solitude capital-**W** glyph issue stays a **separate task** (tracked since Stage 2).
- Recording playback, voicemail, and other cut-from-v1 stubs stay stubs.

**Decisions locked by the user (session 12 scoping):**
1. Copy → **light shared module** (not in-place-only, not full i18n).
2. A11y → **formal WCAG 2.1 AA audit** + remediation (not a lighter pragmatic pass).
3. States → **reusable `EmptyState` component** + on-brand error states (not text-only).

---

## 2. Brand semantics carried into Stage 3

Single source of truth remains the Stage 0 token layer (shipped Stage 1). Stage 3 adds **no
color**; it adds **motion** tokens and applies existing color semantics to the new state surfaces:

- **Mint (`--color-live`)** = connected / live / success — the seam-drift "connected" cue, the
  positive empty state where relevant.
- **Coral (`--color-accent-strong`)** = brand accent + primary recovery action ("Try again").
- **Red (`--color-destructive`)** = 911 / destructive / genuine error only. An *error state* page is
  **not** automatically red — copy + a neutral/navy treatment with a single coral recovery action
  reads calmer and on-voice. Red is reserved for true destructive/emergency, never for "an empty
  list" or "a transient fetch failure."
- **Seam gradient** = line/ring work only (now optionally *drifting* on active-call surfaces).

Color is never the sole signal (WCAG 1.4.1): every state pairs an icon + text; the seam-drift cue
keeps its existing "Connected" label + dot; focus is a ring, not a color change alone.

---

## 3. Track A — Motion

### 3.1 Motion tokens (new, mirrored portal ⇄ kiosk)

Stage 0 fixed the curve (`cubic-bezier(0.16,1,0.3,1)`) and the durations (150ms micro /
200–250ms standard) but never tokenized them; motion today is ad-hoc inline values. Add to the
`@theme` block in **both** `apps/portal/app/globals.css` and `apps/kiosk/src/index.css`:

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);     /* Stage 0 curve — entrances, UI responses */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* on-screen movement / morph */
--duration-fast: 150ms;    /* micro: press, hover */
--duration-standard: 220ms; /* default UI: dropdowns, toggles */
--duration-slow: 320ms;     /* dialogs/sheets (already ~300–500ms via radix) */
```

These are **shared values**, not a new abstraction layer — components keep using Tailwind
utilities; the tokens give the recurring magic numbers one home and a single curve. Per Emil:
never `ease-in` on UI, never `transition: all`, stay under ~300ms for UI. Where a primitive
currently uses `transition-all` (e.g. `components/ui/button.tsx`), narrow it to the properties
that actually change (`transition-[color,box-shadow,transform]`).

### 3.2 The seam drift (Stage 0's unfinished signature)

Stage 0 §1/§4 promised a "seam ring slow gradient drift on an active call." Today the kiosk
*rotates the whole ring element* (`.seam-ring.lc-anim-spin` on `Ringing`) but the gradient itself
never drifts, and portal active-call edges (softphone idle ring, in-call card edge, video PiP
frame) are **static**. Implement an actual angle drift via a registered custom property so the
gradient angle animates (not the element):

```css
@property --seam-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 135deg;
}
@keyframes lc-seam-drift { to { --seam-angle: 495deg; } } /* 135 + 360 */
.lc-seam-drift {
  background: linear-gradient(var(--seam-angle), #2C425C, #06D6A0, #F0795B);
  animation: lc-seam-drift 8s linear infinite;
}
```

- **Where:** the softphone idle ring and the in-call seam edge (portal), the kiosk `Connected`
  caller ring. **Slow (8s)** — this is an *occasional/rare* surface (Emil's frequency rule: delight
  is allowed where users don't see it hundreds of times a day). The agent dashboard and admin
  tables get **no** decorative motion (Stage 0: "function over flair").
- The seam **hairline under headers** stays static (it's persistent chrome, seen constantly →
  no animation, per the frequency rule).
- Hex stays out of components — the keyframe lives in the CSS layer next to `--gradient-seam`,
  which is the one sanctioned place brand hex is written (mirrors the existing `--gradient-seam`).

### 3.3 Press feedback

Emil: every pressable confirms the press with a subtle `scale`. Kiosk already does
(`active:scale-95` / `active:scale-[0.98]`). Bring the **portal** `Button` primitive in line:
add `active:scale-[0.98]` + `transition-transform` (composed with the existing focus/color
transition), gated so it doesn't fight `:disabled`. This lifts every button app-wide at once.

### 3.4 Skeleton — brand timing

`components/ui/skeleton.tsx` uses stock `animate-pulse`. Replace with a gentle brand shimmer
(left-to-right sweep, transform/opacity only) consistent with the kiosk `lc-shimmer`, OR a softer
pulse using brand opacity — chosen during build by eye (Emil: "adjust until it feels right").
Must honor reduced motion. Skeletons are seen often but briefly → keep it *calm*, not flashy.

### 3.5 Universal `prefers-reduced-motion`

Today only the kiosk CSS block + a handful of portal `motion-reduce:animate-none` utilities honor
it. Add a **global safety net** to `apps/portal/app/globals.css` (and confirm the kiosk block
covers the new drift):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is a belt-and-suspenders net (the standard a11y pattern) so *no* animation — including future
ones — can violate reduced-motion. The kiosk's existing explicit block stays (it also kills the
infinite seam drift). Per Stage 0: reduced motion means *gentler*, not zero — opacity/color cues
that aid comprehension (the mint connected dot's color, the line-beacon state) remain; only
movement/looping is neutralized.

---

## 4. Track B — States

### 4.1 `EmptyState` component (new, portal)

`apps/portal/components/ui/empty-state.tsx` — a presentational shadcn-style primitive:

```
<EmptyState
  icon={Inbox}              // lucide component (rendered inside; client-safe per RSC note)
  title="No calls yet"      // Outfit semibold, foreground
  description="Calls to the front desk will appear here."  // muted, ≤1 line
  action={<Button>…</Button>}  // optional; only where the user can act
/>
```

- Centered, generous vertical padding, a muted circular icon chip (navy-tinted, `--color-muted`
  bg, `--color-muted-foreground` icon), title, one-line description, optional action. Uses brand
  radius/spacing tokens. No illustration art (out of scope/over-budget for pilot; icon chip is the
  on-brand middle ground).
- **RSC boundary note (CLAUDE.md):** passing a lucide *component* from a Server Component to a
  client child is a fatal 500 in Next 15.5. `EmptyState` accepts an icon **component** prop, so it
  must either be a client component itself, or callers in Server Components must be `"use client"`
  table/list children (most already are). Prefer making `EmptyState` itself accept the component
  and render it internally, and only use it from client components / pass a pre-rendered element
  from servers. The plan calls this out per call site.

**Wire into every zero-item case** found in the footprint audit:

| Surface | File | Current |
|---|---|---|
| Owner home | `app/(owner)/owner/page.tsx` | "No properties assigned to you yet." |
| Owner calls | `app/(owner)/owner/calls/page.tsx` | "No calls yet." |
| Owner property detail | `app/(owner)/owner/properties/[id]/page.tsx` | "No calls yet." |
| Owner incidents | `app/(owner)/owner/incidents/page.tsx` | "No emergencies." |
| Agent layout | `app/(agent)/layout.tsx` | "No properties assigned." |
| Agent dashboard | `app/(agent)/agent/page.tsx` | "No calls handled yet." |
| Admin users | `app/(admin)/admin/users/users-table.tsx` | "No users yet" |
| Admin properties | `app/(admin)/admin/properties/properties-table.tsx` | "No properties yet" |
| Admin audit | `app/(admin)/admin/audit/audit-table.tsx` | "No audit events yet." |

For table empties (users/properties/audit), render `EmptyState` in a full-span row or below the
table head, not as a bare `<td>` string. **Actions only where the user can act**: admin
users/properties get an action that opens the existing create dialog; owner/agent reads stay
calm/text-only (nothing to do there) — Stage 0 voice: never invent a CTA that has no target.

### 4.2 Error surfaces

- **`app/global-error.tsx`** — repaint on-brand: a surface card on `--color-background`, a seam
  hairline, an `AlertTriangle` icon chip (navy/muted, **not** red — a render error isn't an
  emergency), Outfit title, calm copy from `lib/copy`, a single coral recovery `Button`. Keep the
  Sentry capture. Keep it self-contained (it renders its own `<html><body>` — root layout is gone
  at this level, so no brand fonts/CSS classes guaranteed; rely on inline-safe tokens already on
  `body`).
- **Route `error.tsx`** — add segment error boundaries for the data-heavy authed segments
  (`(agent)`, `(admin)`, `(owner)`) so a thrown server component shows an on-brand "Couldn't load
  this" card with a retry, instead of bubbling to the stark global handler. Reuse a shared
  `<ErrorState>` (sibling to `EmptyState`: icon + title + description + retry action).
- **Kiosk** — the `ReconnectingOverlay` is already on-brand (seam-ring spin + reassuring copy);
  pull its copy into `apps/kiosk/src/lib/copy.ts` and confirm the existing `ErrorBoundary`
  (CLAUDE.md, session 6) renders an on-brand fallback (icon + calm copy), not a raw stack.

### 4.3 Kiosk first-load screen

The kiosk jumps straight to HOME/RINGING with no first-paint state. Add a minimal **Loading**
screen (seam-ring spin + a single reassuring line) shown until config resolves / the app is ready,
so a slow tablet network doesn't flash an unstyled frame. Small, on-brand, reduced-motion-safe.

---

## 5. Track C — Accessibility (formal WCAG 2.1 AA)

This track has two phases: **audit → remediate.**

### 5.1 The audit (deliverable: a written conformance report)

Produce `docs/audits/2026-06-08-wcag-2.1-aa-audit.md` — a criterion-by-criterion WCAG 2.1
Level A + AA conformance review across all surfaces (kiosk, owner, agent, admin, auth), using the
`design:accessibility-review` skill as the rubric. For each applicable success criterion, record
**Pass / Fail / N/A** with the file:line evidence and a remediation note for each Fail. Cover at
minimum:

- **1.1.1** Non-text content (icon-only buttons, decorative imagery `alt=""`).
- **1.3.1 / 4.1.2** Info & relationships / Name-Role-Value (form label association, button
  accessible names, ARIA on custom controls, table semantics).
- **1.4.3** Contrast (minimum) — **measure** every brand token pairing actually used as text:
  - `--color-muted-foreground #64748B` on `#F6F8FA` and on `#FFFFFF` (labels/captions — the
    highest-risk pairing; likely borderline ~4.5:1, must be confirmed).
  - `--color-accent-strong #E05A39` as link/text on white (Stage 0 admits base coral fails; deep
    coral is "AA at button/large scale" → **body-size coral links may FAIL 1.4.3** and need a size
    bump or a darker text variant — quantify it).
  - `--color-live-foreground #048A67`, `--color-primary #2C425C`, `--color-destructive #C81E1E`
    on their backgrounds; placeholder text; muted-on-muted (zebra rows).
- **1.4.11** Non-text contrast (focus rings, input borders, the seam hairline as a boundary,
  status dots — 3:1 against adjacent colors).
- **1.4.1** Use of color (every state pairs a non-color signal).
- **2.1.1 / 2.1.2** Keyboard / no trap (dialogs, sheets, dropdowns, the softphone, video overlay).
- **2.4.3** Focus order; **2.4.7** Focus visible (the coral ring — confirm it's present and 3:1
  everywhere, including on coral/navy fills where a coral ring may be invisible → may need an
  offset/contrasting ring on colored buttons).
- **2.5.5 / 2.5.8** Target size — kiosk ≥ Stage 0's 56px (mostly met), portal interactive targets
  ≥ 24px (AA) / note where < 44px.
- **4.1.3** Status messages — toasts (sonner) and live regions announced to AT (`aria-live`).

The report's Fail list **becomes the remediation task list** — the plan references it rather than
hard-coding fixes that the audit might reprioritize.

### 5.2 Known remediations (seeded from the footprint audit; the formal audit may add more)

- **Kiosk `aria-label`s** — every interactive control gets an accessible name (CallControls has
  them; Home CTA, RecordingNotice button, Apology dismiss do not consistently). Decorative
  seam-rings stay `aria-hidden`.
- **`sr-only` context** — "Opens in new tab" on the playbook/external links; visually-hidden
  headings where a region lacks one; a `sr-only` page `<h1>` where the visible title is a logo.
- **Toast announcement (4.1.3)** — ensure sonner toasts reach an `aria-live` region (configure
  the `Toaster` / add a polite live region) so success/error toasts are spoken.
- **Contrast fixes** — apply whatever §5.1 quantifies (most likely: bump coral body-links to a
  larger/semibold treatment or darken to an `accent-strong`-on-light that clears 4.5:1; verify
  muted-foreground; ensure focus ring is visible on coral/navy fills via offset).
- **Form labels** — normalize implicit-wrap labels to explicit `htmlFor`/`id` (sign-in form).
- **Focus visible on filled buttons** — the coral focus ring vanishes against a coral fill; use the
  existing `ring-offset-background` (already on the primitive) and confirm 3:1, adding a contrasting
  ring color on same-color fills if the audit flags it.

Remediation must not regress the shipped repaints — chrome/contrast only, no layout churn.

---

## 6. Track D — Copy (light shared module)

### 6.1 The module

`apps/portal/lib/copy.ts` — a flat, typed object of high-traffic user-facing strings, grouped by
area. Plain TS (no framework). Example shape:

```ts
export const copy = {
  empty: {
    ownerCalls: { title: "No calls yet", description: "Calls to the front desk will appear here." },
    incidents:  { title: "No emergencies", description: "Resolved and active emergencies show up here." },
    // …one entry per §4.1 call site
  },
  error: {
    global: { title: "Something went wrong", description: "This screen hit an unexpected error — it's been logged. Try again, or reload." },
    segment:{ title: "Couldn't load this", description: "Something went wrong fetching this. Try again." },
  },
  auth: { /* migrated from lib/auth/sign-in-errors.ts, re-voiced */ },
  emergency: { confirm: { title: "Call 911?", body: "This dials emergency services and adds the guest and you to the call." } },
  // toasts: common reusable ones (playbook, save/upload failures)
} as const;
```

- **Migrate** the existing `lib/auth/sign-in-errors.ts` strings into `copy.auth` (keep
  `mapSignInError` logic; it reads from `copy`). Wire empty/error components and the highest-traffic
  toasts to `copy`. **Leave deep page-specific strings inline** — the module is for reuse and voice
  consistency, not exhaustive extraction.
- **Kiosk** gets its own tiny `apps/kiosk/src/lib/copy.ts` (Home greeting prefix, RecordingNotice,
  Apology fallback, Reconnecting, the new Loading line, error fallback). The two modules are
  independent (separate apps/build graphs) — no shared package needed for ~a dozen strings.

### 6.2 Voice pass (Stage 0 §5)

Re-voice every migrated/empty/error string to: calm, warm, plain-spoken; honest + actionable; no
error codes; never blame the user. Examples:
- Global error: keep "Something went wrong" (it's fine) but make the body actionable, not a dead end.
- Empty states get a forward-looking line ("…will appear here.") instead of a terminal "No X."
- Emergency confirm stays **direct, unmissable** (Stage 0: *"Calling 911. Stay on the line."*).
- Sign-in default stays deliberately generic ("Invalid email or password.") — **security choice**,
  not a copy gap; the audit/footprint flagged it but we keep it (don't reveal which field is wrong).

---

## 7. Architecture & constraints

- **Logic-orthogonal** — like the Stage 2 repaints, this is token/component/CSS/copy work. No
  route, data, RLS, API, migration, or call-logic changes. The only "logic" is the pure `copy`
  object and `mapSignInError` reading from it (unit-testable).
- **No hardcoded hex** — motion keyframes that need brand hex live in the CSS layer beside
  `--gradient-seam` (the sanctioned place). Components use tokens/utilities only.
- **Reuse before adding** — `EmptyState`/`ErrorState` are the only new components; everything else
  modifies existing files or the CSS/token layer.
- **Both apps** — motion tokens + reduced-motion net must be mirrored portal⇄kiosk (Stage 0 §7).
- **Don't regress shipped repaints** — Stage 2 surfaces are in prod; Stage 3 adds states/motion/a11y
  on top without reworking their layouts.

## 8. Testing & verification

- **Unit (Vitest):** `lib/copy` shape/`mapSignInError` (migrated tests stay green); `EmptyState`/
  `ErrorState` render (icon/title/description/optional action) if a render test fits the existing
  harness. Target: full suite stays green (currently 347 tests).
- **Gates:** `cd apps/portal && pnpm typecheck · pnpm lint · pnpm build`; kiosk
  `cd apps/kiosk && pnpm typecheck · pnpm build`.
- **A11y verification:** the §5.1 report is the artifact; spot-verify key fixes with the browser
  (focus order, contrast values via devtools, reduced-motion via emulation, a screen-reader pass on
  the kiosk call flow + one portal form).
- **Visual:** verify empty/error/loading states render on-brand in the running apps; confirm the
  seam drift is subtle and reduced-motion kills it.

## 9. Suggested task groups (for `writing-plans`)

1. **A11y audit first** (informs everything) → the WCAG report doc.
2. **Motion foundation** — tokens (both apps), reduced-motion net, seam-drift CSS, Button press,
   Skeleton timing.
3. **States** — `EmptyState` + `ErrorState` components, wire into all call sites, repaint
   `global-error` + add segment `error.tsx`, kiosk Loading screen.
4. **Copy** — `lib/copy` (+ kiosk copy), migrate sign-in errors, voice pass, wire components.
5. **A11y remediation** — execute the §5.1/§5.2 fix list.
6. **Verify + tag** — gates green, suite green, visual + a11y spot-checks, `git tag
   plan-stage3-states-motion-a11y-copy-complete`.

## 10. Open items

1. Final contrast numbers (§5.1) decide whether coral body-links need a size/weight bump or a
   darker text token — resolved by the audit, not pre-decided here.
2. Whether `EmptyState` is best as a client component vs. server-with-pre-rendered-icon — decided at
   build time per call-site RSC boundaries (§4.1).
3. Skeleton shimmer-vs-pulse — chosen by eye during build (§3.4).
