# PRODUCT.md — Lobby Connect

> Impeccable design context. The deep source of truth for the visual system is
> [`docs/brand/brand-guidelines.md`](brand/brand-guidelines.md) (logo / color / type / shape — all
> ✅ Locked). This file is the product + brand framing; [`docs/DESIGN.md`](DESIGN.md) is the
> token/component reference.

## Register

**product** — Lobby Connect is operational software (agent / admin / owner dashboards + a guest
kiosk). Design *serves* the task: fast, calm, legible, trustworthy. It is not a marketing surface.

## What it is

After-hours outsourced front-desk for hotels. A guest taps a lobby tablet (kiosk) and a real
person — a remote agent — answers by phone or video. Phone routing (Twilio) + tablet video (Agora) +
a portal where agents take calls, admins manage properties/users, and owners watch their hotels.
v1 = a single-hotel pilot. Single-tenant now, multi-tenant-ready.

## Users & surfaces

- **Agent** — takes inbound calls/video on a desktop dashboard + softphone. Glanceable line status,
  low cognitive load, calm under pressure. (Desktop.)
- **Admin** — manages agents, properties, assignments, call availability; audit + status. (Desktop.)
- **Owner** — hotel owner/manager checking presence, call history, incidents. (Mobile-first.)
- **Guest (kiosk)** — a hotel guest at a lobby tablet, often late, sometimes stressed. Big targets,
  one obvious action ("talk to the front desk"). The hotel's name leads; **no Lobby Connect logo**.

## Brand thesis

**A real person reached through a screen** — warm human hospitality on one side, calm dependable
technology on the other. The brand lives in the *connection* between them. Signature motif = the
**seam**: a thin navy→teal→mint gradient hairline/ring (line/ring only, never a fill).

## Tone

Calm, trustworthy, professional, quietly warm. Never loud, cute, or alarmist. Confidence through
clarity and restraint, not decoration. Errors never blame the user; emergencies are plain and direct
("Calling 911. Stay on the line.").

## Strategic principles

- **Color carries meaning, never decoration:** mint = connect/live/primary action; teal =
  links/navigation; blaze = needs-attention; red = 911/destructive only. Color is never the only
  signal — always pair with icon/label.
- **Light mode only** in v1; dark mode is a deferred seam.
- **Forward-compatible:** leave clean seams; don't build pilot-only dead-ends.
- **No hardcoded hex** — everything routes through tokens (see DESIGN.md).

## Anti-references (what to avoid)

- Generic SaaS-dashboard sameness — flat card grids, the hero-metric template. The current
  dashboards read "flat and uninspiring"; the layout phase exists to fix that with real depth and
  hierarchy, not a re-skin.
- Alarmist or loud incident/emergency styling (red everywhere). Red is reserved.
- Anything that makes a stressed late-night guest hesitate at the kiosk.
