# UI/UX Stage 2 — Owner Portal Repaint (surface 2 of 3)

**Created:** 2026-06-07 (session 10). **Status:** DESIGN — ready for implementation plan.
**Parent plan:** `docs/plans/2026-06-07-ui-ux-polish-stages.md` (Stage 2, surface 2).
**Design direction (locked):** `docs/specs/2026-06-07-ui-ux-stage0-design-direction.md`.
**Foundation (shipped):** Stage 1 — `docs/plans/2026-06-07-ui-ux-stage1-foundation.md` (brand tokens, fonts,
re-skinned shadcn primitives + `Card`, `Wordmark`/`LogoMark`).
**Sibling surface (shipped):** Stage 2 kiosk — `docs/specs/2026-06-07-stage2-kiosk-repaint-design.md`.

This is the **premium repaint** of the owner-facing portal — the client-facing surface, second in the
Stage-2 audience priority (Kiosk > **Owner** > Agent/Admin). It is purely a token/composition-layer
repaint: **no route logic, data-model, RLS, or API changes** (one cheap derived stat aside). The brand
palette, type, shape, and seam motif are already in the tokens from Stage 1; this spec decides **how they
compose** onto the owner screens.

---

## 1. Goals & non-goals

**Goals**
- Make the owner portal feel **premium, calm, trustworthy** and **mobile-first**, per Stage 0's per-surface
  art direction.
- Establish a small set of reusable owner presentational components so every screen is consistent and the
  page files stay thin.
- Repaint loading skeletons + empty states so they match the new card system (otherwise they look broken).

**Non-goals (explicitly out of scope)**
- No route/business-logic changes; no new data model, migration, RLS policy, or API route.
- No new shadcn primitives — reuse the Stage 1 `Card` + variants.
- Sign-in / onboarding — already branded in Stage 1.
- Deep motion / a11y / copy pass — that is **Stage 3** (this repaint stays within tasteful token-level
  transitions already in the primitives).
- Agent/Admin portals — that is Stage 2 surface 3.

**One small cross-surface change (approved):** the **time-aware greeting** also lands on the **kiosk** Home
(replacing the hardcoded `"Good evening."`). It shares the same helper. This is the only kiosk edit.

---

## 2. Design decisions (locked in the visual brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| **Ambition** | Premium redesign (reshape layouts, not just swap primitives) | Client-facing surface; highest polish after kiosk |
| **Home layout** | **C — rich cards only** (no aggregate summary band) | Pilot owners typically have 1 property; a top band would duplicate the single card |
| **List rows (Calls/Incidents)** | **A — card rows** (icon chip + status pill; coral left-edge on open incidents) | Matches the card direction; reads best on a phone |
| **Detail header** | **A — identity header** (name in display serif + meta + agent presence) then section cards | Calm, content-first |
| **Greeting** | **Time-aware** (morning/afternoon/evening), both surfaces, viewer's browser-local time | Personal + warm; browser-local is correct for both (kiosk tablet is on-site) |
| **Home "Last call" stat** | **Included** (3rd StatTile on the Home card) | Cheap to derive from data already fetched; reusable slot |

---

## 3. Shared building blocks

### 3.1 `greetingForHour` (pure, shared)

`packages/shared/src/greeting.ts` — `export function greetingForHour(hour: number): string`:
- `0–10` → `"Good morning"`, `11–16` → `"Good afternoon"`, `17–23` → `"Good evening"`.
- Pure + unit-tested (boundary hours 0/10/11/16/17/23). Exported from the package barrel.
- **Consumers compute the hour client-side** from `new Date().getHours()` (browser-local), then call the
  helper. No timezone library, no server time.

### 3.2 Owner presentational components (`apps/portal/components/owner/`)

Three small, single-purpose, independently-testable components. All use brand tokens only.

- **`StatTile`** — `{ value: string|number, label: string, alert?: boolean }`. Mono number (`font-mono`) +
  uppercase micro-label; `alert` turns the number `text-accent-strong` (coral). Used in the Home card stat
  row.
- **`StatusPill`** — `{ kind: "call"|"incident", status: string }`. Single source of truth mapping status →
  `{ label, classes }`, backed by a pure `lib/owner/status-pill.ts` (unit-tested):
  - Call: `COMPLETED`/`IN_PROGRESS`→mint-tinted (`bg-live/15 text-live-foreground`), `RINGING`→neutral
    (`bg-muted text-muted-foreground`), `NO_ANSWER`/`FAILED`→coral-tinted (`bg-accent/15 text-accent-strong`).
  - Incident: `OPEN`→**destructive red** (`bg-destructive/10 text-destructive` — incidents are 911, which
    Stage 0 reserves the red token for, distinct from coral), `RESOLVED`→neutral grey (`bg-muted text-muted-foreground`).
  - Uses existing semantic tokens; **no hardcoded hex.** Pure mapping unit-tested.
