# Owner portal — LAYOUT redesign — DESIGN (proposed 2026-06-17)

**Status:** Design shaped via the brainstorming visual companion; **proposed, pending review.** Not yet built.
**Brand phase:** the layout phase (`docs/brand/brand-guidelines.md` §5) applied to the **owner** surface —
the last portal to inherit the shared gradient header. Sign-in (§5.1), shell (§5.2), and dashboards
(§5.3) are already shipped to prod.

**Scope of this doc:** (1) the **owner portal** redesign — adaptive Home, drill-through metrics, calm
inner pages; (2) a **shared call-list + filter layer** both portals reuse; (3) a **new `/admin/calls`**
page + admin-dashboard deep-links. Items (2)–(3) exist because the owner work introduces a call-outcome
filter Kumar wants on the admin side too. Kiosk is a separate later chat.

> **Decisions locked in brainstorming (2026-06-17):**
> 1. **Home = direction C (adaptive):** one hotel auto-expands into a full single-hotel glance; many
>    hotels show rich per-hotel cards that drill into the property hub. (A "list of one" for the pilot
>    was the rejected baseline.)
> 2. **Chrome = direction A:** persistent slim white bar (wordmark + `UserMenu`) + nav; the gradient
>    greeting header appears on **Home only**; inner pages carry just the seam hairline. (Direction B —
>    gradient header on every page — rejected as too heavy for a mobile-first surface.)
> 3. **Metrics are not read-only:** stat tiles and chips **drill into** a filtered Calls view.
> 4. **Incidents = blaze** (attention) for status, with a factual **red `911`** tag on emergency
>    incidents. (Red-everywhere rejected; red stays reserved for the live event.)
> 5. **`/admin/calls` is a real page**, superseding in-place filtering of the admin dashboard's recent
>    feed; admin dashboard tiles deep-link into it.

---

## 0. What changes vs. the current owner portal

The current owner portal (Plan 7a/7b, then Stage-2 repaint) already has the right **information
architecture** — Home / Calls / Incidents + a property detail drill-down, mobile-first, read views +
self-service writes (kiosk content, playbook, incident resolve). It has the new brand **tokens** but the
**old layout**: a flat sticky wordmark bar and a Home that is a greeting over flat property-glance cards.

This redesign keeps the IA and **all data/writes/RLS**, and changes **composition + depth**:

