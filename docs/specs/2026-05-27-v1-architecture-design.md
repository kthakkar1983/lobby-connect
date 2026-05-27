# Lobby Connect — v1 Architecture Design

**Status**: Approved 2026-05-27
**Authors**: Kumar Thakkar + Claude
**Supersedes**: All Lobby Direct (Convex-stack) specs under `_archive/lobby-direct-webapp/`

---

## 1. Overview

Lobby Connect is an after-hours outsourced front-desk service for hotels, delivered through two surfaces:

- **Audio**: Guests call a property-specific phone number. Calls route through Twilio to a remote agent's browser-based softphone.
- **Video**: A tablet in the property lobby (kiosk) lets guests start a video session with the same agent pool via Agora.

This spec defines the v1 build — the pilot configuration that will go live with one hotel end-to-end. Future-state options (multi-tenant SaaS, marketplace, white-label) are explicitly preserved by architecture but not built in v1.

This is a solo build (one developer + AI assistance), pre-revenue, no hard deadline. The goal of v1 is to validate the service with a single hotel and earn the right to expand from there.

---

## 2. Locked Decisions (Cheat Sheet)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Stack: Next.js (portal) + Vite (kiosk) on Vercel; Supabase Postgres + Auth + Storage; Twilio voice; Agora video; Sentry errors; shadcn + Tailwind UI** | Replaces previous Convex-based stack. Eliminates the V8 bundler problem that blocked Node.js SDKs (Twilio, future Deepgram/PagerDuty). Standard, well-documented ecosystem. |
| 2 | **Single Next.js app for all three portal personas (agent + admin + owner), with route groups for role-specific UI** | Shared auth, DB, components. Preserves future SaaS pivot where a single user wears multiple hats. |
| 3 | **Repo: new GitHub repo `lobby-connect-webapp`; old `lobby-direct-webapp` archived read-only** | Clean mental separation. No risk of accidentally editing old code. |
| 4 | **Folder: `~/Documents/Claude/Projects/Lobby Connect/` with `apps/portal`, `apps/kiosk`, `packages/{shared,ui}`, `supabase/`, `docs/`, `memory/`** | Token-efficient layout. Auto-loaded `CLAUDE.md` is tight (<150 lines). |
| 5 | **Auth: Supabase Auth, email + password only, invite-only (no public signup), RLS on every table, Next.js middleware server-side gate** | Mature, battle-tested. The Vite-SPA race conditions Kumar hit in past projects don't apply to Next.js's `@supabase/ssr` cookie-based flow. |
| 6 | **Routing: parallel-dial pattern. Twilio rings primary agent + all admins with `accepting_calls=true` simultaneously for 120s. First answers wins. 120s timeout → apology TwiML + hangup. No voicemail.** | Simplest possible logic. No status branching that can drift. Mirrors the kiosk's locked 120s timer for cross-surface UX consistency. |
| 7 | **Roles: `AGENT`, `ADMIN`, `OWNER` only. Stored as `text` + `CHECK` constraint, not Postgres enum** | OPS merged into ADMIN for v1 (no ops dashboard). Text+check is cheaper to extend than `ALTER TYPE`. |
| 8 | **Realtime: 20s polling + refetch-on-tab-focus + optimistic mutations. No Supabase Realtime subscriptions in v1.** | Predictable, easy to debug, low cost. Focus-refetch makes 20s feel like ~5s for the events that matter. |
| 9 | **UI: light mode only across every surface; collapsed icon-sidebar with hover-expand on desktop/iPad (no labels on mobile); logo = home link; 10s skeleton timeout before error state** | Halves design-system + component-test surface. 10s accommodates real-world hotel WiFi and intercontinental users. |
| 10 | **Multi-tenancy: every top-level table carries `operator_id`. v1 has one operator ("Lobby Connect"). v2 adds query-layer filter to unlock SaaS — no destructive migration.** | "Path C" from v3.1 lockings, carried forward. |
| 11 | **Observability: Sentry + Vercel Analytics + Vercel Logs + Supabase Logs + admin-only `/status` page + admin-only `/audit` log** | Layered. Sentry catches application errors; Vercel covers infra; `/status` is the operator's at-a-glance health screen. |
| 12 | **Domain: Vercel-provided URLs for v1 (`lobby-connect-portal.vercel.app`, `lobby-connect-kiosk.vercel.app`). Custom domain deferred — connect anytime later with zero migration.** | Cheap to start, no DNS coordination needed for pilot. |
| 13 | **Mobile responsive: owner portal mobile-first. Agent + admin portals desktop-first (1024px+). Kiosk fixed to tablet target.** | Owners glance from phones. Agents/admins are at a desk. Kiosk runs in landscape per property. |
| 14 | **Forward-compat: all cut features (voicemail, PagerDuty, ops, MFA, transcription, backup ringing, magic link, multi-tenant SaaS) have schema columns or code-structure hooks reserved. None require destructive migration.** | Add-later cost minimized. Removes the "design corner" risk. |

