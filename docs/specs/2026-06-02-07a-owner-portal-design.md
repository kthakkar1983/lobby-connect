# Plan 7a — Owner Portal (Read Views) Design Spec

**Parent spec:** `docs/specs/2026-05-27-v1-architecture-design.md` §9.6 (responsive), §11 (owner portal scope)
**Builds on:** 6c (tag `plan-06c-emergency-complete`)
**Sibling:** 7b — Owner self-service writes (kiosk-field editing + playbook upload + incident resolve). Separate spec, built after 7a.

## Goal

Give a hotel owner a mobile-first portal to **see** what's happening at their properties: after-hours coverage at a glance, the full call history (audio + video), and emergency incidents. Read-only. Every meaningful write an owner can perform is deferred to 7b.

## Scope split (why 7a / 7b)

Plan 7's surface divides on a single clean seam — **does it write?**

| | 7a (this spec) | 7b (later) |
|---|---|---|
| Owner shell (header + bottom-tab nav) | ✅ | — |
| Home overview (per-property glance cards) | ✅ | — |
| Property detail (read) | ✅ | — |
| Call history + call detail | ✅ | — |
| Incident list + incident detail (read) | ✅ | — |
| Kiosk info-field **editing** | — | ✅ |
| Playbook **upload** + owner view route | — | ✅ |
| Incident **resolve** | — | ✅ |
| New migration | **none** | owner `UPDATE` RLS |
| New API routes | **none** | upload / resolve / playbook-view |
| Service-role code | **none** | possibly (storage upload) |

This is what makes 7a cheap and low-risk: owners **already** have RLS `SELECT` on their `properties`, `calls`, and `incidents` (policies in `0002_rls.sql`, `0004_fix_rls_recursion.sql`, `0008_incidents_emergency.sql`). 7a is pure UI over reads that already work.

## Decisions

1. **Zero migrations, zero new API routes, zero service-role code.** All data is fetched in Server Components via the **user-scoped** Supabase client; RLS does the owner-scoping. Nothing in 7a bypasses RLS.
2. **Polling without polling routes.** A small `<AutoRefresh interval={20000}>` `"use client"` helper calls `router.refresh()` on a 20s interval **and** on `window` focus, re-running the RSC fetch. Satisfies locked decision 4 (20s polling + refetch-on-focus) without any GET route handlers. Applied to Home and Incidents (freshness matters); Calls refetches on focus + manual "Load more".
3. **Navigation: bottom tab bar.** Fixed-bottom 3-tab bar (Home / Calls / Incidents) on mobile; promotes to an inline top nav at `md+`. New lightweight component — not the admin `AppSidebar`. The locked "collapsed icon-sidebar" decision (§5) is explicitly for the desktop agent/admin portals; owner is the mobile-first exception.
4. **Top-level IA: Home + Calls + Incidents.** Property detail is a **drill-down from a Home card**, not a fourth tab. Scales 1 → N properties without restructuring.
5. **Routing DID hidden from owners.** The internal `routing_did` is an operations detail; owners see the guest-facing `property_phone_number` only.
6. **Assigned-agent presence on Home.** The Home card shows the assigned primary agent's name + live presence dot (`profiles.status` from 5b: `AVAILABLE` / `ON_CALL` / `AWAY` / `OFFLINE`), or "No agent assigned".
7. **Recording-ready, recording-dark.** Call recording stays deferred to v1.1/v1.2. The call-detail view renders a playback section **only when `calls.recording_url` is non-null**. Today that branch never renders; the day recording ships, it lights up with no code change. `recording_url` / `recording_sid` already exist on `calls`.
8. **Single-vs-multi property:** build the list→detail structure for N properties; render gracefully for 1 (the pilot owner). The property filter on Calls and the property name column appear **only when the owner has > 1 property**.
9. **Account actions** live in the header `UserMenu` (mirrors admin): name, email, role badge, "Change password" → existing `/auth/update-password`, sign out. No separate account tab.