- **Home becomes adaptive and rich** (§3) — for the pilot's one hotel, a real single-hotel glance
  (coverage, outcomes, tonight's volume, recent, incidents) instead of a single flat card.
- **The gradient `DashboardHeader` is inherited** as the Home greeting (§2).
- **Metrics drill through** (§3.3, §4) — Answered/Missed tiles → `/owner/calls?outcome=…`, etc.
- **Calls gains an outcome filter** (§4) on top of its existing channel filter.
- **Incidents move to blaze** (§5).
- The call-list components are **promoted to a shared layer** and reused by a **new `/admin/calls`** (§6).

**Unchanged constraints (carried from Stage 5.3):** light mode only; brand-semantic colour
(mint = live/action, teal = links/nav, blaze = attention, red = 911/destructive only); **no migrations,
no RLS changes, no call/voice/emergency logic changes.** Every field already exists. New work = read
queries + pure helpers (TDD) + composition + **one new admin route** (`/admin/calls`, user-scoped client,
no service role). The owner portal itself adds **no new routes**.

---

## 1. Surface inventory

| Surface | Route | Change |
|---|---|---|
| Owner shell | `app/(owner)/layout.tsx` | Slim white bar + nav (keep); add gradient header on Home only via the page, seam hairline on inner pages |
| Owner Home | `app/(owner)/owner/page.tsx` | **Rewrite** — adaptive (single-hotel overview / multi-hotel cards) |
| Owner Calls | `app/(owner)/owner/calls/page.tsx` | Add outcome filter; reuse shared row/filters |
| Owner Call detail | `app/(owner)/owner/calls/[id]/page.tsx` | Restyle only (recording seam stays dark) |
| Owner Incidents list | `app/(owner)/owner/incidents/page.tsx` | Blaze attention treatment |
| Owner Incident detail | `app/(owner)/owner/incidents/[id]/page.tsx` | Blaze status + red `911` tag; resolve control kept |
| Owner Property detail | `app/(owner)/owner/properties/[id]/page.tsx` | Calm inner-page chrome; framed as the per-hotel management hub |
| Admin Calls | `app/(admin)/admin/calls/page.tsx` | **New** — operator-wide, shared row/filters + hotel filter |
| Admin sidebar | `components/app-sidebar.tsx` | Add `Calls` nav item |
| Admin dashboard | `app/(admin)/admin/page.tsx` | Outcome/live tiles + recent feed deep-link into `/admin/calls` |

---

## 2. Chrome — header + nav (direction A, LOCKED)

Mobile-first; nav follows the locked decision (bottom tab bar on mobile → top tabs on `md+`).

- **Persistent slim white bar** (every owner page, sticky): the `Wordmark` (home link, left), the
  desktop `OwnerTopNav` tabs (`md+`), and the owner's own `UserMenu` (right). A **2px seam hairline**
  (`--gradient-seam`) runs the bar's bottom edge — the brand motif threaded through every page.
- **Gradient greeting header on Home only:** the shared `DashboardHeader` (`components/dashboard/
  dashboard-header.tsx`, already built — takes `firstName` + a `children` slot) renders as the first
  block on Home, below the white bar. Owner passes **no** account menu into its slot (the `UserMenu`
  lives in the white bar; the header is a pure greeting moment). On mobile the header keeps its tall
  single-line greeting; it is **absent** on Calls / Incidents / detail.
- **Inner pages** (Calls / Incidents / property detail) open with a plain `font-display` page title under
  the white bar — calm and dense, no gradient band.
- **Bottom tab bar** (`OwnerBottomNav`, mobile, fixed) unchanged in structure; restyled to brand
  (teal-wash active).

> Rationale: a mobile-first surface should not spend ~100px of vertical space on a navy band on every
> screen; the gradient becomes a "you're home" moment, and inner pages keep call-history density.

---

## 3. Owner Home — adaptive (direction C, LOCKED)

`props` = the owner's active properties (existing query). **Branch on count.**

### 3.1 One property (the pilot) — the single-hotel overview

Rendered inline below the gradient header. A new `components/owner/property-overview.tsx` block:

1. **Coverage strip** — hotel name + a presence-driven status pill. Honest, never overclaimed:
   - assigned agent `AVAILABLE`/`ON_CALL` → **mint** dot + `"{Agent} · Available / On a call"`;
   - `AWAY`/`OFFLINE` → **muted** dot + `"{Agent} · Away / Offline"`;
   - no active assignment → `"No agent assigned"`.
   - Open incident present → a **left edge in blaze** (mirrors the multi-card edge).
2. **Stat tiles (4):** `Answered` · `Missed` · `Avg pickup` · `Last call`.
   - **`Answered` and `Missed` are links** → `/owner/calls?outcome=answered|missed` (§4).
   - `Missed` counts `NO_ANSWER` only, so the tile and the Calls "Missed" chip always agree.
3. **Tonight · call volume** — the `hourlyVolume` chart (channel-split: teal phone / navy video),
   tapping through to `/owner/calls`. **Graceful low-data:** when today's calls are few/zero, render a
   calm `"Quiet so far tonight"` state instead of a near-empty chart (threshold in the composition).
4. **Recent calls** — the latest few rows via the shared `CallRow` (expandable; channel + outcome +
   time + note icon). A `View all →` link to `/owner/calls`.
5. **Incidents card** — `✓ All clear tonight`, or blaze `"{N} open incident(s)"` → `/owner/incidents`.
6. **Manage card** — links into the property hub: `Kiosk content` · `Playbook` · `Property details`
   (all on `/owner/properties/[id]`).

**Data (single hotel):** fetch **today's call rows** for the property (for the chart / outcomes / avg
pickup / recent — bounded to today + a small recent window) + open incidents + the assigned agent's
`effectivePresence`. All via existing helpers (`hourlyVolume`, `countByOutcome`, `avgPickupSeconds`,
`splitTodayByChannel`) and the user-scoped client (owner RLS scopes it).

### 3.2 Many properties (future) — rich cards

The same Home renders a **grid of per-hotel cards** (the upgraded current card: name + presence dot +
agent, `Calls today` / `Open` / `Last call` mini-stats, mint live-edge / blaze open-incident edge). Each
card → `/owner/properties/[id]` (the per-hotel hub). Keeps the cheap per-property **count-query** pattern
(existing `page.tsx` Promise.all), not the full row fetch.

### 3.3 The drill-through rule

Nothing on Home is a dead readout. `Answered`/`Missed` tiles → filtered Calls; the volume chart →
`/owner/calls`; the incidents card → `/owner/incidents`. Implemented as plain `<Link>`s to query-param
URLs (RSC-friendly, shareable, no client state).

