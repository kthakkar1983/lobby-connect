# Plan 5a — Voice Path (Backend) Design

- **Status**: Approved (brainstorm complete)
- **Date**: 2026-05-30
- **Spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (§4 critical path, §5.5, §5.6, §7)
- **Builds on**: Plan 4c (Assignments + call availability) — tag `plan-04c-assignments-availability-complete`
- **Setup guide**: `docs/setup/2026-05-30-twilio-voice-setup.md` (manual Twilio console steps + credentials to gather)

---

## 1. Purpose

Stand up the **inbound audio call path** end-to-end on the server: a guest dials a property's phone number, Twilio hits our webhook, we identify who should answer, and we return parallel-dial TwiML that rings their browser softphones. This plan delivers everything Twilio's servers can exercise **without a browser** — the webhook routes, the routing/dedup logic, the TwiML, and the `calls` records.

It deliberately stops short of the softphone. The browser Twilio Device, the access-token route, the incoming-call UI, in-call controls, and presence all land in **Plan 5b**.

Plan 5 was split into **5a (backend voice path)** and **5b (agent dashboard softphone)** during brainstorming. This is 5a.

---

## 2. Scope

**In:**

- `lib/voice/`: pure, unit-tested identity derivation, dial planning (with dedup), and TwiML builders.
- `lib/twilio/`: SDK/config glue — env validation + HMAC request verification.
- Webhook routes: `/api/twilio/voice/incoming`, `/dial-result`, `/status`.
- `calls` row lifecycle: insert on ring, finalize on result/status, idempotent on `CallSid`.
- `twilio_identity` provisioning: deterministic derivation, set at user creation (invite) for AGENT/ADMIN, added to `seed.sql` for seeded call-takers.
- Twilio account/number provisioning (manual, documented in the setup guide) + env wiring + local tunnel workflow.

**Out (deferred / forward-compat preserved):**

