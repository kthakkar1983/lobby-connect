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

## Operating model — how it actually works

Lobby Connect sells **outsourced night-shift front-desk agents**, not just a kiosk. The guest-facing
kiosk/phone is one half; the other half is that each agent **remotes into the hotel's own PC
(RustDesk) and does the real front-desk work** — checks guests in, creates/modifies reservations,
runs the night audit.

**Why remote-desktop (load-bearing, not a crutch):** all sensitive work — credit cards, guest PII,
the PMS — stays **on the hotel's machine**. Lobby Connect never handles cardholder data, so it stays
**out of PCI-DSS scope** and clear of payment-processing law. Do **not** design toward pulling
PMS/payments into Lobby Connect — that would break the firewall the whole model is built on.

**Pod model — dedicated virtual employees:** Lobby Connect staffs hotels with *virtual employees*,
not an anonymous call center. One agent **owns** a **pod of ~5 properties** and stays with them — the
**same couple of faces** week to week, so owners and guests get a familiar, dedicated front desk. This
maps onto the persistent per-property primary-agent assignment (one agent is primary on several
properties). Ringing/routing is per-property; the agent's attention is split across the pod.

**Overflow is human-coordinated, not automated:** a small, consistent bench of **admins** floats as
backup — they flip a `covering` toggle on/off **by hand**, reactively, when a pod is busy or an agent
steps away (break, restroom, last-minute emergency). No fixed admin↔pod assignment, and **no
auto-widening of the answer pool** — internal SOPs plus live agent/admin communication handle the
away/emergency case. At launch, Twilio concurrency is raised so the already-built parallel dial
(primary agent + covering admins) can actually place multiple legs. If every eligible human is busy,
the extra call gets the apology (no queue / hold / voicemail in v1) — an accepted rare tail, since the
cases that matter are pre-coordinated by SOP.

**Runtime reality:** the agent's foreground app is the **remote session into the hotel PC**; the
Lobby Connect portal sits in the **background**. Two consequences: (1) call alerting must be
**OS-level / persistent** — an in-tab ring is invisible to an agent driving a full-screen remote
session; (2) the emerging direction (a pilot finding) is to **integrate the remote session into the
agent dashboard** rather than keep it a separate program, since agents juggling ~5 properties need it
streamlined. Integration approach is TBD.

**Remote-desktop tooling:** RustDesk today (the one trained agent is comfortable with it). Pilot uses
the public/free relay; the target is a **self-hosted relay on a VPS** (no public servers — for speed
and security). Selection criteria: free / open-source + self-hostable on a VPS. Not finally locked.

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
