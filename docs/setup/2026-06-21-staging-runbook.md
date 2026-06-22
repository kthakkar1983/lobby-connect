# Staging Environment — Runbook

Persistent, prod-shaped **staging** environment for testing/previewing changes before prod. Built 2026-06-21. Design: `docs/specs/2026-06-21-versioning-and-staging-design.md` · Plan: `docs/plans/2026-06-21-staging-environment.md`.

## URLs

| Surface | URL |
|---|---|
| Portal (staging) | `https://lobby-connect-portal-git-staging-kumar-thakkars-projects.vercel.app` |
| Kiosk (staging) | `https://lobby-connect-kiosk-git-staging-kumar-thakkars-projects.vercel.app` |
| Supabase (staging) | project ref `cgtvqjxhbojztzumshca` · dashboard: `https://supabase.com/dashboard/project/cgtvqjxhbojztzumshca` |

These are Vercel **git-branch aliases** — stable, always pointing at the latest `staging`-branch deploy. They sit behind Vercel's Authentication wall (a `401` to a logged-out client is expected; sign in to Vercel as the project owner to view).

## Sign-in

- **Admin:** `admin@staging.lobbyconnect.local` — password shared out-of-band (not committed). Created via the GoTrue admin API; `must_change_password=false`, so it signs straight in.
- Create more test users (agent/owner) from the staging portal: **Admin → Users → Add user** (typed temp password).

## How it's wired

- **One git branch = one environment.** Push to `staging` → Vercel auto-deploys both `lobby-connect-portal` and `lobby-connect-kiosk` as previews, using env vars scoped to **Preview / branch `staging`**.
- **Database:** a separate Supabase project (`cgtvqjxhbojztzumshca`), free tier. Prod (`ztunzdpmazwwwkxcpyfp`) is never touched.
- **Isolation:** Twilio / Agora / Sentry are shadowed to **empty** on the `staging` branch, so staging never registers on the prod Twilio account, uses prod Agora, or reports to the prod Sentry project. (Voice/video/Sentry are therefore *inert* on staging — fine for the v1.1 caching/session/DB work; re-enable later with dedicated staging creds if a change touches those paths.)

### Env var matrix (names + scope only — values live in Vercel, encrypted)

**Portal** (Preview / `staging`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `KIOSK_CONFIG_SECRET`, `EMERGENCY_DIAL_NUMBER` (=`933`), `NEXT_PUBLIC_APP_URL`, `KIOSK_ORIGIN`, plus empty shadows `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `AGORA_APP_ID`.

**Kiosk** (Preview / `staging`): `VITE_PORTAL_API_URL`.

> Set/replace a var via CLI: `vercel env add <NAME> preview staging --value "<V>" --yes --cwd apps/portal` (or `apps/kiosk`). `NEXT_PUBLIC_*` / `VITE_*` are build-time inlined → **redeploy after changing them.**

## Day-to-day

### Promote a change to prod
```
# develop on a feature branch off main, PR, then:
git checkout staging && git merge <feature-branch>   # preview on staging URL
# once verified:
#   merge the change into main (PR) -> prod auto-deploys
# then re-sync staging so it doesn't drift:
git checkout staging && git reset --hard main && git push --force-with-lease origin staging
git checkout main
```

### Apply a new migration to staging
Use the **Supabase MCP** (`apply_migration`, name = the migration filename), same as prod — *not* `supabase db push` (this sandbox has no direct Postgres egress, and the CLI is linked to prod). Then apply to prod the same way.

### Redeploy staging
Push any commit to `staging`, or `vercel redeploy <staging-deployment-url> --cwd apps/portal`. The git-branch alias follows the newest staging deploy.

## Gotchas

- **Free tier = 2 active projects.** Prod + staging is the ceiling (the old `Back of House` project is paused and doesn't count). No 3rd active project until Supabase Pro.
- **Free projects auto-pause after ~7 days idle.** If staging is unreachable, un-pause it in the Supabase dashboard (30 seconds), then redeploy if needed.
- **Vercel crons run on production deployments only** — staging does **not** auto-run the presence-sweep / reaper crons. Trigger manually with the staging `CRON_SECRET` if ever needed.
- **Never real 911 on staging:** `EMERGENCY_DIAL_NUMBER=933` always (and Twilio is shadowed off anyway).
- **Builds are serialized on Hobby** — a staging preview may queue behind a production build.
- **Env vars are snapshotted at deploy creation.** A var added *after* a deploy was triggered is NOT in that deploy — push a new commit (re-sync) to pick it up. (This bit us once: the cross-app URL vars were set just after the seed push, so the first staging deploy fell back to localhost until a re-sync.)

## Kiosk on staging — DEFERRED

The kiosk fetches the portal API **cross-origin**, and the staging portal preview sits behind Vercel's Deployment Protection (auth wall) — `/api/kiosk/config` returns **401** to the kiosk (it has no Vercel SSO cookie for the portal's domain), so the kiosk can't finish loading on staging. The *generated* kiosk link is correct (uses `KIOSK_ORIGIN`); the kiosk just can't reach the API.

**Deferred on purpose** — staging exists for portal-side work (v1.1: caching / session / DB), and the kiosk changes rarely. To enable the kiosk on staging later, either **(A)** turn off Vercel Deployment Protection for Preview on both projects (makes *all* previews public; app auth + kiosk token still protect data), or **(B)** have the kiosk send a Vercel protection-bypass token on its API calls (keeps the wall on; small code change).
