# UI/UX Polish — Staged Plan (start in a fresh chat)

**Created:** 2026-06-07 (session 7). **Status:** NOT STARTED — this is the plan to pick up
once smoke testing settles. Start it in a **fresh, low-context chat**.

## Context

v1 is functional and shipped to prod, but visually it's the **barebones shadcn skeleton** —
default components, no brand. This is the deliberate "put lipstick on it" pass. It was sequenced
*after* the readiness-audit remediation (10 PRs, all merged 2026-06-07) and is gated behind
finishing the pilot smoke test + squashing whatever testing surfaces.

## Locked constraints (don't relitigate — see CLAUDE.md)

- **Light mode only** (no dark mode in v1; `next-themes` was removed in the cleanup PR).
- **Mobile-responsive owner portal only**; agent/admin are desktop; **kiosk is a tablet** app.
- **No hardcoded hex** — everything goes through the Tailwind token layer / CSS custom properties.
- **shadcn** is the component base; polish at the token + primitive layer, not by forking components.

## Guiding principles (decided 2026-06-07)

1. **Don't let polish gate the pilot.** Functionality + reliability ship first.
2. **The foundation is logic-orthogonal.** Tokens + shadcn primitives propagate everywhere without
   touching route/business logic, so they're safe to do in parallel with bug-fixing — as their own PRs.
3. **Hold per-page redesign until pages stop moving** — don't repaint a page that testing is still changing.
4. **Prioritize polish by who sees it:** **Kiosk (guests) > Owner portal (client) > Agent/Admin (internal).**

## Prerequisite — lock the design direction FIRST

Before any styling: run a **brainstorm** to pin down brand feel, palette, typography, and voice, plus
the distinct treatment for the three surfaces (guest-facing kiosk vs. client owner-portal vs. internal
dashboards). Do **not** start painting until this is locked. (Product = after-hours outsourced hotel
front-desk; tone should read calm, trustworthy, professional; kiosk should feel friendly + large-touch.)

## Stages

### Stage 0 — Direction & brand (decision, little/no code)
- Brand feel, color palette, type pairing, spacing/radius/shadow scale, motion stance, UX voice.
- Per-surface art direction: kiosk (guest), owner portal (client, mobile-first), agent/admin (operational).
- Output: a short design-direction doc + token values to apply in Stage 1.

### Stage 1 — Foundation (parallel-safe, own PR(s))
- Theme tokens: color, typography scale, spacing, radii, shadows, focus rings.
- Polish the shared shadcn primitives: Button, Card, Input/Textarea, Badge, Table, Dialog/AlertDialog,
  DropdownMenu, Toast/sonner, Skeleton. (These lift the whole app at once.)
- Logo / wordmark wiring (logo = home, per locked nav decision).

### Stage 2 — Per-surface polish (after smoke-test freeze), in audience priority
1. **Kiosk** (`apps/kiosk`) — guest-facing screens (Home, Ringing, Connected, Apology, RecordingNotice);
   large-touch, friendly, distinct from the portal. Highest ROI.
2. **Owner portal** (`app/(owner)`) — mobile-first; Home glance cards, call/incident views, property detail.
   Make it feel premium/trustworthy for the client.
3. **Agent/Admin** (`app/(agent)`, `app/(admin)`) — operational polish: dashboard glanceability, softphone,
   video overlay, tables, audit/status. Function over flair; do last.

### Stage 3 — States, motion, a11y, copy
- Empty / loading / error states (skeletons already exist; make them on-brand).
- Tasteful micro-motion; honor `prefers-reduced-motion`.
- Accessibility pass (contrast, focus order, touch targets — esp. kiosk).
- UX copy polish (error messages, empty states, the emergency/dispatch-failure banner wording).

## Working notes

- Each stage ships as its own PR(s) off `main`, verified `lint + typecheck + test + build`, per the
  established workflow. Foundation PRs can land while testing continues; Stage 2+ waits for the page set
  to freeze.
- There are design skills available (frontend-design, ui-ux-pro-max, brandkit, etc.) — use them in the
  fresh chat after the direction is locked.

## How to start the fresh chat

> "Let's start the UI/UX polish — Stage 0. Read `docs/plans/2026-06-07-ui-ux-polish-stages.md`, then
> brainstorm the design direction before any code."