---

## 3. Stack & Deployment Topology

### What runs where

```
┌──────────────────────────────────────────────────────────────────┐
│                        VERCEL                                    │
│                                                                  │
│  ┌────────────────────────┐      ┌────────────────────────┐    │
│  │  apps/portal           │      │  apps/kiosk            │    │
│  │  Next.js (App Router)  │      │  Vite SPA              │    │
│  │  ───────────────────   │      │  ───────────────────   │    │
│  │  · Agent dashboard     │      │  · Tablet-locked UI    │    │
│  │  · Admin dashboard     │      │  · Agora WebRTC client │    │
│  │  · Owner portal        │      │  · No auth (public)    │    │
│  │  · API routes for      │      │  · Calls portal API    │    │
│  │    Twilio webhooks     │      │    only                │    │
│  │  · API routes for      │      │                        │    │
│  │    Agora tokens        │      │  → lobby-connect-      │    │
│  │  · API routes for      │      │    kiosk.vercel.app    │    │
│  │    cron jobs           │      │                        │    │
│  │  · Middleware: auth    │      │                        │    │
│  │                        │      │                        │    │
│  │  → lobby-connect-      │      │                        │    │
│  │    portal.vercel.app   │      │                        │    │
│  └────────────┬───────────┘      └────────────┬───────────┘    │
└───────────────┼─────────────────────────────────┼──────────────┘
                │                                 │
                ▼                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SUPABASE (managed)                          │
│  ┌────────────────────┐  ┌─────────────────┐  ┌───────────────┐ │
│  │  Postgres          │  │  Auth           │  │  Storage      │ │
│  │  · All tables      │  │  · Email/pwd    │  │  · Playbook   │ │
│  │  · RLS policies    │  │  · Sessions     │  │    PDFs       │ │
│  │  · Migrations      │  │  · Invitations  │  │  · Property   │ │
│  │  · Indexes         │  │  · Pwd reset    │  │    logos      │ │
│  └────────────────────┘  └─────────────────┘  └───────────────┘ │
└──────────────────────────────────────────────────────────────────┘

         External services (called from Next.js API routes)
         ┌────────────┐  ┌────────────┐  ┌────────────┐
         │  Twilio    │  │  Agora     │  │  Sentry    │
         │  · Voice   │  │  · Video   │  │  · Errors  │
         │  · Webhks  │  │  · Tokens  │  │  · Perf    │
         └────────────┘  └────────────┘  └────────────┘
```

### How a typical request flows

**Agent loads dashboard (most common path):**
1. Browser → Vercel hits `app/(portal)/agent/page.tsx`
2. Next.js middleware checks Supabase auth cookie. No session → redirect to `/sign-in`.
3. Server Component fetches agent profile + assigned properties + recent calls in a single round trip to Supabase using the server-side client. RLS scopes everything by `auth.uid()`.
4. HTML streams to browser with data pre-rendered. No client-side auth flash.
5. Client component takes over: requests Twilio access token from `/api/twilio/token`, registers Twilio Device, starts 20s polling for data freshness.

**Twilio call arrives (the critical path):**
1. Twilio POSTs to `https://lobby-connect-portal.vercel.app/api/twilio/voice/incoming`
2. Next.js route handler verifies HMAC signature using the real Twilio Node SDK. (Node.js works natively on Vercel Functions — no workarounds.)
3. Handler queries Supabase for the property by `routing_did`, the primary agent assignment, and any admins with `accepting_calls=true`.
4. Builds `<Dial>` TwiML with all targets as `<Client>` children + 120s timeout.
5. Returns TwiML to Twilio.
6. Twilio simultaneously rings each `<Client>` identity (Twilio Device on agent/admin browsers).
7. First to answer wins; others stop ringing. 120s expiry → `/api/twilio/voice/dial-result` returns apology TwiML.

