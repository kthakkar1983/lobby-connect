# Versioning

Lobby Connect ships as one unit (the monorepo). Releases follow **semantic versioning**.

## Scheme — `vMAJOR.MINOR.PATCH`

| Bump | When | Example |
|---|---|---|
| **PATCH** `v1.0.x` | Bug fixes, hotfixes, security/doc fixes. No new features, no breaking changes. | §A voice follow-up → `v1.0.1` |
| **MINOR** `v1.x.0` | Backward-compatible new features. | caching / session-expiry / DB work → `v1.1.0` |
| **MAJOR** `vX.0.0` | Breaking changes / major reworks. | multi-tenant SaaS → `v2.0.0` |

## Source of truth

- **Git tags** (annotated, e.g. `v1.0.0`) mark released commits.
- **GitHub Releases** carry the notes — `gh release create --generate-notes` plus a short hand-written summary.
- **`package.json` `version`** in all four workspaces (root, `apps/portal`, `apps/kiosk`, `packages/shared`) is bumped to match at release time.

## Workflow

- **Release:** a `chore(release): vX.Y.Z` commit bumps the four `package.json`s → annotated tag → push → GitHub Release.
  - `v1.0.0` went straight to `main` (a no-logic version bump). **From `v1.1.0` on**, releases bundle real changes — land them via a PR so CI is green before the tag.
- **Hotfix:** branch from `main`, fix, merge, then cut a PATCH release.
- **Cadence:** tag when there's something worth stamping — not every commit.

## Separate axis: `plan-*` tags

The `plan-*-complete` / `brand-*` tags track *internal build milestones* — a different axis from *released versions*. They are kept as-is, not renamed.

---

Full rationale and the staging-environment design: [`docs/specs/2026-06-21-versioning-and-staging-design.md`](specs/2026-06-21-versioning-and-staging-design.md).