- `/api/twilio/token` and the browser Twilio Device — **Plan 5b** (only ever called by the softphone, which doesn't exist yet).
- Agent dashboard UI, incoming-call banner, in-call controls (mute / hangup / room # / notes) — **Plan 5b**.
- `handled_by_user_id` population — **Plan 5b** (the browser reports who answered).
- Presence (`last_seen_at` heartbeat, 1-min OFFLINE cron) — **Plan 5b** keep/cut.
- **Call recording** — cut from v1. `recording_url` / `recording_sid` columns and a `/recording-status` sibling route stay reserved; not wired. Re-enable later without a migration.
- Kiosk / video path — Plan 7.

---

## 3. Locked Decisions

### 3.1 Pure logic in `lib/voice/`, thin route handlers

Mirrors the established `lib/assignments/plan.ts` → `actions.ts` pattern. Routing/dedup/TwiML are pure functions unit-tested before any route is wired. Rejected alternative: logic inline in route handlers (integration-tested only) — breaks the TDD-first convention and makes dedup/TwiML untestable without a live call.

### 3.2 Node.js runtime + service-role DB access in webhooks

Each webhook route sets `export const runtime = 'nodejs'` so the official Twilio Node SDK works (no Edge/Web-crypto workarounds). A Twilio request carries no user session, so webhooks use the **service-role** Supabase client — consistent with the "service role only where genuinely needed (Twilio webhooks, cron, admin invite)" rule.

### 3.3 Parallel-dial target set + dedup

`/incoming` loads, scoped by `operator_id`:

1. **Property** by `routing_did = To` (active only).
2. **Primary agent** = the active assignment (`effective_until IS NULL`) → that profile **if** active and has a `twilio_identity`. An assigned agent is **always** a dial target (agents have no per-property accepting toggle).
3. **Available admins** = `admin_call_availability` rows with `accepting_calls = true` for this property, joined to active ADMIN profiles in the same operator with a non-null `twilio_identity`.

`planDial(primaryAgent, availableAdmins)` returns `DialTarget[]`, **deduplicated by `twilio_identity`** so an admin who is both the primary agent and accepting-for-this-property is dialed **once** (the requirement carried over from the 4c status note). Empty result → no `<Dial>`, immediate apology.

### 3.4 `twilio_identity` provisioning

- **Value**: deterministic, derived from the user id via `toTwilioIdentity(userId)` in `lib/voice/identity.ts`, format `lc_<uuid-without-dashes>`. Pure, collision-free, URL-safe. Plan 5b's token route will reuse the same function so the Device identity matches what routing dials.
- **When**: set at user creation (invite action) for **AGENT and ADMIN**; **null for OWNER** (owners never take calls, never a dial target — the null encodes "cannot receive calls" and structurally prevents accidentally dialing an owner).
- **Seed**: `seed.sql` sets `twilio_identity` for the seeded admin (`…b1`) and agents (`…b3`, `…b4`); owner (`…b2`) stays null. A local call works right after `supabase db reset`.
- **No backfill migration**: prod has no real users yet (not pushed). Invite-action + seed changes cover all cases going forward. A guard in the invite logic ensures AGENT/ADMIN always get an identity and OWNER never does (unit-tested).

### 3.5 Call lifecycle, idempotent on `CallSid`

- **`/incoming`**: HMAC-verify → load → `planDial`. If a `calls` row already exists for the `twilio_call_sid`, reuse it (Twilio retries webhooks); else insert `calls` (channel=AUDIO, state=RINGING, `twilio_call_sid`, `caller_number`=From, `property_id`, `operator_id`, `ring_started_at`=now). Return TwiML.
- **`/dial-result`** (`<Dial action>`): `DialCallStatus=completed` → `<Hangup/>` + finalize. Otherwise (`no-answer`/`failed`/`busy`) → apology TwiML + mark `NO_ANSWER`.
- **`/status`** (call status callback): authoritative finalizer — sets `state` (COMPLETED/FAILED), `answered_at`, `ended_at`, `duration_seconds` from `CallDuration`. Idempotent; only writes if not already finalized.

### 3.6 Guest experience

A brief `<Say>` ("Connecting you to the front desk, one moment…") then `<Dial timeout="120" action="/dial-result">` with deduped `<Client>` children. Guest hears standard ringback during the window. No hold music in v1.

### 3.7 Apology / error messaging

`lib/voice/twiml.ts` exposes `buildApologyTwiml()` and a `buildNotInServiceTwiml()` that **return the same generic text in 5a** ("We're sorry, no one is available right now…"). Keeping them as two separate functions preserves the seam: switching "number not in service" to a distinct message later is a one-line change + one snapshot update — no migration, no Twilio reconfig. Forward-compat to admin-editable copy via `operator_settings.apology_audio_url` is preserved.

### 3.8 Empty dial list → immediate apology

No agent assigned **and** no admin accepting → skip `<Dial>`, play apology, mark `NO_ANSWER`. No point ringing nobody for 120s.

### 3.9 Pilot number = a purchased **local** number; single Twilio account

- Buy a **local** number (pilot property's area code) and use it as the pilot property's `routing_did`. Cheaper inbound than toll-free (~$0.0085/min vs ~$0.02–0.03/min), no toll-free verification, local presence. Requires upgrading the trial account (add payment) — also removes the trial preamble/limits. Release the trial 855.
- **Single Twilio account** for v1 (single tenant). Subaccounts deferred to v2 as the per-`operator_id` multi-tenant hook.

---

## 4. File Layout

**New:**

```
apps/portal/lib/voice/identity.ts            # toTwilioIdentity(userId) — pure
apps/portal/lib/voice/identity.test.ts
apps/portal/lib/voice/plan-dial.ts           # planDial(primaryAgent, availableAdmins) → DialTarget[]
apps/portal/lib/voice/plan-dial.test.ts
apps/portal/lib/voice/twiml.ts               # build{Incoming,Apology,NotInService,Hangup}Twiml
apps/portal/lib/voice/twiml.test.ts          # snapshot the generated XML
apps/portal/lib/twilio/config.ts             # validated TWILIO_* env access
apps/portal/lib/twilio/client.ts             # SDK setup + validateRequest (HMAC) wrapper
apps/portal/app/api/twilio/voice/incoming/route.ts
apps/portal/app/api/twilio/voice/dial-result/route.ts
apps/portal/app/api/twilio/voice/status/route.ts
docs/setup/2026-05-30-twilio-voice-setup.md  # manual console steps + credentials
```

**Modified:**

```
supabase/seed.sql                            # set twilio_identity on …b1/…b3/…b4
apps/portal/app/(admin)/admin/users/actions.ts   # set twilio_identity on invite (AGENT/ADMIN)
apps/portal/lib/users/...                     # identity guard helper + test (AGENT/ADMIN yes, OWNER no)
apps/portal/.env.example                      # document TWILIO_* vars
```

---

## 5. Pure-Function Surface (`lib/voice/`)

```ts
// identity.ts
toTwilioIdentity(userId: string): string            // `lc_${uuidNoDashes}`

// plan-dial.ts
type DialTarget = { identity: string };
type DialInput  = {
  primaryAgent: { id: string; twilioIdentity: string } | null;
  availableAdmins: { id: string; twilioIdentity: string }[];
};
planDial(input: DialInput): DialTarget[]             // merge + dedup by identity; may be []

// twiml.ts
buildIncomingTwiml(targets: DialTarget[], opts: {
  greeting: string; timeoutSeconds: number; actionUrl: string;
}): string                                           // <Say> + <Dial><Client>…  (or apology if targets empty)
buildApologyTwiml(message: string): string           // <Say> + <Hangup/>
buildNotInServiceTwiml(message: string): string      // 5a: same text as apology
buildHangupTwiml(): string                           // <Hangup/>
```

Routes call these; the builders touch neither the Twilio SDK nor the DB.

---

## 6. Route Behavior Summary

| Route | Trigger | Action |
|---|---|---|
| `incoming` | Guest calls the property DID | HMAC-verify → load property/agent/admins → `planDial` → insert/reuse `calls` (RINGING) → return incoming or apology TwiML |
| `dial-result` | `<Dial>` completes | `completed` → `<Hangup/>` + finalize; else apology + `NO_ANSWER` |
| `status` | Call status callback | Finalize `state`/`answered_at`/`ended_at`/`duration_seconds`; handle FAILED; idempotent |

All three: `runtime = 'nodejs'`, service-role client, reject on bad HMAC signature, return valid TwiML even on internal error where possible (fail to a generic apology, never a 500 to the caller).

---

## 7. Testing Strategy

**Unit (Vitest, no DB) — written first:**

- `toTwilioIdentity`: deterministic, stable format, idempotent.
- `planDial`: agent-only, admins-only, agent+distinct-admins, agent==accepting-admin (deduped to one), nobody reachable (`[]`).
- `twiml`: snapshot `incoming` (with N clients), `apology`, `not-in-service`, `hangup`; verify timeout/action attributes.
- Invite identity guard: AGENT/ADMIN get an identity, OWNER does not.

**Route-level:**

- Forged/invalid HMAC signature is rejected.
- `/incoming` idempotency: same `CallSid` twice → one `calls` row.

**Live smoke (the real 5a artifact)** — no softphone registered yet:

1. Call the pilot local number from a phone → hear "connecting…" → ringback for 120s → apology → hang up.
2. Local Supabase: a `calls` row exists, `state=NO_ANSWER`, correct `caller_number`, `property_id`, `operator_id`, `ring_started_at`/`ended_at`.
3. Idempotency confirmed (Twilio retry does not duplicate the row).
4. (Optional) Temporarily set one seeded user's `twilio_identity` and confirm the generated TwiML lists the right `<Client>` identities via Twilio call logs / request inspector.

**Gates:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all green before tagging.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Tunnel URL changes each session | Documented re-point step in the setup guide; start-of-session checklist. |
| Trial-account preamble/limits muddy testing | Upgrade account + buy local number (3.9) before live smoke. |
| Webhook throws → caller hears a 500 | Catch and fall to generic apology TwiML; log to Sentry. Never return non-TwiML to Twilio. |
| Duplicate `calls` rows on Twilio retry | Idempotency keyed on `twilio_call_sid` (3.5). |
| `twilio_identity` missing for a real call-taker | Invite-action + seed set it; routing filters null identities defensively; guard unit-tested. |
| Cost surprise | Voice billed per-minute rounded up (cents, not dollars); verify exact price in Console → Monitor → Logs → Calls. |
| Migrations 0001–0005 still local-only | Unchanged by 5a (no new migration). Standing "apply before push" policy still holds. |

---

## 9. Non-Goals

- Browser softphone, token route, in-call UI (Plan 5b).
- `handled_by_user_id`, presence, recording.
- Outbound calling, voicemail, callback queue.
- Any kiosk/video work.

---

## 10. Definition of Done

- `lib/voice/` + `lib/twilio/` implemented; all unit + route tests green.
- Three webhook routes return correct TwiML and write/finalize `calls` idempotently.
- `twilio_identity` set on invite (AGENT/ADMIN, not OWNER) + in `seed.sql`; guard tested.
- Twilio provisioned per the setup guide; pilot local number wired as `routing_did`; env populated; tunnel workflow documented.
- Live smoke (§7) complete: real call → apology → correct `NO_ANSWER` `calls` row in local Supabase.
- `pnpm test` / `lint` / `typecheck` / `build` clean.
- Committed and tagged `plan-05a-voice-backend-complete` on local `main` (not pushed, per the standing deploy/prod-DB policy).
- No new migration; no schema change.