**Kiosk video call (parallel path):**
1. Guest taps tile on kiosk K-01 → kiosk calls portal `/api/agora/token` for channel token (1hr expiry).
2. Kiosk joins Agora channel + POSTs `/api/kiosk/call-started` so portal records the call.
3. Portal admins/agents receive "incoming video call" notification (via 20s polling tick + Agora "remote user joined" SDK event).
4. Someone accepts → joins channel; video flows.
5. 120s no-accept → kiosk shows K-08 apology overlay 10s → returns to K-01 home. Portal POSTs `/api/kiosk/call-ended`, call state → `NO_ANSWER`.

### Why this topology

- One Vercel account, one Supabase project, one Twilio account, one Agora account. Simple administrative mental model.
- Twilio webhooks live in `apps/portal/app/api/twilio/...` — same codebase as the UI. No separate Edge Functions, no two backend mental models. Resolves the Convex bundler problem.
- Supabase is *only* the database + auth + storage — not a compute layer. All business logic lives in Next.js. Easier to reason about, easier to test locally (`npx supabase start`), easier to debug.
- Kiosk has no backend of its own. It calls portal API routes for everything. Preserves the "kiosk → portal API boundary" as a stable contract; kiosk remains portable as a v2 standalone product.

### Cost expectations at pilot scale

| Service | Tier | Expected v1 cost |
|---|---|---|
| Vercel | Hobby (free) | $0 |
| Supabase | Free (500MB DB, 50k MAU, 5GB bandwidth) | $0 |
| Twilio | Pay-as-you-go | ~$1/mo per phone number + $0.013/min calls + $0.0085/min client-to-client → **~$5–20/mo** |
| Agora | Free tier (10,000 video min/mo) | $0 for pilot |
| Sentry | Developer (free, 5k errors/mo) | $0 |
| **Total** | — | **~$10–30/mo**, almost entirely Twilio minutes |

---

## 4. Repository Layout

```
Lobby Connect/
├── README.md                                ← public-facing
├── CLAUDE.md                                ← AUTO-LOADED. <150 lines.
├── MEMORY.md                                ← INDEX of detail memories
├── .env.example
├── .gitignore
├── package.json                             ← pnpm workspace root
├── pnpm-workspace.yaml
├── vercel.ts                                ← project config (replaces vercel.json)
│
├── apps/
│   ├── portal/                              ← Next.js 15 + App Router
│   │   ├── middleware.ts                    ← auth gate (project root, NOT inside app/)
│   │   ├── app/
│   │   │   ├── globals.css                  ← Tailwind base + design tokens
│   │   │   ├── (auth)/                      ← sign-in, onboarding (light-pinned)
│   │   │   ├── (agent)/                     ← agent dashboard route group
│   │   │   ├── (admin)/                     ← admin route group
│   │   │   │   ├── status/page.tsx          ← admin-only health screen
│   │   │   │   └── audit/page.tsx           ← admin-only audit log viewer
│   │   │   ├── (owner)/                     ← owner portal (mobile-first)
│   │   │   └── api/
│   │   │       ├── twilio/voice/{incoming,dial-result,status,recording-status}/route.ts
│   │   │       ├── twilio/token/route.ts
│   │   │       ├── agora/token/route.ts
│   │   │       ├── kiosk/{call-started,call-ended,heartbeat}/route.ts
│   │   │       └── cron/mark-stale-offline/route.ts
│   │   ├── components/                      ← shared portal components
│   │   ├── lib/                             ← portal-local helpers
│   │   └── tests/
│   │
│   └── kiosk/                               ← Vite SPA
│       ├── src/
│       │   ├── App.tsx
│       │   ├── screens/{K01,K02,K03,K04,K08}.tsx
│       │   ├── lib/agora.ts
│       │   └── lib/portal-api.ts            ← all calls go through portal API
│       └── tests/
│
├── packages/
│   ├── shared/                              ← types, constants used by both apps
│   │   ├── src/types.ts                     ← Role, CallState, etc.
│   │   ├── src/constants.ts
│   │   └── src/supabase-types.ts            ← generated from DB
│   └── ui/                                  ← shadcn primitives reused across apps
│       └── src/components/
│
├── supabase/
│   ├── migrations/                          ← versioned SQL files
│   │   ├── 0001_init.sql
│   │   ├── 0002_rls.sql
│   │   └── ...
│   ├── seed.sql                             ← idempotent local dev seed
│   └── functions/                           ← Supabase Edge Functions (likely empty in v1)
│
├── docs/
│   ├── specs/                               ← design specs
│   │   └── 2026-05-27-v1-architecture-design.md   ← THIS FILE
│   ├── plans/                               ← implementation plans
│   ├── decisions/                           ← ADRs
│   └── wireframes/                          ← HTML wireframes
│
└── memory/                                  ← detail memory files referenced by MEMORY.md
```

