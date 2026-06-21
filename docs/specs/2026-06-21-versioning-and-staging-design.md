# Versioning Policy + Staging Environment — Design

- **Status**: Draft (brainstorm complete, pending user review)
- **Date**: 2026-06-21
- **Context**: v1 is feature-complete (pilot, one hotel end-to-end). This spec establishes (A) how we version every change going forward, (B) the mechanics of stamping the current `main` as `v1.0.0`, and (C) a free-tier staging environment whose first use is the v1.1 work (caching, session expiry, database queries).
- **Builds on**: current `main` tip `931ed65`; deploy/prod-infra model in `memory/project-status.md`.

---

## 1. Purpose & scope

Three related pieces of release engineering, in priority order:

1. **Versioning policy** — a semver convention so every future feature, bug fix, and hotfix is labelled.
2. **v1.0.0 release** — tag and GitHub Release for the pilot baseline. Immediate.
3. **Staging environment** — a persistent, prod-shaped, throwaway environment to test/preview changes before they reach prod. The substantial build; first consumer is v1.1.

**Decided in brainstorm:**
- Tag `v1.0.0` **now** (not after the §A voice smoke). The §A presence-gate fix is already merged; any follow-up ships cleanly as `v1.0.1`.
- Sandbox architecture = **persistent staging as the backbone** (chosen for the higher-stakes live future over ephemeral-only previews), built on free tiers, with per-PR previews layered on for free and Supabase branching deferred to Pro.

**Out of scope:** multi-agent-per-property assignment (v2 feature — separate decision); any application code change (this is process + infrastructure only).

---

## 2. Part A — Versioning policy (semver)

### 2.1 Scheme

`vMAJOR.MINOR.PATCH`, applied to the product as a whole (the monorepo ships as one unit).

| Bump | When | Example |
|---|---|---|
| **PATCH** (`v1.0.x`) | Bug fixes, hotfixes, security/doc fixes. No new user-facing features, no breaking changes. | §A voice follow-up → `v1.0.1` |
| **MINOR** (`v1.x.0`) | Backward-compatible new features. | caching/session/DB work → `v1.1.0` |
| **MAJOR** (`vx.0.0`) | Breaking changes / major reworks. | multi-tenant SaaS → `v2.0.0` |

### 2.2 Source of truth

- **Annotated git tags** (`v1.0.0`) mark released commits.
- **GitHub Releases** carry the human-readable notes, auto-generated from merged PRs (`gh release create --generate-notes`) plus a short hand-written summary.
- **`package.json` `version`** in all four workspaces (root, `apps/portal`, `apps/kiosk`, `packages/shared`) is bumped to match at release time. They are `0.0.0` today. This is the in-repo record of "what version is this code" and is cheap to keep in sync (once per release).

### 2.3 Coexistence with `plan-*` tags

The existing `plan-*-complete` / `brand-*` tags (21 of them) are **kept as-is**. They track *internal build milestones* — a different axis from *released versions*. No renaming, no deletion. Semver tags are additive.

### 2.4 Workflow

- **Normal release**: feature branch → PR → merge to `main` → when a coherent set of changes is ready to stamp, make a `chore(release): vX.Y.Z` commit (bumps the four `package.json`s), annotated-tag it, push, create the GitHub Release.
- **Hotfix**: branch from `main` (or the release tag), fix, PR, merge, then a PATCH release.
- **Cadence**: tag a release when there's something worth stamping — not every commit. `v1.0.0` now; `v1.1.0` when the v1.1 work lands; patches as hotfixes occur.

### 2.5 Documentation

- New `docs/VERSIONING.md` holds this policy (short).
- A one-line pointer added to `CLAUDE.md` → Conventions.

---

## 3. Part B — v1.0.0 release (immediate)

1. **Release commit** on `main`: `chore(release): v1.0.0` bumping `version` `0.0.0 → 1.0.0` in the root + `apps/portal` + `apps/kiosk` + `packages/shared` `package.json`.
2. **Annotated tag** `v1.0.0` on that commit; push tag.
3. **GitHub Release** `v1.0.0` — title `v1.0.0 — Pilot baseline`, body = a concise v1 feature summary (below) + `--generate-notes` PR changelog. Marked **latest**, not pre-release.

**v1 summary (release-notes seed):** after-hours outsourced front-desk for hotels — phone routing (Twilio parallel-dial, presence-gated), agent + admin dashboards with in-browser softphone, admin CRUD (users / properties / assignments / per-property call availability), mobile owner portal, kiosk tablet video (Agora) with playbook, real-911 emergency conference + incident log, audit log, observability/status (Sentry + health signals), email-free admin-provisioned auth with RLS on every table, and the full brand revision across all surfaces.

**Note:** `v1.0.0` means *feature-complete pilot baseline*. The §A single-agent voice smoke is still being confirmed; if it surfaces a fix, that ships as `v1.0.1`. This is the deliberate, brainstorm-approved meaning of the stamp.

---

## 4. Part C — Staging environment (the build)

### 4.1 Topology

The end-state is a standard three-tier model; we build the two tiers that matter now (Production + Staging) and get Preview for free.

| Tier | Git trigger | Database | Telephony | Purpose |
|---|---|---|---|---|
| **Production** | `main` | `lobby-connect-prod` | real Twilio/Agora, `EMERGENCY=911` | Real traffic |
| **Staging** | `staging` branch | **new** `lobby-connect-staging` | telephony deferred; `EMERGENCY=933` always | Prod-shaped final gate; throwaway data |
| **Preview** | any other branch / PR | staging DB (shared) | none | Fast per-change checks (automatic) |