- **`SectionCard`** — `{ title: string, action?: ReactNode, children }`. Wraps the Stage 1 `Card` with an
  uppercase section header (`font-label`) and an optional right-aligned action slot (e.g. the kiosk-content
  "Edit" button). Replaces the ad-hoc bordered `<div>`s on every detail page.

### 3.3 Greeting island

`apps/portal/components/owner/greeting.tsx` (`"use client"`) — renders the time-aware greeting for Home.
Hydration-safe: initial render shows a neutral, stable string; a `useEffect` sets the time-aware greeting
on mount (avoids SSR/client tz mismatch). Used only on Home.

### 3.4 Seam motif usage (sparing, per Stage 0)

- Seam hairline (`--gradient-seam`) under the shell header.
- Mint **left-edge accent** on a Home property card when its assigned agent presence is "live"
  (`AVAILABLE`/`ON_CALL`).
- **Destructive-red** left-edge accent on a Home card with an open incident, and on open-incident list rows
  (911 = red token; red wins over the mint live-edge when both apply).
- Coral stays the brand accent — active nav, links, CTAs — never used for incident severity.
- (No large seam fills — line/ring work only.)

**Presence dots** (`presenceDotClass` in `lib/owner/format.ts`) are remapped from raw Tailwind palette
colors (`bg-emerald-500`/`bg-blue-500`/…) to brand tokens: `AVAILABLE`→`bg-live`, `ON_CALL`→`bg-accent`,
`AWAY`→`bg-muted-foreground`, `OFFLINE`→`bg-border`. A pure `isLivePresence(status)` helper
(`AVAILABLE`/`ON_CALL` → true) drives the mint seam edge.

---

## 4. Per-screen specification

### 4.1 Shell — `app/(owner)/layout.tsx` + `components/owner/owner-nav.tsx`
- Keep structure: sticky header (Wordmark = home link) + `OwnerTopNav` (md+) + `OwnerBottomNav` (mobile) +
  `UserMenu`.
- Add the **seam hairline** directly under the header border.
- **Active tab → coral**, not the current navy wash: top nav active = `text-accent-strong` + subtle coral
  underline/!wash; bottom nav active = `text-accent-strong` with active icon. Inactive stays muted.
- Touch targets on bottom nav comfortable (≥44px row height).

### 4.2 Home — `app/(owner)/owner/page.tsx` (layout C)
- `<Greeting/>` island headline (display serif) + small muted subline ("Your properties").
- Per-property **card** (Stage 1 `Card`), each:
  - Property name (medium) + right chevron.
  - Agent line: presence dot (`presenceDotClass`) + `full_name · presenceLabel`, or "No agent assigned".
  - **StatTile row** (3 tiles): **Calls today** · **Open** (alert when >0) · **Last call** (time in the
    property tz, or "—").
  - **Left-edge accent:** mint when agent presence is live; **destructive-red** when `openCount > 0` (red
    wins if both).
- Empty state restyled (icon + calm copy), unchanged copy intent.
- **New derived stat — "Last call":** computed from the `recentCalls` rows already fetched (max
  `ring_started_at` per property), formatted with the existing tz-aware formatter in `lib/owner/format.ts`.
  No new query. If a new helper is needed it's a pure addition to `lib/owner/summary.ts` (TDD).

### 4.3 Calls list — `app/(owner)/owner/calls/page.tsx` (+ `loading.tsx`)
- **Card rows grouped by day** (Today / Yesterday / `MMM D`), group label = `font-label` micro-header.
  Grouping is presentational over the already-sorted rows.
- Each row: icon chip (phone vs. video — type already on the row), primary line = time + `StatusPill`,
  secondary = agent name · duration (or "—"). Property name shown only when the owner has >1 property
  (already known in page scope) — keeps single-property rows clean.
- Keep `?property` filter + `?limit` load-more behavior verbatim; restyle the filter control + "Load more"
  button (primitives already branded).
- `loading.tsx` skeleton repainted to the card-row shape.

### 4.4 Call detail — `app/(owner)/owner/calls/[id]/page.tsx`
- Identity header: call time (display) + property + back affordance.
- `SectionCard`s: **Call** (type, outcome `StatusPill`, started/answered/ended, duration), **Handled by**
  (agent), **Incident** (link when present), **Recording** (the existing dark seam — renders only when
  `recording_url` is non-null; behavior unchanged).

### 4.5 Incidents list — `app/(owner)/owner/incidents/page.tsx` (+ `loading.tsx`)
- Same card-row idiom. Open rows: **destructive-red** left-edge + red `StatusPill`; resolved: neutral.
- Row: siren icon chip, primary = **"911 Emergency"** (incidents have no title field) + `StatusPill`,
  secondary = property · time · "dispatched to {dispatched_to}".