---

## 5. Database Schema

**7 tables.** All have `operator_id` for forward-compat multi-tenancy. All enum-like fields stored as `text` + `CHECK` constraint, not Postgres `ENUM` types (cheaper to extend).

### 5.1 `operators`

Multi-tenant root. v1 has exactly one row.

```sql
create table operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz default now() not null
);
```

### 5.2 `profiles`

1:1 with `auth.users`. Single "users" table. Replaces separate `agents` + `staff_users` tables from the previous design — role determines behavior, not table location.

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  operator_id uuid references operators(id) not null,
  role text not null check (role in ('AGENT', 'ADMIN', 'OWNER')),
  full_name text not null,
  email text not null,                          -- denormalized for query convenience
  twilio_identity text unique,                  -- null for OWNER role
  status text not null default 'OFFLINE'
    check (status in ('AVAILABLE', 'ON_CALL', 'OFFLINE')),
  accepting_calls boolean not null default false,  -- ADMIN-only meaningful
  active boolean not null default true,
  mfa_secret text,                              -- v1.1 forward-compat
  last_seen_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index profiles_operator on profiles(operator_id);
create index profiles_role on profiles(operator_id, role);
create index profiles_twilio on profiles(twilio_identity)
  where twilio_identity is not null;
```

**`status` is informational only.** Routing uses parallel-dial — the Twilio Device determines actual reachability. Status drives UI ("who's online") via a 1-minute cron that marks stale `last_seen_at` rows as `OFFLINE`.

### 5.3 `properties`

```sql
create table properties (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references operators(id) not null,
  name text not null,
  owner_user_id uuid references profiles(id),  -- nullable; junction table later if multi-owner
  timezone text not null,
  routing_did text unique,                     -- Twilio number guests call
  property_phone_number text,                  -- guest-facing fallback (used on K-08)
  after_hours_support_phone text,              -- ops-only contact line
  playbook_pdf_url text,                       -- Supabase Storage URL
  playbook_version int default 1,
  logo_url text,                               -- Supabase Storage URL (public bucket)
  kiosk_welcome_message text default 'How can we help?',
  geocoded_lat numeric,
  geocoded_long numeric,
  active boolean not null default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index properties_operator on properties(operator_id);
create index properties_owner on properties(owner_user_id);
create unique index properties_routing on properties(routing_did)
  where routing_did is not null;
```

### 5.4 `property_assignments`

```sql
create table property_assignments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references operators(id) not null,
  property_id uuid references properties(id) on delete cascade not null,
  primary_agent_id uuid references profiles(id) not null,
  backup_agent_id uuid references profiles(id),  -- v1.1 forward-compat
  effective_from timestamptz default now() not null,
  effective_until timestamptz,
  created_at timestamptz default now() not null
);

create index assignments_property on property_assignments(property_id, effective_from, effective_until);
create index assignments_agent on property_assignments(primary_agent_id);
```

**Invariant**: at most one row with `effective_until IS NULL OR effective_until > now()` per `property_id` at any time. Admin UI enforces this on save (closes the prior assignment first); no DB constraint in v1 because of complexity, but a periodic check could be added.

### 5.5 `calls`

```sql
create table calls (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references operators(id) not null,
  property_id uuid references properties(id) not null,
  channel text not null check (channel in ('AUDIO', 'VIDEO')),
  state text not null
    check (state in ('RINGING', 'IN_PROGRESS', 'COMPLETED', 'NO_ANSWER', 'FAILED')),
  twilio_call_sid text unique,                 -- AUDIO only
  agora_channel_name text,                     -- VIDEO only
  caller_number text,                          -- AUDIO only
  handled_by_user_id uuid references profiles(id),
  room_number text,                            -- agent-entered during call
  ring_started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  recording_url text,                          -- Twilio recording URL (for owner playback)
  recording_sid text,
  flagged_for_review boolean not null default false,
  notes text,                                  -- agent's post-call notes
  created_at timestamptz default now() not null
);