## Information architecture

```
(owner) shell  ── header: logo (= Home) · UserMenu
               └─ bottom tab bar: [ Home ] [ Calls ] [ Incidents ]

Home  ──►  per-property glance card  ──►  Property detail (read)
Calls ──►  call card  ──►  Call detail (+ conditional recording seam · incident link)
Incidents ──►  incident card  ──►  Incident detail (read; Resolve is 7b)
```

## Screens

### Shell — `(owner)/layout.tsx`
- `requireRole("OWNER")` (already present) + one small query for the user-menu identity (name + email), mirroring the admin layout.
- Slim sticky **top header**: logo on the left (links Home), `UserMenu` on the right.
- **Bottom tab bar** (`components/owner/owner-bottom-nav.tsx`): Home / Calls / Incidents with active-route highlighting; `fixed bottom-0` on mobile, inline top nav at `md:`.

### Home — overview · `owner/page.tsx` + `home-overview.tsx` (client, wrapped in `AutoRefresh`)
One **glance card per owned property** (one card for the pilot owner):
- Property name.
- Assigned primary agent: name + presence dot (`AVAILABLE` / `ON_CALL` / `AWAY` / `OFFLINE`), or "No agent assigned".
- Today's call count — calls at this property since **local midnight in the property's timezone**.
- Open-incidents badge — count where `status != 'RESOLVED'`; red when > 0.
- Tapping the card → that property's detail.

Data: `properties` (owned) + their active `property_assignments` (→ agent name + status) + a `calls` count (today) + an `incidents` count (open). Derivation logic lives in a pure, unit-tested `lib/owner/summary.ts`.

### Property detail — `owner/properties/[id]/page.tsx` (read-only in 7a)
- **Basics:** name, guest-facing phone (`property_phone_number`), timezone, after-hours support phone. Routing DID **not** shown.
- **Guest-facing kiosk content, display-only:** `kiosk_welcome_heading`, `kiosk_welcome_message`, `kiosk_checkin_time`, `kiosk_checkout_time`, `kiosk_wifi_network`, `kiosk_wifi_password`, `kiosk_breakfast_hours`, `kiosk_apology_message`. ("Edit" affordances arrive in 7b.)
- **Playbook:** show `playbook_version` only (or "No playbook yet"). Viewing/uploading the PDF needs a new owner-scoped signed-URL route → 7b.
- **Recent calls at this property:** a short preview (latest ~5) linking into Calls.

### Calls — history · `owner/calls/page.tsx` + `calls-list.tsx`
- Reverse-chron mobile cards: time (property tz), channel icon (audio / video), state badge, duration, handled-by agent, room number (video only), property name (only if owner has > 1 property).
- **State → owner-friendly label** (`CallState`): `COMPLETED` → "Completed", `NO_ANSWER` → "Missed", `IN_PROGRESS` → "In progress", `RINGING` → "Ringing", `FAILED` → "Failed". Mapping lives in `lib/owner/format.ts`.
- Property filter: rendered only when owner has > 1 property.
- Recent 50 + "Load more".
- **Call detail — `owner/calls/[id]/page.tsx`:** all fields + notes; an "Emergency — view incident" link when an `incidents` row references this call; and the **recording seam** (§ Decisions 7).

### Incidents — display · `owner/incidents/page.tsx` + `incidents-list.tsx` (read-only in 7a)
- List cards: time, property, status badge (`OPEN` / `RESOLVED` — the only two `IncidentStatus` values), dispatched-to (911), linked call. (`severity` is always `HIGH` and `kind` always `EMERGENCY_911` in v1 — single-valued, so shown as a fixed "911 Emergency" label rather than a variable badge; both columns stay forward-compat for future kinds.)
- **Incident detail — `owner/incidents/[id]/page.tsx`:** full info + linked call + notes. **Resolve is 7b** (no write control here).

