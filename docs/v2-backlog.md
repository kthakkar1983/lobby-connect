# Lobby Connect — v2 / Post-Pilot Backlog

Living list of work deferred past the v1 pilot. Add items here as they surface (especially
during the pilot) so they don't get lost. Each entry should capture: the **problem**, **why it
matters**, **where it lives in code**, a **fix sketch**, and the **pilot workaround** (if any).

> Two other deferral sources already exist — don't duplicate them here, just cross-reference:
> - **Cut-from-v1 features** (voicemail, callback queue, PagerDuty, ops dashboard, held-call slot,
>   backup-agent ringing, MFA, audio transcription, magic-link sign-in, mobile-responsive
>   agent/admin portals, dark mode) — see `CLAUDE.md` → "v1 scope".
> - **Before-public-launch hardening** (Vercel Pro + per-minute presence cron, call-recording
>   enablement, etc.) — see `docs/setup/2026-06-03-launch-checklist.md` and `memory/project-status.md`.

---

## Admin / user management

### Resend an invite without hard-deleting the user

**Status:** open · **Raised:** 2026-06-04 (pilot smoke) · **Pilot workaround:** hard-delete the user, then invite fresh.

**Problem.** There is no way to re-send an invitation. `inviteUser()` pre-checks for an existing
profile and returns *"A user with this email already exists."*
(`apps/portal/lib/users/invite.ts:34`), and the users table has no "Resend" control. So when an
invite is lost, expires, or (as happened in the pilot) the link lands on the wrong page, the only
recovery is to **hard-delete** the user and invite again — which discards their profile id, audit
linkage, and any assignments.

**Why it matters.** Invites routinely need re-sending (spam folder, expired token, a config typo
that's since been fixed). Destroying and recreating a user just to resend is destructive and unsafe
once that user has real history (assignments, handled calls). It will bite as owners/agents onboard
at any scale.

**Fix sketch.**
- Add an admin-only `resendInviteAction` that re-issues the invite for a profile whose auth user has
  **never onboarded** — `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })` again (or
  `generateLink({ type: 'invite' })`). Audit as `user.invite_resent`.
- Relax the `invite.ts:34` pre-check so an existing **un-onboarded** profile may be re-invited, while
  still blocking re-invites of an already-active/onboarded user.
- Surface a **"Resend invite"** row-menu item in `app/(admin)/admin/users/users-table.tsx`, shown
  only for not-yet-onboarded users. Show invite state (Invited / Active) in the table.
- Consider a companion **"Revoke invite"** (remove the pending auth user + profile) for clean cancels.

**Acceptance.** An admin can resend an invite to a pending user from the UI; the new email links to
the clean-alias `/onboarding`; no hard delete required; already-active users still can't be re-invited.

---

## Observability / security

### Rotate the Sentry auth token (exposed in chat during the §7 fix) 🔐 post-launch

**Status:** open · **Raised:** 2026-06-06 (session-4 smoke, §7) · **Pilot workaround:** none needed — the token is valid + correctly scoped and serving; just rotate post-launch as hygiene.

**Problem.** While fixing the `/admin/status` "Recent errors" probe, the prod `SENTRY_AUTH_TOKEN` (a Sentry **User Auth Token**) was pasted in plaintext into the session-4 Claude chat. It is now the live prod token (wired into Vercel → portal → Production, redeployed, confirmed working — `/admin/status` reads amber/2 errors). It is **not** in any file or git commit — only in the chat transcript.

**Why it matters.** A secret that has left its secure channel should be rotated. Blast radius is limited (Sentry org data only), but it's standard hygiene before relying on it long-term.

**Where it lives.** Vercel → `lobby-connect-portal` → Settings → Environment Variables (Production): `SENTRY_AUTH_TOKEN`. Consumed by `apps/portal/lib/sentry/errors.ts` (runtime issues-count probe) and `next.config.ts` `withSentryConfig` (build-time source-map upload).

**Fix sketch.**
- Sentry → Settings → Auth Tokens → new **User Auth Token** with **`event:read`** + `project:read` + `project:releases`. (The issues endpoint needs `event:read`; `project:read` alone returns 403 — this was the original session-4 bug.)
- `vercel env rm SENTRY_AUTH_TOKEN production` then `vercel env add` the new value → **redeploy** portal.
- **Revoke** the old token (`sntryu_2eed…`) in Sentry — it should then 401 on the issues API.

**Acceptance.** `/admin/status` "Recent errors" still shows a count after the swap; old token revoked + returns 401.
