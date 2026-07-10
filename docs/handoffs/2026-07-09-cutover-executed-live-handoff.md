# Handoff — Phase-5 cutover EXECUTED; pilot is LIVE on the box — START HERE

**Written:** 2026-07-09. **Supersedes:** `2026-07-08-phase5-cutover-ready-handoff.md`. The stack-consolidation migration is **DONE**. The pilot hotel now runs entirely on the owned DigitalOcean box; Vercel/Agora is a frozen warm standby for ~2 weeks, then decommission.

## The one-line state

Everything moved to the box in one session and is verified live. **Stack consolidation is complete.** The only remaining migration work is the ~2-week standby window → decommission. Otherwise we're back to product work (see the next-session agenda).

## What went live (current pointer state)

| Pointer | Now points at |
|---|---|
| Twilio voice webhooks (incoming + status) | `https://app.lobby-connect.com/api/twilio/voice/*` (the box) — **two-way audio confirmed** |
| Pilot tablet (kiosk) | `https://kiosk.lobby-connect.com` (the box, LiveKit) |
| Agents/admins | `https://app.lobby-connect.com` (the box) |
| Supabase Auth | `app.lobby-connect.com/**` added to redirect allowlist; **Site URL left on Vercel** (cosmetic — password auth doesn't use it) |
| Prod Supabase | at **0020** (0019+0020 applied via MCP this session) |

**Frozen Vercel standby stays as instant rollback:** portal `dpl_7PQ1P7Ui41UD8wrpZrV3FZ2koj6y` + kiosk `dpl_FxZhsJQVLEUn5V2M81gBwvKch5Mu`, both `main@f4af480`, still Agora, git-disconnected. **Rollback = flip Twilio webhooks + the tablet bookmark back to the `*.vercel.app` URLs** (the shared DB never forks). Reversal of the freeze = `vercel git connect`.

## Verified live this session

Login · LiveKit video call · **push armed (VAPID baked correctly)** · duty on/off · RustDesk **Connect** from a property card AND mid-call · CORS bake (`access-control-allow-origin: https://kiosk.lobby-connect.com` on `/api/kiosk/*` + `/api/video/*`) · real Let's Encrypt certs on `app.`/`kiosk.` · crons (reaper `*/15` + presence daily, both self-reporting to `health_signals`) · kiosk pairing (`KIOSK_CONFIG_SECRET` correct) · **R1 CLEARED** — the box's first-ever Twilio-through-Traefik call HMAC-verified and connected two-way.

## The one real snag — the login incident (keep this playbook for hotel #2)

After the first deploy, sign-in failed with "invalid email or password." Three layers, peeled in order:
1. **`must_change_password = true`** on Kumar's admin account forced a redirect to `/onboarding` (felt like "can't log in"). Each **admin password-reset re-armed the flag** → a loop. Fixed by setting it `false` via MCP.
2. **Password uncertain** after multiple resets → set directly (Kumar ran `UPDATE auth.users SET encrypted_password = extensions.crypt('<new>', extensions.gen_salt('bf',10))` in the Supabase SQL editor; GoTrue uses standard bcrypt `$2a$`).
3. **The actual fix: re-set the Supabase env vars on `lc-portal-prod` + REDEPLOY.** (Kumar confirmed all values matched the Vercel prod pull; the box *was* on prod — the redeploy is what took, a stale/first-build issue.)

**Diagnostic playbook that isolated it (all via the Supabase MCP on prod `ztunzdpmazwwwkxcpyfp` + `curl`):**
- `auth.users` ⋈ `profiles` → account state (`must_change_password`, `active`, `last_sign_in_at`, `banned_until`).
- `get_logs service=auth` → GoTrue request stream.
- `health_signals` → cron + `twilio_webhook` heartbeat freshness (proved the box took a real Twilio call).
- `curl -sI …/api/kiosk/config | grep access-control-allow-origin` → the KIOSK_ORIGIN bake; `openssl s_client … | openssl x509 -issuer` → cert.

**Env lessons (also in `docs/setup/2026-07-09-part5-env-codegrounded.md`):**
- Build-time vars (`NEXT_PUBLIC_*`, `KIOSK_ORIGIN`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) are baked at `next build` → wrong at build = **silent browser breakage**; fix needs a **redeploy**, not a restart. `KIOSK_ORIGIN` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` have **no Dockerfile `ARG`** → they rely 100% on Coolify's **"Available at Buildtime"** flag (the new UI's name for the old "Build Variable").
- **`CRON_SECRET` comes down EMPTY from `vercel env pull`** → don't use the Vercel value; set `lc-portal-prod`'s = **`lc-ops`'s** value so the box crons authenticate (verified: `prod-reaper` "Run now" → success).
- `BUILD_STANDALONE` is hardcoded in `apps/portal/Dockerfile` — don't set it in Coolify.

## Non-blocking bug — TRACKED (spawned task `task_71d65b0a`)

After a **video** call ends, the agent can get stuck "on duty but not accepting calls" until they toggle. Root cause traced: **`/api/calls/[id]/end-video` writes no status** (it doesn't reset the agent from `ON_CALL`, unlike `answer-video/route.ts:40` which sets it) → recovery relies on the softphone heartbeat, which is **throttled while the browser tab is backgrounded behind foregrounded RustDesk**. Fix later = symmetric presence reset in `end-video` respecting the D13 duty/accepting rules. **Not consistently reproducible; batch into a debug session** (Kumar's call: wait for a few minor issues to pile up or a major one). Same on Vercel — not a migration issue. Workaround: the toggle.

## Night-1 smoke still to run (runsheet §6)

The things **never live-tested** or that are the real gates — have Dilnoza exercise on her shift:
- **Video on the real iPad** (India calls) — the **video-quality gate** (the Mac was a pessimistic software-H.264 proxy; the iPad's hardware H.264 is the truth).
- **Push ring behind fullscreen RustDesk** · **Connect from the AUDIO in-call overlay** (never live-tested) · **call tile / white-bar dock** watch.
- **Live 933 emergency test:** set `EMERGENCY_DIAL_NUMBER=933` on `lc-portal-prod` → restart → test → **revert to `911`** → restart.
- **RustDesk relay:** Dilnoza a clean full shift through `relay.lobby-connect.com` = the Phase-2 done-when.

## Still open / deferred

- **~2-week warm-standby window → then decommission (runsheet §8):** close Vercel + Agora accounts, revoke the two `lc-claude` API tokens, DO auto-backups ON, Supabase Pro, cut the milestone tags (`plan-phase1-box-staging-complete`, `plan-phase2-relay-complete`, a Phase-5 complete tag), lift the `agora_channel_name`-rename ban. Stamp the migration plan Phase-5 steps DONE.
- **Credential-hardening** (encrypt-at-rest + fail-closed issuance audit for `property_remote_access`) — resequenced to **post-pilot-cutover / pre-second-hotel** (migration plan step 5). Its own small spec→build. `docs/security-posture.md` §6.5 still describes the current weak state — reconcile when it lands.
- **Standby invariants (in force until decommission):** additive-only migrations (shared DB never forks) · do NOT rename `agora_channel_name` · Vercel `AGORA_*` envs + the Agora account STAY · `KIOSK_CONFIG_SECRET` byte-identical box↔Vercel · Vercel prod stays frozen/untouched.

## NEXT-SESSION AGENDA (Kumar, 2026-07-09)

1. **Copy + UI polish pass** — fold in the deferred items: `[[dashboard-layout-rework-deferred]]` (softphone-tile / empty-column / audio-video surfacing), the call-tile Reopen-button reposition+color, audio↔video ⏎-parity.
2. **Simple time-tracking** — "Go on duty" / "End shift" already function as clock-in/clock-out, so surface **shift durations / a timesheet**. The presence events + `POST /api/presence/{go-on-duty,end-shift}` are the data source (currently no shift-history persistence — a new lightweight table is the likely seam). Brainstorm scope first.
3. **Outbound calls on the agent dashboard** — how it works + **pod attribution**: when an agent places an outbound call, *which hotel in their pod "picks up the tab"* (which `property_id` the call is attributed/billed to). Needs a real brainstorm → design (Twilio outbound leg + caller-ID choice + the property selector on the agent dashboard + the `calls` row attribution).

## Docs of record

- **Operator playbook (EXECUTED):** `docs/setup/2026-07-08-phase5-cutover-operator-playbook.md`
- **Runsheet (why/reference, §6 night-1, §8 decommission):** `docs/setup/2026-07-08-phase5-cutover-runsheet.md`
- **Code-grounded env inventory:** `docs/setup/2026-07-09-part5-env-codegrounded.md`
- **Master migration plan (Phases 0–5):** `docs/plans/2026-07-01-stack-consolidation-migration.md`
- **Box ops runbook:** `docs/setup/2026-07-02-box-ops-runbook.md` · **Credentials register:** `docs/setup/2026-07-03-accounts-credentials-inventory.md`
