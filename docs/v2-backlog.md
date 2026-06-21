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

---

### Kiosk config token has no expiry or per-property revocation

**Status:** open · **Raised:** 2026-06-20 (v1 security-posture review, §D) · **Pilot workaround:** treat the pairing link as a secret; the only revocation today is rotating the global `KIOSK_CONFIG_SECRET` (re-pairs every property at once).

**Problem.** The kiosk pairing token is a per-property HMAC (`signKioskToken`, `apps/portal/lib/kiosk/config-token.ts:18`) that stamps an issued-at `t` but **never checks it** — `verifyKioskToken` (`:26`) validates only the signature, so the token has no expiry, no nonce, and no per-property revocation. It is delivered in a URL (`/?t=…`) and persisted to `localStorage` (`lc_kiosk_token`, `apps/kiosk/src/lib/config.ts`). Anyone who obtains it (browser history, a screenshot of the pairing link, a shared/synced tablet profile) can replay it indefinitely to read that property's kiosk config — including the guest WiFi password (`app/api/kiosk/config/route.ts:20,37`) — and to start/cancel video calls that ring the agent.

**Why it matters.** A single leaked link is effectively a permanent, unrevocable credential for that property. MEDIUM. For a single-hotel pilot the operational exposure is small (one trusted tablet), but it does not scale.

**Where it lives.** `apps/portal/lib/kiosk/config-token.ts` (sign/verify); consumed by `app/api/kiosk/{config,call-started,call-ended}/route.ts`, kiosk `heartbeat` (via `recordHeartbeat`), and the kiosk branch of `app/api/agora/token/route.ts`.

**Fix sketch.** Add a per-property `kiosk_token_version` column mixed into the signed payload; `verifyKioskToken` checks it against the property's current version, so bumping the column revokes one property's token without touching the global secret. Optionally enforce a max-age via the already-present `t` field. This is the natural pairing for the post-pilot **device-registry / per-device pairing** item already noted in `memory/project-status.md`.

**Acceptance.** An admin can revoke/re-pair a single property's kiosk; an old token then 401s; other properties are unaffected.

---

### Agora token route does not constrain `uid` to a role namespace

**Status:** open · **Raised:** 2026-06-20 (v1 security-posture review, §D) · **Pilot workaround:** none needed — confined to a single, already-active call within the requester's own property.

**Problem.** `GET /api/agora/token` (`apps/portal/app/api/agora/token/route.ts:19`) reads `uid` verbatim from the query string and never validates it against a range or the caller's role. The channel IS correctly scoped (kiosk branch requires `verified.propertyId === call.property_id`, `:42`; session branch requires `actor.operatorId === call.operator_id`, `:52`), but a holder of a valid kiosk token for a property in a live call can mint a PUBLISHER token for *any* uid on that channel — including the agent's uid — enabling an RTC-level uid collision / stream-hijack within that one call. The clients pick disjoint ranges by convention only (kiosk `[1, 1_000_000]`, `apps/kiosk/src/App.tsx:73`; agent `[1_000_001, 2_000_000]`, `apps/portal/components/video-call/video-call.tsx:54`); nothing enforces them server-side.

**Why it matters.** LOW: blast radius is a single already-active call for the requester's own property; it cannot reach another property's or operator's call. Worth closing as defense-in-depth, but the fix touches the live video token path (video is only smoke-testable on prod), so it is deferred out of the pilot rather than rushed in.

**Where it lives.** `apps/portal/app/api/agora/token/route.ts` (uid read + both auth branches).

**Fix sketch.** Promote the uid ranges to shared constants and enforce them per branch — kiosk uid ∈ guest range, session uid ∈ agent range; reject out-of-range with 400/403. TDD against the existing route tests. (Alternative: assign the uid server-side instead of trusting the client.)

**Acceptance.** A kiosk token cannot obtain a token for an agent-range uid (and vice-versa); a regression test covers both branches; live video still connects.

---

## UI / UX

### Admin off-tab incoming-video nudge

**Status:** open · **Raised:** 2026-06-17 (session 22 dashboard polish; Kumar OK'd as-is for now) · **Pilot workaround:** none needed — the ringtone still fires, and the always-home agent is unaffected.

**Problem.** Incoming **video** calls render as a persistent "Video" card in the right-hand softphone column (directly under the softphone), per Kumar's placement preference. That card lives inside the dashboard-workspace aside, which is `hidden` when the user is **off the dashboard home**. So an **admin who has navigated to another tab** (Users / Properties / Audit / Status) won't see a visible incoming-video card there — they only **hear the ringtone** (still plays) and must return home to see/accept it. Audio has an equivalent off-home nudge (the bottom-right `IncomingCallToast`); video does not.

**Why it matters.** Agents only have the one dashboard route, so they're never off-home — for them this is a non-issue. But an **admin covering calls** can wander to another tab and miss the *visual* of an incoming video call (the audio ring is the only cue). Low impact for the single-hotel pilot; grows with more admins/properties.

**Where it lives.** `apps/portal/components/dashboard-workspace.tsx` (aside is `onHome ? "flex …" : "hidden"`, and `VideoCallHost` now renders inside it); `apps/portal/components/video-call/{video-call-host,incoming-video-banner}.tsx`; compare the audio pattern in `apps/portal/components/dashboard/incoming-call-toast.tsx`.

**Fix sketch.**
- Mirror the audio pattern: render a fixed off-home **video** nudge (small corner toast — "Incoming video — go to your dashboard") when `pathname !== home` and a video call is ringing, routing the admin home to accept. The poll + ringtone already run; the nudge just needs the incoming state.
- OR lift the incoming-video state out of `VideoCallHost` so the banner can render in the aside on home **and** as a fixed fallback off-home (the active `VideoCall` is already fixed full-screen and escapes any container).

**Acceptance.** An admin on a non-home tab sees a visible incoming-video nudge (not just the ring) and can reach the call in one click; the agent/home experience is unchanged.
