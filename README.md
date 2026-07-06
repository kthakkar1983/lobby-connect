# Lobby Connect

After-hours outsourced front-desk service for hotels — phone routing + tablet video.

## Status

v1 in development. Pilot target: one hotel, end-to-end.

## Stack

Next.js 15 + Vite 6 + Supabase + Twilio + LiveKit (self-hosted). The trunk deploys to the owned box (Coolify); the live pilot temporarily still runs from a frozen Vercel standby (still Agora) pending the Phase-5 cutover — see CLAUDE.md.

## Repo layout

| Path | What lives here |
|---|---|
| `apps/portal/` | Next.js 15 app — agent + admin + owner dashboards, Twilio + LiveKit API routes |
| `apps/kiosk/` | Vite 6 SPA — tablet-locked LiveKit video client |
| `packages/shared/` | Cross-app types, constants, generated Supabase types |
| `packages/ui/` | Shared UI primitives (currently empty; shadcn lives in portal) |
| `supabase/` | Migrations, config, seed data for local Supabase |
| `docs/specs/` | Architecture spec — locked decisions |
| `docs/plans/` | Implementation plans, one per major phase |

## Prerequisites

- Node 22+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker (for local Supabase)

## Dev workflow

```bash
pnpm install                  # install everything (workspace-aware)
pnpm dev:portal               # http://localhost:3000
pnpm dev:kiosk                # http://localhost:5173
pnpm supabase:start           # http://127.0.0.1:54323 (Supabase Studio)
pnpm typecheck                # workspace-wide tsc --noEmit
pnpm lint                     # workspace-wide ESLint
pnpm test                     # workspace-wide Vitest
pnpm build                    # build all apps
pnpm format                   # Prettier write
```

## Where to start

- For technical orientation: see [`CLAUDE.md`](./CLAUDE.md)
- For the architecture spec: see [`docs/specs/2026-05-27-v1-architecture-design.md`](./docs/specs/2026-05-27-v1-architecture-design.md)
- For implementation plans: see [`docs/plans/`](./docs/plans/)