- `loading.tsx` repainted to match.

### 4.6 Incident detail — `app/(owner)/owner/incidents/[id]/page.tsx` (+ `resolve-incident.tsx`)
- **Status-colored header** (coral header treatment when `OPEN`, neutral when `RESOLVED`) with the
  `StatusPill`.
- `SectionCard`s: details, notes, **Resolution** (resolution note when resolved).
- `ResolveIncident` control restyled (uses branded `Button`/`Textarea`); existing
  expand→optional-note→confirm flow + "returns null when not OPEN" behavior unchanged.

### 4.7 Property detail — `app/(owner)/owner/properties/[id]/page.tsx` (+ `kiosk-content-card.tsx`, `playbook-card.tsx`)
- **Identity header (A):** property name (display serif) + location/timezone meta + agent presence line.
- `SectionCard`s in order: **Kiosk content** (existing inline Edit/Save/Cancel card — wrap/ restyle, behavior
  + the `kiosk_cta_style` Appearance picker unchanged), **Playbook** (existing view/upload card, behavior
  unchanged incl. the synchronous-`window.open` popup fix), **Recent calls** (card rows, reusing the Calls
  row component).
- Routing DID stays hidden (existing behavior).

### 4.8 Kiosk Home greeting — `apps/kiosk/src/screens/Home.tsx`
- Replace the hardcoded `"Good evening."` with `greetingForHour(new Date().getHours())` (browser-local =
  on-site time). No other kiosk change; the `kiosk_cta_style` styling map and layout stay as shipped.

---

## 5. Component / file inventory

**New**
- `packages/shared/src/greeting.ts` (+ barrel export) — `greetingForHour`
- `apps/portal/components/owner/stat-tile.tsx`
- `apps/portal/components/owner/status-pill.tsx`
- `apps/portal/components/owner/section-card.tsx`
- `apps/portal/components/owner/greeting.tsx` (client island)
- `apps/portal/components/owner/call-row.tsx` (shared by Calls list + property "Recent calls")
- `apps/portal/components/owner/incident-row.tsx`
- Tests: `greetingForHour`, `StatusPill` mapping, any new `lib/owner/summary.ts` helper (TDD)

**Modified (repaint only)**
- `app/(owner)/layout.tsx`, `components/owner/owner-nav.tsx`
- `app/(owner)/owner/page.tsx` + `loading.tsx`
- `app/(owner)/owner/calls/page.tsx` + `loading.tsx`, `calls/[id]/page.tsx`
- `app/(owner)/owner/incidents/page.tsx` + `loading.tsx`, `incidents/[id]/page.tsx`, `resolve-incident.tsx`
- `app/(owner)/owner/properties/[id]/page.tsx`, `kiosk-content-card.tsx`, `playbook-card.tsx`
- `apps/kiosk/src/screens/Home.tsx`
- (`lib/owner/summary.ts` / `format.ts` only if a pure last-call helper is added)

---

## 6. Constraints & invariants (must not regress)

- **No hardcoded hex** anywhere — tokens only (CLAUDE.md).
- **Light mode only**; mobile-first owner portal (other portals desktop).
- All reads stay through the **user-scoped Supabase client**; RLS unchanged. No service-role added.
- Preserve every behavior: `<AutoRefresh>` polling, `?property`/`?limit` params, inline kiosk edit + audit,
  playbook upload/view, incident resolve idempotency, Appearance picker, routing-DID hiding, recording seam.
- Reuse Stage 1 primitives; do not fork shadcn.

---

## 7. Testing & verification

- **Unit (Vitest, TDD):** `greetingForHour` boundaries; `StatusPill` status→class mapping; any new
  `summary.ts` last-call helper. Existing owner `lib/` tests must stay green.
- **Gates:** `pnpm lint` + `pnpm typecheck` + full test suite + `pnpm build` (portal + kiosk) all green —
  matches the established per-PR bar.
- **Visual:** eyeball all owner screens at mobile + `md+` widths (Home, Calls list/detail, Incidents
  list/detail, Property detail) and the kiosk Home greeting. Confirm seam accents, status colors, and the
  time-aware greeting render. (Authed prod confirm after merge, per the Stage 1 note.)

---

## 8. Rollout

- Own branch `feat/ui-ux-stage2-owner` off `main` → PR. Vercel auto-deploys portal + kiosk on merge.
- **Zero migrations / DB changes** → nothing to apply to prod ahead of or after merge.
- Subagent-driven implementation (fresh implementer per task + spec/quality review), mirroring the kiosk
  surface workflow.

---

## 9. Open items

None blocking. (Greeting timezone source resolved = browser-local for both surfaces; last-call stat
confirmed in-scope.)