## Data flow

1. Each route's Server Component `page.tsx` fetches with the user-scoped client (`createServerClient`). RLS restricts every query to the owner's own rows — no manual `owner_user_id` filter needed for correctness, though we still scope queries for efficiency.
2. The page passes plain data to a `"use client"` presentational component that owns layout and any local UI state (filters, expanded card).
3. Live views wrap their client component in `<AutoRefresh interval={20000}>`; it triggers `router.refresh()` on interval + focus, re-running step 1.

## Cross-cutting

- **Loading:** skeletons with the locked 10s timeout → error state w/ retry.
- **Empty states:** large lucide icon at 20% opacity — "No calls yet", "No emergencies".
- **Errors:** `sonner` toast + retry; RLS naturally yields empty for anything not the owner's.
- **Styling:** Tailwind tokens only, light mode, mobile-first; layouts scale up at `md+`. No hardcoded hex.
- **Accessibility:** keyboard nav, visible focus rings, labeled controls, ≥ AA contrast (§9.5).

## Testing

- **Pure helpers (`lib/owner/`), Vitest TDD first:**
  - `summary.ts` — per-property summary derivation: today-count (timezone-aware boundary), open-incident count, agent-presence resolution.
  - `format.ts` — timezone-aware time formatting, call-state → badge mapping, incident-status → badge mapping, duration formatting.
- **Components:** presentational; covered by existing patterns, no new framework tests.
- **Manual smoke (seed OWNER):** sign in as `owner@lobbyconnect.local` / `localdev123` (Olivia Owner already owns "The Sample Hotel", `owner_user_id = …b2`). Verify: Home card shows the property + assigned agent (Alex) + today-count + incident badge; Calls lists calls at the property (create one via the kiosk/phone path if empty); the 6c incident appears under Incidents; property/call/incident drill-downs render; layout works at mobile (375px) and desktop (≥1024px) widths; routing DID is absent from property detail; AutoRefresh updates Home after a new call without a manual reload.

## Files (anticipated)

```
apps/portal/
  app/(owner)/
    layout.tsx                              ← shell: header + UserMenu + bottom nav (replaces placeholder)
    owner/
      page.tsx                              ← Home overview (RSC fetch)
      home-overview.tsx                     ← client cards, wrapped in AutoRefresh
      properties/[id]/page.tsx              ← property detail (read)
      calls/page.tsx                        ← call history (RSC fetch)
      calls/calls-list.tsx                  ← client list (filter, load-more)
      calls/[id]/page.tsx                   ← call detail (+ recording seam)
      incidents/page.tsx                    ← incident list (RSC fetch)
      incidents/incidents-list.tsx          ← client list
      incidents/[id]/page.tsx               ← incident detail (read)
  components/owner/
    owner-bottom-nav.tsx                    ← bottom tab bar
    auto-refresh.tsx                        ← <AutoRefresh interval> (router.refresh on interval + focus)  [reuse if one already exists]
  lib/owner/
    summary.ts                              ← pure: per-property summary derivation
    format.ts                              ← pure: tz time, state/status → badge, duration
  tests/owner/
    summary.test.ts
    format.test.ts
```

(Final file list is the plan's job; this is the expected shape.)

## Forward-compat seams (no rework later)

| Later feature | Seam already in 7a |
|---|---|
| Call recording playback (v1.1/v1.2) | Call-detail renders playback iff `recording_url` non-null — dark today, auto-on later. |
| Owner kiosk-field editing (7b) | Property detail already renders every editable field display-only; 7b adds the "Edit" affordances + owner `UPDATE` RLS. |
| Playbook view/upload (7b) | Property detail shows version; 7b adds the owner signed-URL route + upload. |
| Incident resolve (7b) | Incident detail already renders status + notes; 7b adds the resolve control + write path. |
| Multi-property owners | List→detail structure + conditional filter/column already handle N. |