---

## 4. Calls — outcome filter + drill-through

`/owner/calls` already has a **channel** filter (`All · Phone · Video`, `?channel=`), keyset cursor
pagination, day grouping, and the expandable `CallRow`. Add:

- **Outcome filter** (`?outcome=answered|missed|failed`) — a second pill row (`All · Answered · Missed ·
  Failed`), each pill a `<Link>` like the channel row. Server maps the param to `calls.state` via a new
  pure helper and applies `.in("state", states)`:
  - `answered → ['COMPLETED']` · `missed → ['NO_ANSWER']` · `failed → ['FAILED']`.
  - Live states (`RINGING`/`IN_PROGRESS`) are never an outcome; an unknown/absent param = no filter.
- **Combines** with the existing channel + property + cursor params in the same `buildHref` (extend it
  with `outcome`).
- Outcome chips carry a small semantic dot (mint answered / blaze missed / muted failed) — colour is
  never the only signal; the label leads.

No new data, no migration — `state` and `channel` are existing indexed columns.

---

## 5. Incidents (blaze) + other inner pages

- **Incidents list / detail:** the **status** attention signal moves from red → **blaze**
  (`attention` token): the Home open-incident edge, the list-row dot + `Open` pill, and the detail
  header. Emergency incidents additionally carry a **factual red `911` tag** (red `destructive` token,
  label-paired) — separating "this was a 911 event" (red, factual) from "needs your review" (blaze,
  attention). The existing `resolveIncidentAction` + resolve control are unchanged.
  - Touch points: `lib/owner/status-pill.ts` / `components/owner/{incident-row,status-pill}.tsx` /
    the incident detail header / the Home edge logic in §3 / the shared `CallDetailBody`
    "view incident" link (red → blaze; see §6.1).
- **Call detail:** restyle only; the dark recording seam (renders only when `recording_url` is non-null)
  is unchanged.
- **Property detail = the per-hotel management hub:** unchanged data + writes (basics, `KioskContentCard`,
  `PlaybookCard`, recent calls). Re-dressed with the calm inner-page chrome and framed as where Home's
  Manage card and the multi-hotel cards land.

---

## 6. Shared call layer + admin (locked scope items 2–3)

### 6.1 Shared layer
- **Promote** `components/owner/{call-row,call-detail-body}.tsx` → `components/call/`. They carry no
  owner-only *data* logic; their imports of generic display utils (`status-pill`, `section-card`,
  `lib/owner/format`) can keep pointing at the current locations — **relocate the two files only and
  re-point the ~2 import sites** (owner Calls page, property-detail recent calls).
  - **One real change:** `CallDetailBody` hardcodes an owner incident link (`/owner/incidents/[id]`,
    currently styled red). Make the incident link an **injected prop** — owner passes the link;
    **admin passes none** (agent/admin have no incident route) — and **recolour it blaze** per §5.
- **New `lib/calls/outcome-filter.ts`** — `parseOutcome(param): Outcome | null` +
  `statesForOutcome(outcome): CallState[]`, TDD'd. Single source for the `outcome → state[]` mapping
  used by both Calls pages.
- **New `components/call/call-filters.tsx`** — a presentational pill-row component (channel + outcome,
  optional hotel) given current params + a `buildHref`. Reused by owner Calls and `/admin/calls`.

### 6.2 New `/admin/calls`
- `app/(admin)/admin/calls/page.tsx` — operator-wide call history in the admin shell. Same day-grouped
  `CallRow` list + the shared filters, plus a **Hotel** filter (all operator properties). Scoped
  `eq("operator_id", actor.operator_id)`; ADMIN RLS already permits operator-wide `calls` reads (the
  dashboard recent feed proves this) — **no RLS change, no service role, user-scoped client.** Reuses the
  keyset cursor pagination pattern.
- Secondary row line shows **hotel + handler** (operator-wide context), resolved via the existing 2-query
  handler-name merge.
- **Sidebar:** add a `Calls` item to the admin nav in `components/app-sidebar.tsx` (between Overview and
  Users), `exact`-safe.

### 6.3 Admin dashboard deep-links
- The admin command-center **outcome tiles** (Answered / Missed in the Tonight outcomes strip) and
  **`Live calls`** pulse tile link to `/admin/calls?outcome=…` (live → no outcome filter, just the page).
- The operator-wide **recent-calls feed** gains a `View all calls →` link to `/admin/calls`. The feed
  itself is **not** filtered in place (the dedicated page owns filtering).