create index calls_property_recent on calls(property_id, created_at desc);
create index calls_operator_recent on calls(operator_id, created_at desc);
create index calls_agent_recent on calls(handled_by_user_id, created_at desc);
create index calls_state_active on calls(state)
  where state in ('RINGING', 'IN_PROGRESS');   -- partial index for active call lookups
```

### 5.6 `audit_logs`

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references operators(id) not null,
  actor_user_id uuid references profiles(id),  -- nullable for SYSTEM events
  actor_type text not null check (actor_type in ('USER', 'SYSTEM')),
  action text not null,                        -- e.g., 'user.invited', 'property.deleted'
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz default now() not null
);

create index audit_operator_recent on audit_logs(operator_id, created_at desc);
create index audit_entity on audit_logs(entity_type, entity_id);
```

**What gets logged (v1):** sign-in, sign-out, password change, user invited, user role changed, user active toggled, property created/edited/deleted, property settings changed.
**What does NOT get logged:** page views, read queries, heartbeats, `accepting_calls` toggle (high-frequency, low-value).
**Who reads it:** admins only, via `/audit` route.

### 5.7 `operator_settings`

Per-operator key/value config. Used for things like recording disclosure URL that need to vary per-tenant in v2 SaaS mode.

```sql
create table operator_settings (
  operator_id uuid references operators(id) not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now() not null,
  primary key (operator_id, key)
);
```

Known keys: `recording_disclosure_audio_url`, `apology_audio_url`, `default_max_ring_seconds`.

### 5.8 Storage buckets

| Bucket | Visibility | Contents |
|---|---|---|
| `playbooks/` | Private — signed URLs only | Property playbook PDFs. Signed URLs (1hr expiry) issued by portal API when agent opens during a call. |
| `logos/` | Public read | Property logos shown on kiosk. Admin uploads. |
| `audio/` | Public read | Recording disclosure and apology MP3s referenced from TwiML. Admin uploads. |

---

## 6. Authentication & Row-Level Security

### 6.1 Auth flow

1. **Invitation**: Admin invites by email → API route uses Supabase service role to create both `auth.users` row and `profiles` row in a single transaction → Supabase Auth emails a one-time-use signup link.
2. **First sign-in**: User clicks link → lands on `/onboarding` → sets password + confirms display name.
3. **Subsequent sign-ins**: `/sign-in` page, email + password → Supabase issues HTTP-only cookie via `@supabase/ssr`.
4. **Middleware** (`middleware.ts`): Runs on every portal route. Reads cookie → fetches session. No session → redirect to `/sign-in`. Session exists → fetch profile (cached per request) → attach role to request context.
5. **Role guards**: Pages live in route groups — `app/(agent)/`, `app/(admin)/`, `app/(owner)/`. Each group's layout calls `requireRole('AGENT')` etc. and redirects on mismatch.
6. **Sign-out**: POST to `/auth/signout` → clears cookie + invalidates Supabase session.

No flash of logged-out content because auth resolves on the server before HTML ships.

### 6.2 Row-Level Security

RLS is **enabled on every table**. The service role (used by Twilio webhooks, admin-invite API routes, and cron jobs) bypasses RLS. The authenticated role (client-side and server-component queries on behalf of the user) is bounded by these policies:

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `profiles` | Self + same-operator profiles (owner only sees admins/agents on properties they own) | Self update of limited fields (name, password). Admin updates any in own operator. |
| `properties` | Admin: all in operator. Agent: assigned properties only. Owner: their owned properties. | Admin only |
| `property_assignments` | Same as properties | Admin only |
| `calls` | Admin: all. Agent: calls they handled. Owner: calls at their properties. | Service role only (webhooks write) |
| `audit_logs` | Admin only | Service role only |
| `operator_settings` | Any authenticated user in operator | Admin only |
| `operators` | Any authenticated user in own operator | Service role only |

**Why it matters**: even if an API route forgets to scope a query, Postgres refuses to return rows the user shouldn't see. Defense in depth.

---

## 7. Call Routing — Audio Path

### Webhook routes (`apps/portal/app/api/twilio/voice/`)

