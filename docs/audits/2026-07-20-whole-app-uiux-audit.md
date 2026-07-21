# Whole-App UI/UX Audit — Lobby Connect (2026-07-20)

**Method:** 6 parallel design-review agents (one per surface cluster), each grounded in the source and measured against the locked brand system (`docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/brand/brand-guidelines.md`) and the impeccable design laws, plus live computed-style probes on the deployed app. Register = **product** (design serves the task).
**Scope:** whole app — design-system spine, agent+admin dashboards, all call surfaces, admin CRUD, owner portal, auth + kiosk.
**Status of the on-duty/in-call surfaces:** shift-card buttons and the in-call bars were audited from code; final geometry to be confirmed in a coordinated live session (Kumar toggles duty + places test calls).

---

## Verdict

**No P0. Nothing is broken or launch-blocking.** The foundation is genuinely strong and worth protecting: token discipline is near-flawless (zero improper hardcoded hex app-wide), there's a universal `prefers-reduced-motion` net, contrast is math-verified (`lib/theme/contrast.ts`), destructive flows are careful (typed confirmation + audit-before-delete), and the `CallShell` extraction is clean architecture with drift-prevention baked in.

**The work is reconciliation, not redesign.** Every one of the 6 agents independently converged on the same root cause: **the shared primitive set is incomplete, so call-sites improvise, and the improvisations drift.** That is why your two button complaints are real *and* why they're everywhere — they're not one-offs, they're a missing affordance surfacing at dozens of call-sites. Fix the spine once and the drift stops app-wide.

Rough tally: ~8 systemic themes (below), 4 factual defects, and a pile of consolidation debt. Almost all of it is centrally fixable.

---

## Health snapshot

| Surface | What's strong | Sharpest gaps |
|---|---|---|
| Design-system spine | token/motion/contrast foundation, empty/error states | no equal-width / Toggle / Tabs primitives; base icon > label |
| Agent + admin dashboards | KPI tiles resist hero-metric trap; property-card anti-shift craft | column dead-space; unlabeled Covering switch; team-on-now color-only |
| Call surfaces | CallShell architecture; bar-order unification landed | icon-to-label ratio; tile bar 3 heights; no focus ring on 911 |
| Admin CRUD | consistent form controls; careful deletes; skeletons | status pills reinvented 3×; status page color-only; "Capped 12h" wrong |
| Owner portal | glance layout; teaching empty states | sub-44px touch targets; color-alone bottom nav; safe-area |
| Auth + kiosk | split login; sign-in error UX; kiosk Home | auth forms bypass shared Button/Input; reduced-motion line stubs |

**Nielsen heuristics (whole-app, honest):** Consistency & standards **2/4** (the dominant weakness — parallel vocabularies for buttons, pills, tabs, fields). Aesthetic & minimalist **3/4**. Visibility of status **3/4** (weak spot: color-alone signals). Error prevention/recovery **3/4** (careful deletes, honest notes-retry). Match real-world **3/4** (one factual miss: "Capped 12h"). Accessibility as a cross-cut is the other soft area (focus rings on hand-rolled controls, color-alone status, sub-44px mobile targets). Everything else 3+.

---

## Cross-cutting themes (fix once, benefit everywhere — ordered by leverage)

