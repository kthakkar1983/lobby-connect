# UI/UX Stage 2 — Agent/Admin Repaint (Surface 3 of 3)

**Created:** 2026-06-08 (session 11). **Status:** LOCKED — ready for `writing-plans`.
**Parent plan:** `docs/plans/2026-06-07-ui-ux-polish-stages.md`
**Design direction:** `docs/specs/2026-06-07-ui-ux-stage0-design-direction.md` (brand tokens, type, seam motif)
**Precedents:** kiosk repaint (`…stage2-kiosk-repaint-design.md`), owner portal repaint (`…stage2-owner-portal-repaint-design.md`)

This is the third and final per-surface repaint. The agent and admin portals are the
**internal, operational** surface — the Stage 0 brief: *"dense, operational, quiet… function
over flair."* It is the lowest-priority audience (Kiosk > Owner > Agent/Admin) and is built
last, after the kiosk and owner surfaces.

---

## 1. Scope

**Repaint + light read-only data.** Unlike the owner repaint (token/composition only, zero
queries), surface 3 is allowed a small number of **read-only** Server Component queries so the
agent dashboard and admin overview become genuinely useful instead of prettier stubs.

**In scope:**
- Brand repaint of every agent + admin screen, the shared softphone, and the video-call overlay.
- New read-only queries for the agent dashboard + admin overview (below).
- Relocating + rewording the in-call Emergency action and its confirmation dialog.

**Out of scope (non-goals):**
- **No writes, no migrations, no new API routes.** Reads go through existing RLS-scoped clients.
  (The existing `accepting_calls` toggle write on the admin overview is unchanged.)
- No business-logic / routing / call-handling changes. The softphone + video state machines,
  Twilio/Agora wiring, presence, and finalization logic are untouched — chrome only.
- No new features. Cut-from-v1 stubs (Hold/Swap, on-call-manager notify) stay stubs.
- The Solitude capital-**W** glyph issue is tracked as a **separate task** (cross-cutting; affects
  already-shipped kiosk + owner). Accepted as-is for this PR.

**Dependency:** reuses owner-portal presentational components (`StatTile`, `StatusPill`,
`SectionCard`) and `lib/owner` helpers introduced in the owner repaint (PR #15). That PR must be
merged to `main` first, or this branch must be cut from it.

---

## 2. Brand semantics (how color is used on this surface)

Single source of truth is the Stage 0 token layer (already shipped in Stage 1). This surface's
rules:

- **Mint (`--color-live`)** = healthy / live / connected: presence "online" dots, the agent
  line-up beacon, the in-call connected cue, the "Accept" action, healthy status.
- **Coral (`--color-accent` / `--color-accent-strong`)** = brand accent **and** the mid-tier
  "needs attention / degraded" signal: active sidebar item, links, `StatTile` alert, **Hang up /
  End**, and the **degraded** status state (replaces a dedicated amber token — *no new token is
  added*).
- **Red (`--color-destructive`)** = **911 / emergency only**, plus genuine down/error status and
  destructive confirmations (delete/deactivate). Red never means "end the call."
- **Navy (`--color-primary`)** = ink/text, nav rail, secondary buttons.
- **Seam gradient (`--gradient-seam`)** = line/ring work only: hairline under headers, the
  softphone idle ring, the in-call card edge, the video self-view PiP frame.

Color is never the sole signal: pills carry text, status dots pair with labels, the line beacon's
disconnected state also changes shape behavior (flash), emergency pairs red with an icon + label.

---

## 3. Agent dashboard — idle / between-calls

File: `app/(agent)/agent/page.tsx` (currently a two-card stub) + `app/(agent)/layout.tsx`.

The agent layout keeps its two-column shell: **main (1fr)** + **right rail (320px)** holding the
`Softphone` and `VideoCallHost`. We design the **main area** (what an agent watches while waiting)
and restyle the rail. During an **audio** call the rail's softphone switches to its in-call state;
during a **video** call the full-screen overlay (§6) takes over. The dashboard is the idle state.

**Layout — 2×2 aligned grid:**

| | Left (main, 1fr) | Right (rail, 320px) |
|---|---|---|
| **Top row** | Greeting hero + stat strip (height matches softphone) | Softphone card |
| **Bottom row** | Recent calls (height matches properties) | Properties you cover |

- **Greeting hero** (`Card`): display-serif greeting **"Good {morning/afternoon/evening}, {first
  name}."** via the existing `greetingForHour` helper (`packages/shared`), with a "Covering N
  properties" subline. **Line-status beacon** in the top-right corner: solid **mint** when the
  softphone line is up, **flashing red** when dropped. No text. The beacon's state is driven by
  the softphone's connection phase (client state lifted/shared — see §5); under
  `prefers-reduced-motion` the red stays **solid** (no flash).
