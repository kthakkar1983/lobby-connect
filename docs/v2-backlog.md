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

---

## Infrastructure / environments

### Self-registering hotel-PC provisioning (enrollment token)

**Added 2026-07-03 (Phase-2 relay session; Kumar's "fire and forget for hotels" question).** Today `ops/rustdesk/provision-hotel-pc.ps1` prints the peer ID and generates the unattended password locally — two values a human relays back to LC (PM today; typed into `property_remote_access` admin CRUD at Phase 3). The endgame: generate each hotel a one-time download link carrying an enrollment token; the script POSTs `{peer_id, unattended_password}` straight into `property_remote_access` via an audited service-role route, so onboarding = "right-click → Run as administrator", nothing read back by phone. Small addition once the Phase-3 table + API exist (same route pattern as the other service-role writes); the same delivery mechanism later carries the per-connect password-rotation hook (target spec §4 security notes). MSI variant for chain-IT deployments is officially documented if a franchise group ever wants GPO/Intune delivery.


### Broaden the staging DB to all preview branches

**Status:** open · **Raised:** 2026-06-21 (staging env build) · **Pilot workaround:** n/a — staging works for its purpose; this is an enhancement.

**Problem.** The staging environment scopes its Supabase + secret env vars to the **`staging` git branch only** (`vercel env … preview staging`). So a per-PR feature-branch preview does NOT automatically point at the staging DB — only the `staging` branch does. The design originally floated scoping the DB vars to *all* Preview branches so every PR preview is DB-backed for free, but that breaks the cross-app URL vars (`NEXT_PUBLIC_APP_URL` / `KIOSK_ORIGIN` / `VITE_PORTAL_API_URL`), which are URL-specific per preview.

**Why it matters.** Per-PR previews currently have no working backend unless merged into `staging`. Fine for a solo dev; limits parallel preview testing later.

**Fix sketch.** Scope the staging DB + secret vars to all Preview branches, and derive the cross-app URLs at runtime from Vercel's `VERCEL_BRANCH_URL` system var instead of a fixed `NEXT_PUBLIC_APP_URL` (each preview self-references). Or adopt Supabase branching (Pro) for per-branch isolated DBs. Runbook: `docs/setup/2026-06-21-staging-runbook.md`.

**Acceptance.** Any PR preview boots against a non-prod DB with no manual env work; cross-app calls resolve to that preview's own URLs.

---

## Agents / routing

### Multi-agent property roster + daily on-shift selection

**Status:** open · **Raised:** 2026-06-21 · **Pilot workaround:** v1 assigns exactly **one** primary agent per property (plus admins who opt into the parallel dial).

**Desired (owner's framing, 2026-06-21).** Assign a **roster of 2–3 agents** to a property, then **pick which one is "on shift" that day** — only the on-shift agent is dialed. This is explicitly **NOT** concurrent multi-agent coverage of one pod, and **NOT** the reserved `backup_agent_id` "ring a backup too" idea (that framing was rejected). At most one on-shift agent at a time; an **admin can always chip in**; if a pod's volume outgrows one agent, the plan is to **remove properties from that pod**, not add concurrent agents.

**Why it matters.** Lets the operator staff a property from a small bench (cover days off / shift swaps) by flipping who's on-shift, instead of closing/reopening an assignment every time.

**Where it lives.** `property_assignments` (one active row per property; partial unique index `property_assignments_one_active`, migration 0005); assignment UI `app/(admin)/admin/properties/[id]/assignment-card.tsx` + `lib/assignments/plan.ts`; routing dials the single active `primary_agent_id` in `lib/voice/*`. The `backup_agent_id` column is **not** this feature.

**Fix sketch.** Add a property→agents **roster** (many-to-many) + a per-property **on-shift pointer** (or a dated shift schedule) that selects which roster agent is the active `primary_agent_id`. Routing is unchanged (still dials one agent + accepting admins) — this is a *selection layer* over the existing single-active-assignment invariant, not concurrent multi-dial. Admin UI flips the on-shift agent without manual close/reopen.

**Acceptance.** An admin can attach 2–3 agents to a property and flip which one is on-shift for the day; routing dials that agent; no concurrent same-pod dialing; the single-active-assignment invariant still holds.

---

### Twilio concurrent-call cap = 1 → re-enable parallel multi-target dial

**Status:** open (deferred to v2 by Kumar, 2026-06-22) · **Raised:** 2026-06-19 (§A root-cause) · **Pilot workaround:** routing presence-gates the dial, so with one reachable agent the fan-out collapses to a single leg that fits the cap — the v1 single-agent voice smoke passes this way.

**Problem.** The Twilio account's concurrent-call limit is **1** (console-confirmed; an account setting, not derivable from code). Routing fires a parallel `<Dial>` to the property's assigned primary agent + admins with `accepting_calls=true`; at cap 1 only one outbound leg is placed and the rest are rejected (Twilio error **10004**). The presence gate (shipped `2072105` / `d18d452`) makes this safe for the pilot by only dialing *reachable* agents, so a single online agent → one leg → connects every time; but **multi-agent fan-out cannot work until the cap is raised**.

**Why it matters.** Multi-agent coverage (primary agent + admin backup ringing simultaneously, first-answer wins) is the intended routing behavior; it's blocked purely by the account cap. The pilot accepts single-agent routing.

**Where it lives.** `app/api/twilio/voice/incoming/route.ts` (`planDial` + `resolvePrimaryAgent` / `resolveAvailableAdmins`); `lib/voice/presence.ts` (`isReachableForDial`). The fan-out code is already written and capped at `MAX_DIAL_TARGETS` (10) — raising the Twilio cap re-enables it with **no code change**.

**Fix sketch.** Confirm/raise the Twilio concurrent-call limit (business verification submitted ~2026-06-19). Once raised, re-run a multi-agent voice smoke (2+ reachable targets ring in parallel, first-answer wins).

**Companion (also deferred).** Harden routing to gate on **real Twilio Device registration** state, not just the 20s presence heartbeat — the heartbeat lags Device-down by up to 90s, so a just-closed browser is dialed into a 0s-fail leg (observed 2026-06-19). Was the lower-priority §A follow-up in `docs/v1-punchlist.md`.

**Acceptance.** With the cap raised, a call rings 2+ reachable targets simultaneously and the first to answer wins; the others stop ringing; no 10004 alerts.

---

## Hosting cost / architecture (scale)

### Polling → Supabase Realtime (push) — make hosting cost track calls, not fleet size

**Status:** **partially shipped** — (1) incoming-call push DONE in **v1.2** (2026-06-28, branch `realtime-incoming-call`): the 3s `/api/calls/incoming-video` poll replaced by a content-free `calls-changed` broadcast on a private per-operator channel + refetch, behind a 60s safety-net poll; migration 0018 (RLS on `realtime.messages`) applied to prod. Spec/plan: `docs/specs/2026-06-28-realtime-incoming-call-design.md` · `docs/plans/2026-06-28-realtime-incoming-call.md`. **Remaining open:** (2) presence, (3) kiosk liveness, (4) dashboards. · **Pilot workaround:** stay on free / upgrade Vercel Pro for the auto-pause cliff; cost is fine at 1 property.

**v1.2 follow-ups (small):** (a) `IncomingVideoBanner` does not re-call `realtime.setAuth()` on `TOKEN_REFRESHED`/`onAuthStateChange` — for a long-lived agent tab a stale socket JWT could bounce the subscribe; it self-heals via the `CHANNEL_ERROR` resubscribe + the 60s cookie-authed fallback, so worst case is bounded latency, not a missed ring. (b) Harden the Realtime channel by turning OFF Supabase "Allow public access" (Realtime Settings) so the operator topic can't be joined as a non-private channel — non-blocking in v1 (single-tenant, content-free nudge).

**Problem.** Per decision #4 the app polls (20s dashboards/presence, ~~3s incoming-video~~ → now push, **30s** kiosk heartbeat 24/7). Cost therefore scales with **devices online × time**, decoupled from actual call volume — and each poll double-bills (a Vercel function invocation *and* a Supabase query). Pilot portal already burned **3h 3m / 4h** free Fluid Active CPU in 30 days at one property; at 20 properties / 5–10 agents this balloons.

**Why it matters.** At fleet scale the bill is dominated by idle polling, not work. Realtime (already in the stack, idle-cheap, ~30 connections needed vs ~200 free) makes both the Vercel and Supabase bills track real calls, and makes the product snappier.

**Where it lives.** `app/api/calls/incoming-video` + `components/video-call/incoming-video-banner.tsx` (3s poll); `components/softphone/softphone.tsx` + `app/api/presence` (20s presence); `apps/kiosk/src/App.tsx` + `app/api/kiosk/heartbeat` (30s); `components/auto-refresh.tsx` (20s dashboards). Reverses **locked decision #4**.

**Fix sketch.** Brainstorm → spec → plan. Priority: (1) incoming-call push (biggest), (2) presence, (3) kiosk liveness, (4) dashboards via "subscribe + refetch-on-change". Keep low-frequency request/response on Vercel.

**Full context:** `docs/handoffs/2026-06-28-realtime-and-hosting-cost-handoff.md`.

### Owner-home N+1 query (cheap standalone fix)

**Status:** open · **Raised:** 2026-06-28 · **Pilot workaround:** none needed (tiny at 1 property).

**Problem.** `app/(owner)/owner/page.tsx:193` fires 2 queries per property (count + last-call) via `props.map(async …)` → ~2N queries per load (40 at 20 properties). Agent + admin dashboards are NOT N+1 (Phase 3 optimized).

**Fix sketch.** Mirror the agent/admin pattern — one batched `.in("property_id", propIds)` fetch of today's calls, then count + last-call per property in memory → 2N becomes 2. Small, low-risk, independent of the realtime work.

### Mid-call resume across an agent reload (grace window)

**Status:** open · **Raised:** 2026-07-06 (Phase-4 staging smoke, Kumar) · **Pilot workaround:** none needed — reload = hang-up is the v1 semantic on BOTH providers.

**Observation.** Reloading the agent/admin tab during a live video call ends the call for both sides. Root cause is design, not a bug: page unload drops the participant → the kiosk's `onAgentLeft` fires → `endCall(callId, "completed")` finalizes the row instantly. Byte-identical behavior on Agora (pre-Phase-4 prod) and LiveKit. LiveKit's D9 duplicate-identity rule prevents ZOMBIE collisions on rejoin; it is not a resume feature — nothing re-mounts an in-progress call after reload, and the kiosk has already finalized. (Network blips WITHOUT a reload do survive via the SDK's same-session auto-reconnect.)

**Fix sketch (v2).** Kiosk-side grace window on agent-left (e.g. 10-15s "reconnecting the agent" state before finalizing) + portal-side re-offer: after reload, detect an IN_PROGRESS call `handled_by` self and re-mount the overlay straight into a rejoin (D9 then kicks the stale participant if any). Intersects the ChunkLoadError/mid-shift-deploy reload-guard carry-forward — a deploy-driven reload mid-call is the same wound. Design both together.