### Theme A — Complete the shared primitive set (root of most drift) · P1
The system lacks affordances that call-sites then hand-roll inconsistently:
- **No equal-width / button-group affordance.** `Button` is content-sized, so adjacent pairs drift: property-card Connect 106px / Kiosk 85px, Answer/Silence, in-call toggles at 112/112/**144**px, kiosk CallControls. Some sites hardcode `w-28`, some rebuild `grid-cols-2`; `property-action-button.tsx:227-232` literally punts width to the call-site in a comment. → Add a `ButtonGroup` (or `block`/`equalWidth` modifier) and one equal-width recipe.
- **No shared `Toggle` / `Tabs`.** In-call toggles are hand-rolled (`call-controls.tsx:159-209`), kept "in sync by hand" with `caption-toggle.tsx`; Playbook⇄Chat / Video⇄Chat / call-filter "tabs" are plain buttons with no `role=tab`. → Add `ui/toggle.tsx` + `ui/tabs.tsx` (Radix, token-skinned); migrate.
- **Status pills reinvented 3×:** shared `Badge` (audit, shifts) vs hand-rolled spans (`properties-table.tsx:107`, `users-table.tsx:540`) vs `owner/status-pill.tsx`. → One `StatusBadge` on `Badge`.
- **Auth forms bypass the system entirely** (Theme below).
- **Redefined helpers:** `Field` ×3 (`call-detail-body.tsx:24`, `incidents/[id]/page.tsx:13`, `properties/[id]/page.tsx:17`); the 911 tag ×2; the uppercase table-header label copy-pasted 5–9× per table with drifted tracking. → Promote shared versions + one label token.

### Theme B — Icon-to-label size ratio (your "icon looks bigger / bottom-aligned" complaint) · P1
Confirmed **not** a vertical-alignment bug in the portal — every in-call and card control is `items-center` (grep-verified). The perception is a real *size* mismatch: `button.tsx:8` sets icons to `size-4` = **18px** at the desktop 112.5% root, next to `text-sm` ≈ **15.75px** labels, and the `sm` size (`button.tsx:32`) doesn't override it. A larger glyph beside smaller text reads as "icon dominates, text rides low." Hits Mute/Camera/End/Connect and every card button.
- **Fix (one line):** add `[&_svg:not([class*='size-'])]:size-3.5` to the `sm` size in `button.tsx:32` (and reconsider the base default). 14px icon ↔ 14px label.
- **Within-bar inconsistency too:** overlay Captions icon is a fixed 16px (`caption-toggle.tsx:68`) next to 18px neighbors; the tile mixes 12/13px. → Drive bar icons off one token per surface.
- **The one literal bottom-anchor anywhere is the kiosk** `CallControls.tsx` pill (`items-end`, spec §8). If the button you saw was on the tablet, that's a real alignment bug; if on the desktop portal, it's the size ratio. **Live session confirms which.**

### Theme C — Raleway (display font) is quietly absent · P1/P2
Brand says "Raleway for headings, weight ≥500," but `CardTitle`/`DialogTitle`/`SheetTitle`/`AlertDialogTitle`/`EmptyState`/`ErrorState` titles all default to Outfit (`font-sans`), and every **owner page h1** is `font-display` with **no weight class** → Tailwind Preflight resets it to 400 and Raleway "runs light at small sizes" (`fonts.ts:21` warns exactly this). Auth headings are split too (sign-in uses display, forgot/onboarding/update don't). Net: the Raleway/Outfit hierarchy the brand defines collapses to Outfit wherever a page author forgets. → **Decide the rule and encode it in the primitives** (title slots get `font-display font-semibold`) or amend the brand doc. Today it's inconsistent-by-omission.

### Theme D — Color-alone status signals · P1 (a11y)
Status is carried by color with no text/icon alternative in several places, some below the 3:1 non-text floor:
- **Team-on-now** presence dot is `aria-hidden` with no text; AWAY and BREAK are the *same* grey; OFFLINE `bg-border` ≈ 1.2:1 on white (`admin/page.tsx:351`, `lib/owner/format.ts:38`). The fleet-board header does this right (dot **+** `dutyLabel`) — reuse it.
- **Status page** health is mint-vs-blaze dot only, no ok/warn/down word (`status-card.tsx:24`).
- **Owner bottom-nav** active tab = teal text only, same weight/icon (`owner-nav.tsx:53`); the desktop nav already adds a `bg-accent/10` fill — copy it.
- Kiosk-status dot (`property-card.tsx:110`) and chart bars are color+title only.
→ Pair every status color with a label/icon; strengthen dot contrast.

### Theme E — Missing / inconsistent focus rings · P1 (a11y)
The brand ring (`focus-visible:ring-2 ring-ring`) is on shared `Button`/`Input` but **absent on hand-rolled controls — including both 911 buttons** (`audio-call-overlay.tsx:189`, `call-tile.tsx:229`), tile Mute/End/Video-Chat, `CaptionToggle`, softphone Accepting/Go-on-duty, auth submit buttons, owner CallRow/IncidentRow/card links, recent-call expand, and the password show/hide toggle. Dialog/Sheet close buttons use `focus:` not `focus-visible:` (ring on mouse click). A keyboard-reachable **life-safety** control with no visible focus is the highest-value item here. → Normalize on `focus-visible` + the brand ring; extend to every hand-rolled control.

### Theme F — Em dashes in user-facing copy · P2 (house-style decision)
Pervasive across every surface (sign-in-adjacent, kiosk `copy.ts:12,31`, 911 dialog `audio-call-overlay.tsx:198`, connect errors `connect-error.ts:60-65`, owner actions, dashboard `shift-card.tsx:92`, global error `lib/copy.ts:59`, and more). The brand bans `—`/`--`. Because it's this widespread it's **one decision**, not N fixes: purge to periods/colons (recommended, mechanical) or lift the rule. *Note:* the standalone `"—"` empty-value placeholder for null cells is a separate valid convention — leave those.

### Theme G — Side-stripe accent borders vs your own absolute ban · P2 (decision)
`border-l-2 border-l-attention` / `border-l-live` used as status edges on owner surfaces: `incident-row.tsx:25`, `property-overview.tsx:49` (the coverage strip edge is the **only** signal → effectively color-alone), `owner/page.tsx:258`. These read as intentional brand "status edges" but violate the stated ban. → Either officially lift the ban (document it) or replace with a labeled indicator/Badge. (The `account-menu.tsx:84` dashed border is a ticket-stub perforation, not an accent stripe — fine.)

### Theme H — Consolidation & layout debt · P2/P3
Same job, many shapes:
- **CRUD shapes:** properties = full pages, users = **Dialog (create) + Sheet (edit)** for one entity, shifts = Dialogs. Unify (users split is the sharpest).
- **Container width/padding:** audit/status/shifts each add their own `max-w-*` + `p-6` on top of the workspace's `p-6` (double-padded, 3 different max widths); properties/users/calls are full-bleed. Pick one.
- **Radius drift:** `rounded-lg` vs `rounded-card` (even within one table depending on rows), `rounded-2xl` auth card, stock `rounded-md/sm/xs` inside primitives (tooltip/dialog/select). Use the 4 brand radius tokens.
- **Nested cards** (absolute-ban-adjacent): owner Home + property detail wrap `CallRow` (itself a card) in a `Card` → white-on-white. The Calls list uses a plain flex container and reads cleaner — match it.
- **Pagination reinvented:** calls uses `Button` keyset controls; audit hand-rolls a raw text button + a native `<details><pre>{JSON}</pre>`.
- Loading skeletons generic/identical (properties/users/audit byte-identical) or missing (shifts/status).

---

## Factual defects (just wrong, not taste)

1. **"Capped 12h" — the cap is 10h.** `shifts-table.tsx:136` ("Capped 12h") and `:648` ("the 12h cap") vs `MAX_SHIFT_MS = 10h` (`protocol.ts:103`). An admin reads the wrong policy number. → Change both strings to 10h (or derive from the constant). *Verified.*
2. **`/forgot-password` promises an email that can't send.** The action always returns `success: true` (`forgot-password/actions.ts:28`) and the page says "you'll receive a reset link shortly," but SMTP is not wired (auth is admin-provisioned). Sign-in doesn't link to it (low exposure) but a bookmarked URL yields a false promise. It also has **two differently-styled "Back to sign in" links** (navy vs muted; links should be teal). → Reword to "contact your administrator," or gate the page. *Verified always-success.*
3. **Kiosk recording note may be false + low-contrast.** "Calls may be recorded for quality" (`Ringing.tsx:46`) renders ~4.1:1 (below AA) — and CLAUDE.md records recording was **removed in v1**. Telling guests calls "may be recorded" when they aren't is a trust problem. → Confirm v1 behavior; drop/reword, and raise contrast if kept.
4. **Users table shows raw DB enums.** The Presence column prints `ON_CALL` / `AVAILABLE` (caps + underscore, grey, no pill) while the Status column one cell left uses pills; the table also has no zebra and no title-casing (a `titleCase` helper already exists in the sibling shifts table). → Humanize + pill + zebra.

**Dead code to remove:** `dashboard/line-beacon.tsx` + `dashboard/greeting-line.tsx` are never rendered, yet `LineStatusProvider` is still mounted and the softphone reports phase into it (`softphone.tsx:273`); `CallControlTray` (`call-controls.tsx:74`) is dead after the bar reorder. **Housekeeping:** 16 untracked `" 2.tsx/.ts"` duplicates — `call/call-shell 2.tsx` is a byte-copy whose docstring still describes the *old* `ml-auto` tray layout, a live "edit the wrong file / trust stale comments" hazard. → `git clean -n` then remove.

---

## The dashboard right column (the standing open item)

**Recommended: make the aside a sticky operator-status rail** — `lg:self-start lg:sticky lg:top-6` on the aside (the grid already sets `items-start`; the workspace has no overflow clip, so it works). This is categorically different from the two failed attempts (mt-auto stretch → overshot to page bottom; natural stack → trails awkwardly), both of which tried to make a *shorter* column *reach* a taller one.

Why it's the right call:
- The ~550px "dead space" only exists at scroll-top. The moment the admin scrolls the fleet board, a sticky rail occupies the top-right the whole way down — the softphone / go-on-duty ring / live shift clock stay on screen exactly when she's deep in the board. A real usability win, not cosmetic.
- **Robust:** no dependency on left-column height, so it can't overshoot or trail. Data-length changes can't break it.
- The residual whitespace below the clocks at scroll-top reads as intentional (like GitHub/Gmail right rails), which is the honest answer the CSS nudges were avoiding.

Optional complement: the gradient header band is `min-h-[11rem]` (176px) carrying only a one-line greeting — populate it with a compact at-a-glance strip, which fills it *and* lets the aside shrink; the sticky rail makes a shorter aside a non-problem. Ship the sticky rail alone first (low-risk, moves no content).

---

## Director decisions needed (these shape the fix plan)

1. **Em dashes** — purge app-wide to periods/colons (recommended), or lift the rule?
2. **Side-stripe status borders** — lift the absolute ban officially, or replace the owner status edges with labeled indicators?
3. **Raleway headings** — enforce `font-display font-semibold` on card/dialog/page titles, or accept Outfit and amend the brand doc?
4. **Column** — approve the sticky operator-status rail?
5. **Incident color** — settle one tint (`/10` vs `/15`), and decide whether the incident-detail header's blaze-siren + red-911-chip double-encoding is intentional.
6. **End-call isolation** — overlays use a 1px divider before End call, the tile uses whitespace. Pick one language.

---

## Proposed fix batches (sequenced for the Aug 1 window)

1. **Spine completion** (`$impeccable extract` / `layout`): equal-width/ButtonGroup, base+sm icon size (`button.tsx`), `Toggle` + `Tabs` primitives, `StatusBadge`, shared `Field` + label token. *Unblocks Themes A, B, and most consistency debt at the source.*
2. **Accessibility pass** (`$impeccable audit` → fixes): focus rings on all hand-rolled controls incl. both 911 buttons; color-alone status → add labels (team-on-now, status page, bottom-nav, kiosk dot); owner sub-44px touch targets + notch safe-area; reduced-motion FloatingPaths stubs (render full static lines).
3. **Dashboard layout** (`$impeccable layout`): the sticky operator-status rail + optional header-band strip; unlabeled Covering switch → visible label.
4. **Copy & factual** (`$impeccable clarify`): em-dash decision executed; "Capped 12h"→10h; forgot-password reword; kiosk recording note; users-table enum humanization.
5. **Consolidation & housekeeping** (`$impeccable distill`): unify CRUD shapes + container/radius conventions, flatten nested cards, standardize pagination; delete dead code + the 16 ` 2.tsx` dupes.
6. **`$impeccable polish`** final pass, then re-run this audit to confirm the score moves.

Batch 1 is the highest leverage — it dissolves the button-width, icon-size, and hand-rolled-control families at once. Batches 2–4 are the launch-bar items. Batch 5 is debt that a small shared-component pass clears.