| Route | Trigger | Action |
|---|---|---|
| `incoming/route.ts` | Twilio receives call on property DID | Validate HMAC. Insert `calls` row (state=RINGING). Return parallel-dial TwiML. |
| `dial-result/route.ts` | `<Dial>` finishes (answered or 120s timeout) | If `DialCallStatus=completed`, return `<Hangup/>`. Otherwise return apology TwiML. |
| `status/route.ts` | Call lifecycle events | Update `calls.state`, `ended_at`, `duration_seconds`. |
| `recording-status/route.ts` | Twilio finishes processing recording | Update `calls.recording_url`, `recording_sid`. |

### Flow diagram

```
Guest calls property DID (Twilio number)
         │
         ▼
Twilio POSTs to /api/twilio/voice/incoming
         │
         ▼
Next.js handler:
  1. Verify HMAC signature using Twilio Node SDK
  2. Look up property by routing_did
  3. Look up active property_assignment → primary agent
  4. Look up admins in same operator with accepting_calls=true
  5. INSERT into calls (state=RINGING, channel=AUDIO)
  6. Build TwiML:
       <Response>
         <Play>{recording_disclosure_audio_url}</Play>
         <Dial timeout="120" action="/api/twilio/voice/dial-result">
           <Client>{primary_agent.twilio_identity}</Client>
           <Client>{admin1.twilio_identity}</Client>  ← if accepting_calls
           <Client>{admin2.twilio_identity}</Client>  ← etc.
         </Dial>
       </Response>
  7. Return TwiML to Twilio
         │
         ▼
Twilio rings all listed identities in parallel for 120s
         │
   ┌─────┴─────┐
   │           │
First answers  120s with no answer
   │           │
   ▼           ▼
Call           dial-result handler returns
connects       <Response><Say>{apology}</Say><Hangup/></Response>
   │           │
   ▼           ▼
UPDATE calls   UPDATE calls
state=         state=NO_ANSWER,
IN_PROGRESS,   ended_at=now()
handled_by=
answered_at=
```

### Implementation notes

- All Twilio SDK calls happen in Next.js API routes (Node.js runtime), not in the Edge runtime. Vercel Fluid Compute defaults satisfy this.
- HMAC verification uses `twilio.validateRequest()` from the official Node SDK. No more hand-rolled `crypto.subtle.sign('HMAC')` workarounds.
- Idempotency: every webhook checks if the `calls` row already exists for the `twilio_call_sid` and updates rather than inserts on retry.

---

## 8. Call Routing — Video Path (Kiosk)

### Kiosk-to-portal API surface

| Route | Trigger | Action |
|---|---|---|
| `/api/agora/token` | Kiosk taps tile to start a call | Validate kiosk property identity (signed config token). Return Agora channel name + signed Agora token (1hr expiry). |
| `/api/kiosk/call-started` | Kiosk joined Agora channel | INSERT calls (channel=VIDEO, agora_channel_name, state=RINGING). |
| `/api/kiosk/call-ended` | Kiosk leaves channel (any reason) | UPDATE calls (state, ended_at, duration_seconds). |
| `/api/kiosk/heartbeat` | Kiosk every 30s | Updates a `kiosk_last_seen_at` in operator_settings or future kiosks table. v1 simple: log to audit. |

### Flow

```
Guest taps tile on kiosk K-01
         │
         ▼
Kiosk GET /api/agora/token
  (returns Agora channel + token)
         │
         ▼
Kiosk joins Agora channel +
POSTs /api/kiosk/call-started
  → INSERT calls (channel=VIDEO, state=RINGING)
         │
         ▼
Portal admin/agent receives notification:
  (a) Agora SDK 'remote-user-joined' event in their dashboard
  (b) Next 20s polling tick refreshes the calls list
         │
   ┌─────┴─────┐
   │           │
Someone accepts  120s nobody accepts
   │           │
   ▼           ▼
Joins channel  Kiosk: K-08 overlay 10s
Video flows    → return to K-01 home
   │           Portal POSTs /api/kiosk/call-ended
   ▼           UPDATE calls state=NO_ANSWER
On hangup
POST /api/kiosk/call-ended
UPDATE calls state=COMPLETED
```

### Implementation notes

- Kiosk has no Supabase credentials. All DB writes go through portal API routes (service role on portal side). This is the "kiosk → portal API boundary" we're preserving.
- Kiosk is identified by a per-property signed config token baked in at kiosk setup time. Token includes `property_id` + signature; portal API validates on each request.
- Agora token generation uses Agora's Node.js library — works natively on Vercel Functions.