### 4.2 Supabase

- Create project **`lobby-connect-staging`** in org `qrpnbimuziaoekoznfxm` (`unbrandt`), region matching prod (`us-east-1`). Active project #2 → **$0** (prod active, `Back of House` paused/uncounted).
- Apply **all migrations `0001`–`0017`** (same set as prod) to the staging ref.
- Seed throwaway data: a test operator + admin + owner + agent (mirror `supabase/bootstrap-prod.sql` with fake credentials and obviously-fake names), plus a sample property. Never copy real pilot data.
- Migration discipline going forward: commit migration → apply to staging → verify → apply to prod (same MCP/CLI path already used for prod).

### 4.3 Vercel (both `portal` + `kiosk` projects)

- Long-lived **`staging`** git branch. Pushing to it auto-deploys a preview for **both** Vercel projects.
- **Branch-scoped Preview environment variables**, pointed at staging Supabase + staging cross-refs. Scope the DB vars to **all Preview branches** (not just `staging`) so every feature-branch preview also works against the staging DB out of the box — that is the free "Preview tier."
- **Stable URLs**: Vercel's git-branch URLs (`…-git-staging-<scope>.vercel.app`) are stable per branch and always reflect the latest `staging` commit. (A cleaner alias is a later nicety.)

**Staging env-var matrix (per Vercel project):**

| Variable | Staging value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / anon key | staging project | from new project |
| `SUPABASE_SERVICE_ROLE_KEY` | staging project | **never** the prod key |
| portal↔kiosk cross-ref URLs (`NEXT_PUBLIC_APP_URL`, `VITE_PORTAL_API_URL`, `KIOSK_ORIGIN`) | staging branch URLs | keep both apps pointing at staging |
| `CRON_SECRET`, `KIOSK_CONFIG_SECRET` | fresh staging secrets | independent of prod |
| `EMERGENCY_DIAL_NUMBER` | **`933`** | hard rule — real 911 never on staging |
| Twilio / Agora creds | **deferred** (unset or test creds) | v1.1 doesn't touch the call path |
| Sentry | staging DSN or disabled | avoid polluting the prod Sentry project |

### 4.4 Promotion flow

Feature branch (from `main`) → PR → merge into **`staging`** → verify on the staging URL → merge the change into **`main`** → prod deploy → **re-sync `staging` to `main`** (reset `staging` onto `main`) after each prod release so the two don't drift.

### 4.5 What "staging works" looks like (acceptance)

- Staging Supabase has every table (all migrations applied).
- The staging **portal** URL loads and you can sign in as a staging test user.
- The staging **kiosk** URL loads its config.
- A write performed on staging is **absent from prod** (isolation proof).

---

## 5. Verified facts & sources

- **Supabase Free = 2 active projects per org; paused don't count** — [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq). Current org state confirmed live via MCP: `lobby-connect-prod` ACTIVE, `Back of House` INACTIVE.
- **Vercel Custom Environments are Pro-only; Hobby does staging via branch-scoped Preview env vars** — [Vercel: set up a staging environment](https://vercel.com/kb/guide/set-up-a-staging-environment-on-vercel), [Vercel environments docs](https://vercel.com/docs/deployments/environments).

*(Cost claim is source-backed as $0 on current tiers; everything else here is design intent.)*

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Free tier caps at 2 active projects; staging puts us at the ceiling | Accept for now; upgrade staging to paid alongside prod at public launch. No 3rd active project until then. |
| Free projects auto-pause after ~7 days idle (why `Back of House` is INACTIVE) | Un-pause staging before a test session; it's a 30-second dashboard action. |
| Shared staging DB across parallel previews can let branches step on each other's data | Acceptable for a solo dev with few parallel branches; Supabase branching (Pro) gives per-branch isolated DBs later. |
| Vercel preview deploys sit behind the Vercel Authentication wall by default | Fine for Kumar clicking through (logged into Vercel). When staging gets telephony, disable protection on staging or use a protection-bypass token (same gotcha as the prod invite-link wall). |
| `staging` drifts from `main` | Fast-forward `staging` → `main` after every prod release. |
| Catastrophic mix-up: staging pointed at prod DB, or `911` on staging | Env-var review checklist at setup; `EMERGENCY_DIAL_NUMBER=933` hard rule; separate service-role keys. |

---

## 7. Deferred (layer in later, no rework)

- Staging **telephony** (own Twilio number + Agora creds) — added when a change touches the call path.
- **Custom domain / clean alias** for staging.
- **Supabase branching** (Pro) for per-branch isolated DBs.
- Promoting `staging` to a first-class Vercel **Custom Environment** (at Pro).
- **Automated** version bumping / release (e.g., Changesets) — manual is fine at this cadence.

---

## 8. Definition of done

- **A**: `docs/VERSIONING.md` written; `CLAUDE.md` conventions pointer added.
- **B**: `package.json`s at `1.0.0`; annotated tag `v1.0.0` pushed; GitHub Release `v1.0.0` published with notes.
- **C**: `lobby-connect-staging` Supabase project created, migrated, seeded; `staging` branch created; branch-scoped Preview env vars set on both Vercel projects; staging portal + kiosk URLs verified per §4.5; isolation from prod proven.