- `DashTile` already supports `href` (added in session 22 for Phone health) — reuse it.

---

## 7. Brand / colour notes (these surfaces)

- **Channel colours (charts/bars, always legended):** teal `#2EA6AA` = phone/AUDIO, navy `#0F2D4B` =
  video/VIDEO.
- **Outcomes:** answered = mint dot/`live-foreground`; missed (`NO_ANSWER`) = blaze; failed = muted
  neutral (**not red**).
- **Attention:** open incidents + the blaze open-incident edge = `attention` (blaze). **Live/coverage** =
  mint. **Red** only for the factual `911` tag (and the agent-side live event, out of scope here).
- **Seam:** line/ring only — the white-bar bottom hairline, the header bottom seam, the coverage/idle
  rings. Never a fill.
- **Type:** numbers in JetBrains Mono; labels in Raleway (uppercase, tracked); greeting Raleway 600.
- **Anti-slop:** no identical-gradient KPI cards; no fabricated metrics (no CSAT, no "vs yesterday"
  deltas, no live-queue — v1 has parallel-dial, no hold queue). Quiet nights get a calm empty state, not
  filler.

---

## 8. New helpers + components to TDD / build

**Pure helpers (TDD first):**
- `lib/calls/outcome-filter.ts` — `parseOutcome` + `statesForOutcome` (§6.1).
- A small `coverageStatus(presence)` resolver for the coverage pill (mint/muted/none) — or extend
  `lib/owner/format.ts` (reuse `isLivePresence` + `presenceLabel`).
- Reuse, no new logic: `hourlyVolume`, `countByOutcome`, `avgPickupSeconds`, `splitTodayByChannel`,
  `countOpenIncidents`, `effectivePresence`, `startOfTodayUtc`, `dayGroupLabel`, the keyset cursor.

**Components:**
- `components/owner/property-overview.tsx` — the single-hotel glance (§3.1).
- `components/call/{call-row,call-detail-body}.tsx` — promoted (§6.1).
- `components/call/call-filters.tsx` — shared filter pills (§6.1).

---

## 9. Build order (suggested)

1. **Shared layer (TDD):** `outcome-filter.ts` + promote `CallRow`/`CallDetailBody` to `components/call/`
   + `call-filters.tsx`. Re-point owner Calls imports; green tests + typecheck + lint.
2. **Owner Calls:** wire the outcome filter through `buildHref` + the query; verify channel+outcome+
   property+cursor compose.
3. **Owner Home:** `property-overview.tsx` + the adaptive page rewrite (single overview / multi cards) +
   drill-through links + graceful quiet-night state.
4. **Owner chrome:** layout/header/nav (gradient on Home only, seam hairline on inner pages, restyled
   bottom nav).
5. **Owner inner pages:** incidents → blaze + red `911` tag; call detail + property-detail restyle.
6. **Verify owner** (browser on a Vercel preview — see §10), then commit the owner surface.
7. **Admin (separately verified):** `/admin/calls` page + sidebar item; admin dashboard deep-links.
8. **Verify admin**, then final whole-branch review.

---

## 10. Verification

- `pnpm test` (new helper tests green) + `pnpm typecheck` + `pnpm lint` + `pnpm check:routes` +
  `pnpm gen:types:check` + `next build` — all green (CI gates).
- **In-browser on a Vercel preview/prod deploy, not local dev** — the Next dev server is unreliable under
  the harness sandbox (`dev-server-sandbox-hazard` memory; never `xargs kill -9` by port). Check: owner
  Home (single-hotel overview + a simulated quiet night), drill-through into filtered Calls, the outcome
  filter, blaze incidents, mobile + desktop chrome. Admin: `/admin/calls` filters + pagination + the
  dashboard deep-links.
- Admin surfaces touch already-shipped prod — verify them as their own step (locked-scope item).

---

## 11. Deferred / v2 seams

- **Per-hotel "coverage" beyond the assigned agent** — the after-hours model parallel-dials the primary
  agent *and* accepting admins, so true "will someone answer?" includes admin availability. The owner
  coverage pill shows the **assigned agent** only (the established 7a signal); a fuller coverage model is
  v2.
- **Admin Calls as a dense table** — the first cut reuses the owner `CallRow` list for maximum reuse; a
  column-dense desktop table is a possible later enhancement.
- **Owner trend/baseline** ("vs typical night") — needs stored history; v2.
- **Recording playback** — the call-detail recording seam stays dark until Twilio recording is enabled
  (unchanged from 7a).