---

## 9. UI/UX Baseline

### 9.1 Universal data states (every list/detail view)

| State | Pattern |
|---|---|
| **Loading** | Skeleton shapes matching the final layout with subtle pulse animation. **Max 10s** before switching to error. |
| **Empty** | Large low-opacity lucide icon + one-line description + primary CTA. Never just "No data." |
| **Error** | Friendly icon + plain-language message + retry button + "contact support" link. Tech detail logged to Sentry, never shown to user. |
| **Populated** | Actual UI. Realtime updates animate in subtly, never jump. |

### 9.2 Call-specific failure states

| Situation | UX |
|---|---|
| Mic / camera permission denied | Full-screen overlay with browser-specific instructions. Block dashboard until resolved. |
| Browser doesn't support WebRTC | Sign-in page tells them which browsers work. |
| Twilio Device fails to register | Red status dot in header. Banner: "Phone line disconnected — reconnecting…" with auto-retry. |
| Network drops mid-call | "Reconnecting" overlay. Auto-reconnect attempt. If fails, call ends with clear message. |
| Agora video fails to start (kiosk) | Falls through to K-08 apology overlay → home. |

### 9.3 Navigation

- **Sidebar**: collapsed icon-only by default. Expands on hover with labels on desktop/iPad. No labels shown on mobile. Logo at top doubles as home/dashboard link.
- **Active route**: highlighted with `--color-primary`.
- **No breadcrumbs** in v1.
- **Modals**: plain React state (not URL state). Browser back navigates the *page*, not the modal.
- **Header**: profile menu (sign out), `accepting_calls` toggle (admins only), notifications dot. No theme toggle.
- **Kiosk**: zero navigation chrome. Full-screen, locked-down, only the K-buttons in the spec.

### 9.4 Feedback (toasts, confirms, validation)

- **Toasts** (shadcn `sonner`): bottom-right, auto-dismiss after 4s, manually dismissible, max 3 stacked.
- **Confirmation dialogs**: required for every destructive action. Two buttons, destructive button red on the right.
- **Form validation**: inline (red text under field) on blur, plus summary at top on submit attempt.
- **Optimistic updates**: low-risk mutations (toggles, marking read) — rollback + toast on failure.

### 9.5 Accessibility (non-negotiable)

- Keyboard nav works everywhere (tab, enter, escape).
- Visible focus rings on every interactive element. **Never** `outline: none`.
- All buttons have hover + focus + active + disabled states.
- All images have alt text. All form inputs have labels.
- Color contrast ≥ WCAG AA on every text element.

### 9.6 Responsive

- **Portal — agent + admin**: desktop-first (1280px target), works down to 1024px laptop. Not phone-optimized.
- **Portal — owner**: mobile-first responsive. Phone-friendly main views, scales up to desktop.
- **Kiosk**: locked to tablet orientation specified per property (most landscape). No responsive concerns.

### 9.7 Theme

- **Light mode only across every surface.** No dark mode in v1.
- Portal tokens defined in `apps/portal/app/globals.css`. Kiosk tokens in `apps/kiosk/src/index.css`.
- **Never hardcode hex values in components.** Always use Tailwind token classes.

### 9.8 Icons & illustrations

- **All icons**: `lucide-react`. Ships with shadcn, tree-shakeable.
- **Empty-state graphics**: large lucide icon at 20% opacity. No illustration library in v1.

---

## 10. Observability

| Tool | What it watches | Where to look |
|---|---|---|
| **Sentry** | Every unhandled error (client + server), perf budgets, slow API calls | sentry.io dashboard |
| **Vercel Analytics** | Page load metrics, Core Web Vitals | Vercel dashboard → Analytics |
| **Vercel Logs** | All API route invocations, errors, console logs | Vercel dashboard → Logs |
| **Supabase Logs** | Slow queries, RLS denials, auth events | Supabase dashboard → Logs |
| **`/status` page** (admin-only) | Twilio webhook health (last received), Supabase connectivity, last polling tick, recent error count | https://lobby-connect-portal.vercel.app/status |
| **`/audit` page** (admin-only) | Meaningful changes (user invites, role changes, property edits) | https://lobby-connect-portal.vercel.app/audit |

---

## 11. v1 Scope (Kept vs Cut)