- **Stat strip** — three `StatTile`s: **Today** (calls you handled today), **Avg pickup**
  (mean answer latency), **Missed**. Mono numerals.
- **Recent calls** (`Card`): compact list of the agent's recently handled calls — `Room/label ·
  property` left, mono time right, hairline dividers.
- **Softphone card** (rail): anchored by the **seam ring** with a **soft rotating glow**
  (decorative ambiance, *not* a status indicator; disabled under reduced-motion), then the
  Ready/Away toggle and the existing connection states (§5).
- **Properties you cover** (rail `Card`): plain list of assigned-property names (no per-property
  dots — kiosk-online lives on the admin overview, not here).

**Reads (agent-scoped, RLS):**
1. Active primary assignments for this agent → property names + count ("Covering N").
2. Calls handled by this agent today (tz-aware day window) → Today count + Avg pickup
   (`answered_at − created_at` mean).
3. Missed: calls to the agent's covered properties that ended unanswered today
   (`state = NO_ANSWER`). *Implementation note:* per-agent "missed" attribution is fuzzy; if it
   can't be derived cleanly from existing columns, scope Missed to covered-property NO_ANSWER
   counts, or drop the tile rather than add a write.
4. Recent handled calls (last ~5) for the list.

---

## 4. Admin overview — "Operations board"

File: `app/(admin)/admin/page.tsx` + `availability-cards.tsx`.

Replaces today's two big Users/Properties **link cards** (redundant with the sidebar) with an
operations board. The admin sidebar + header softphone bar are unchanged structurally (repaint
only).

**Layout:**
- **Header:** display-serif greeting ("Good evening, {name}.") + body descriptor "Admin overview —
  users, properties, and call coverage for your operator."
- **Stat strip** — `StatTile`s: **Agents online · Calls today · Open incidents · Accepting (n/total)**.
  Open incidents is a **glance number only** (no admin drill-down route exists; do not link it).
- **Properties ops table** (`Card` + `Table`): one row per active property —
  **Property · Primary agent (+presence dot) · Calls today · Covering (toggle)**. The "Covering"
  toggle is the existing `admin_call_availability` write (`AvailabilityCards` logic), now inline in
  the table — *the one write on this surface, unchanged.* **No Kiosk column** — see the resolved
  data risk below.

**Reads (operator-scoped, RLS):**
1. Agents online — agent profiles whose presence is `AVAILABLE`/`ON_CALL` with fresh `last_seen_at`
   (within `STALE_AFTER_MS = 90s`) → count.
2. Calls today — operator-wide; each call judged "today" in **its own property's timezone**
   (per-call `isToday(ring_started_at, property.timezone, now)`), so multi-tz operators stay
   correct. (Same approach on the agent dashboard.)
3. Open incidents — `incidents` count where `status = OPEN`.
4. Per property: active primary assignment + that agent's presence (`presenceDotClass` /
   `presenceLabel`); calls-today count; the admin's own `accepting_calls`.

**Data risk — kiosk-online — RESOLVED: dropped.** Investigation confirmed `/api/kiosk/heartbeat`
is a **no-op** (auth-check → `204`; the code comment notes "a kiosks.last_seen_at write slots in
here later"). Per-property kiosk liveness is **not queryable** today, and surfacing it would require
a write — out of scope. The Kiosk column is **omitted for v1**; it slots in once heartbeat
persistence lands.

---

## 5. Softphone chrome

File: `components/softphone/softphone.tsx` (shared by agent rail + admin header bar). **Logic
untouched** — repaint + the emergency relocation only.

- **Idle / Ready:** seam ring with soft glow (agent rail; §3). Ready/Away toggle restyled.
- **Connection dot → line beacon:** the existing `ConnectionDot` (today navy `bg-primary` when ok)
  recolors to **mint = up / grey = down**, and is **surfaced to the agent greeting hero** as the
  top-right beacon (mint solid / red flashing). Mechanism: lift the softphone `phase` into shared
  state (context or a small store) so the greeting island can read it; or render the beacon inside
  the softphone and mirror via the same shared signal. No logic change — purely reads the existing
  `phase`.
- **Incoming:** "Incoming call · {hotel}" with **Accept = mint**, **Decline = outline**.
- **In call:** the card gets a thin **seam edge** (= connected). Control row: **Mute = outline**,
  **Hang up = coral**. Room # + Notes inputs restyled (Stage 1 primitives).
- **Emergency — relocated + reworded:**
  - Removed from the Mute/Hang-up row. Placed **below the Room #/Notes**, separated by a hairline
    divider, as a full-width **solid-red "⚠ Call 911"** button (harder to fat-finger).
  - Existing hardcoded reds (`border-red-300 bg-red-50 text-red-700`, etc.) → `destructive` tokens.
  - **Confirmation `AlertDialog`** copy:
    - Title: **"Call emergency services (911)?"**
    - Body: *"This conferences 911 into the live call — the guest, you, and the dispatcher on one
      line — and logs a high-priority incident."*
    - Red warning block: *"Not life-threatening? Cancel and use the property's local non-emergency
      number instead. Only continue for a genuine emergency."*
    - Actions: **Cancel** (outline) · **"Yes — call 911"** (solid red).
  - Copy describes **only what happens today** (911 conference + incident row). The admin/owner/GM
    **notify** path is cut from v1; leave a clean seam (a clearly-marked extension point in the
    component + a one-line note in the dialog component) so the line can be added later without
    rework — do **not** render a promise of notifications that don't fire.

---

## 6. Video call overlay

Files: `components/video-call/{video-call,incoming-video-banner,playbook-panel}.tsx`. **Logic
untouched** (Agora join/publish/teardown, finalization, StrictMode guards) — chrome only.

- **Incoming video banner** (rail): repainted to match the softphone incoming state — video icon,
  **pulsing mint** dot, "Incoming video · {hotel}", **mint Accept**.
- **Active overlay** (`fixed inset-0` full-screen takeover):
  - **Header strip:** mint connected dot + "On video · {hotel}" + **mono timer**; seam hairline.
  - **Body split — 40% guest video / 60% playbook** (kept; playbook gets the room because the
    agent reads it while talking). Guest video on **`--color-call`** deep-navy; **self-view PiP**
    bottom-right with a **seam-gradient frame** (the connected motif).
  - **Playbook panel:** branded **loading skeleton** (shimmer lines; respects reduced-motion)
    while the signed URL + iframe load; on-brand empty + error states; keep the `sandbox`-less
    iframe (documented Chrome-PDF constraint — do not re-add `sandbox`).
  - **Control bar:** Room # + Notes (Stage 1 inputs) · **Mute** / **Cam** (outline) · **Hold** /
    **Swap** kept **greyed/disabled** ("coming soon" cut-feature stubs) · **End = coral**.
    **No red anywhere in video** (no 911 path in video).

---

## 7. Tables, detail pages, states

- **Tables** (`users-table`, `properties-table`, `audit-table`): uppercase muted-label headers
  (`font-label`), **zebra striping on dense tables** (audit log; any high-row-count list),
  **hairline rows** on the lighter tables (users, properties). Reuse the Stage 1 `Table` primitive.
- **Status pills** (filled, reuse owner `StatusPill` + `lib/owner/status-pill.ts` patterns):
  - Role: ADMIN / AGENT / OWNER.
  - User status: Active (mint) / Pending setup (coral) / Deactivated (muted).
  - Property: Active / Inactive. Call + incident statuses: reuse owner mappings.
- **Status page** (`app/(admin)/admin/status/status-card.tsx`): swap hardcoded
  `bg-emerald-500`/`bg-amber-500`/`bg-red-500`/`bg-muted-foreground` for tokens — **mint = healthy,
  coral = degraded, red = down**, muted = unknown.
- **Detail pages:**
  - Property detail (`app/(admin)/admin/properties/[id]/`): wrap **AssignmentCard** +
    **KioskLinkCard** in the **`SectionCard`** pattern (uppercase title + optional action slot);
    **PropertyForm**, invite/edit forms → Stage 1 `Input`/`Select`/`Textarea`/`Label`/`Switch`.
  - New property + back-links restyled.
- **Empty states:** dashed-border + icon + plain-spoken message (e.g. "No properties yet — add
  your first hotel.").
- **Loading states:** add/restyle `loading.tsx` skeletons for the admin tables + agent dashboard,
  mirroring the owner loading pattern (Stage 1 `Skeleton`).

---

## 8. Shared chrome

- **Seam hairline** under all agent + admin headers (the brand "connected" device; matches owner).
- **Sidebar** (`app-sidebar.tsx`, `nav-item.tsx`): active item = **coral** (`accent-strong`);
  hover/icon states tokenized. (Stage 1 already restored `--color-sidebar-*`.)
- **Agent header parity:** the agent header currently has a bare "Sign out" link; give it the
  shared **`UserMenu`** (initials, name/email/role, sign-out) for parity with admin/owner. Logo =
  home preserved.
- **User menu** (`user-menu.tsx`): initials badge + dropdown restyled to tokens.
- **Admin softphone bar:** background/border/padding tokenized.

---

## 9. Accessibility & motion

- Honor `prefers-reduced-motion`: disable the softphone glow rotation, the beacon flash (→ solid
  red), the incoming-banner pulse, and the playbook skeleton shimmer.
- Visible 2px focus ring + 2px offset on every interactive element (Stage 1 default).
- Status/role never conveyed by color alone (pills + dots carry text/labels).
- Keep existing ARIA on the connection dot; label the beacon ("line connected" / "line lost").
- Tabular numerals (JetBrains Mono) for all stats, timers, counts.

---

## 10. Component & file inventory

**Reused as-is (Stage 1 / owner):** all `components/ui/*`; `Wordmark`/`LogoMark`; owner
`StatTile`, `StatusPill`, `SectionCard`; `lib/owner/{format,status-pill}` patterns;
`packages/shared` `greetingForHour`.

**New (small, agent/admin):**
- Agent dashboard data helpers (pure, TDD) — today-count / avg-pickup / missed derivation;
  recent-calls shaping.
- Admin overview data helpers (pure, TDD) — agents-online / calls-today / open-incidents;
  per-property row assembly.
- A shared softphone-phase signal so the agent greeting beacon can read line status.
- (If needed) an `admin`-scoped status-pill mapping mirroring `lib/owner/status-pill.ts`.

**Repainted (chrome only):** agent `layout.tsx` + `page.tsx`; admin `page.tsx` +
`availability-cards.tsx`; `softphone.tsx`; `video-call.tsx` + `incoming-video-banner.tsx` +
`playbook-panel.tsx`; `users-table.tsx`, `properties-table.tsx`, `property-form.tsx`,
`assignment-card.tsx`, `kiosk-link-card.tsx`, `audit-table.tsx`, `status-card.tsx`;
`app-sidebar.tsx`, `nav-item.tsx`, `user-menu.tsx`; admin/agent page headers; new/updated
`loading.tsx` files.

---

## 11. Verification

- Gate: `lint + typecheck + test + build` (portal) green; new pure helpers unit-tested (TDD).
- Visual: eyeball agent dashboard (idle + audio in-call + line-down beacon), admin overview, a
  video call (incoming → overlay → playbook load), each admin table (incl. zebra audit), the
  status page, property detail, and the emergency dialog. Confirm reduced-motion disables all
  decorative motion.
- Confirm no hardcoded hex introduced; all color via tokens.

---

## 12. Open items (carry into the plan)

1. **kiosk-online read** — ✅ RESOLVED during planning: `/api/kiosk/heartbeat` is a no-op (no
   queryable per-property timestamp), so the admin **Kiosk column is dropped** for v1. (§4)
2. **Agent "Missed"** — ✅ RESOLVED: scoped to **covered-property `NO_ANSWER` calls today**
   (per-property tz), since `NO_ANSWER` calls carry no agent attribution. (§3, plan Task 5)
3. **Softphone phase sharing** — ✅ RESOLVED: a tiny **React context** (`lib/dashboard/line-status`)
   with a no-op default; the softphone reports its existing `phase`, the greeting beacon reads it.
   No call logic touched. (§5, plan Tasks 3–4, 7)
4. **Owner-component dependency** — ensure PR #15 (owner repaint) is merged before/under this work. (§1)
5. **Emergency-notify seam** — define the extension point shape so the admin/owner/GM alert drops
   in later without rework. (§5)
6. **Solitude W** — tracked separately; not addressed here. (§1)