### Ships in v1

- Phone routing (Twilio audio path)
- Agent dashboard with live property cards
- Admin CRUD: agents, properties, staff (admins, owners), assignments
- Owner portal (mobile-first responsive): properties, recent calls, recording playback
- Kiosk video (Agora) with K-01 → K-04 → K-08 flow
- `accepting_calls` toggle in admin header
- Audit log with admin-only `/audit` viewer
- Status page (`/status`) for admin
- Sentry error tracking
- 20s polling + focus-refetch
- Light mode UI

### Cut from v1 (forward-compat baked in)

- Voicemail (entirely — no audio capture, no email fan-out, no playback UI)
- Voicemail callback queue (A-19)
- PagerDuty / shift-login escalation
- Ops dashboard (D-31 through D-35)
- Held-call slot / second-call queuing
- Backup agent ringing (column reserved, logic deferred)
- MFA enrollment
- Audio transcription / transcript search
- Self-service signup / Stripe billing
- Custom domain (Vercel URLs for pilot)
- Magic link sign-in
- Mobile-responsive agent + admin portals
- E2E test suite
- Dark mode

---

## 12. v1.1+ Forward-Compat Checklist

Doors left open. None of these require destructive migration.

| Feature | What's already in v1 to enable it later |
|---|---|
| Voicemail | `calls.recording_url` exists. Webhook routes structured to accept `/voicemail/...` siblings. Just add table + UI + webhook handler. |
| Voicemail callback queue | New table + UI. Reads `calls` where state=NO_ANSWER (add `voicemailed_at` column). |
| PagerDuty | New env var + one new module in `lib/integrations/`. Hooks into existing `audit_logs` events. |
| Ops dashboard | New route group `app/(ops)/`. Reads existing tables. Add `'OPS'` to role CHECK constraint. |
| MFA | `profiles.mfa_secret` column exists. Add TOTP library, enrollment UI, sign-in step. |
| Multi-tenant SaaS | `operator_id` on every table. Add query-layer filter in shared DB client + signup flow. |
| Held-call slot | New `active_call_sessions` table. Existing `calls` table unchanged. |
| Audio transcription | `calls.recording_url` exists. Add Deepgram webhook + transcript table. |
| Backup agent ringing | `property_assignments.backup_agent_id` column exists. Add to the parallel-dial pool. |
| Magic link sign-in | Toggle in Supabase Auth + new UI button on sign-in page. ~½ day. |
| Custom domain | Add domain in Vercel dashboard. DNS update. Zero code change. |
| Mobile-responsive agent + admin | CSS work only, no architecture change. |
| Dark mode | Re-introduce `[data-theme="dark"]` branch in CSS. Re-add ThemeProvider. Per-component dark variants. |

---

## 13. Testing Strategy

- **Unit tests**: every `lib/` module (call routing, auth helpers, audit logger). Vitest. Run on every commit.
- **Integration tests**: API routes hit a local Supabase instance (`npx supabase start`). Vitest + supertest. Run pre-deploy.
- **E2E tests**: deferred to v1.1. v1 pilot validated manually with one hotel.
- **Twilio call testing**: Twilio CLI simulates inbound calls against localhost via ngrok or directly against Vercel preview URL.
- **Manual smoke test before pilot**: end-to-end audio call from a real phone + end-to-end video call from a real tablet.

---

## 14. Open Items

These are not blocking v1 but should be tracked.

1. **Property owner contact details on K-08**: K-08 spec says "try again or call the property directly at `{property_phone_number}`". Confirm the exact copy on the kiosk overlay.
2. **Apology TwiML audio file**: needs to be recorded once and uploaded to `audio/` bucket. Voice talent TBD.
3. **Recording disclosure file**: same. Single universal phrase: "Calls may be recorded for quality and training purposes."
4. **Kiosk hardware**: tablet model, mount, network connectivity for pilot hotel.
5. **Pilot hotel rollout plan**: how routing DID is provisioned, when go-live, fallback plan if v1 fails on day 1.
6. **Sentry account setup**: Kumar creates `lobby-connect` org on sentry.io; auth token added to env.
7. **Twilio sub-account vs main account**: for v1 use main account; v2 multi-tenant adds sub-account-per-operator provisioning.
8. **Agora app setup**: confirm appID + certificate values, set up the project on console.agora.io.

---

*End of design spec.*
