# 6c — Emergency Call (911 conference) — design

**Date:** 2026-06-02
**Status:** approved (brainstorm), plan next
**Decomposition:** Plan 6 = **6a** (kiosk + live video, done), **6b** (playbook, done), **6c** (this — emergency call). Each gets its own spec → plan → build → tag.

## 0. What changed from the 6a §9.2 placeholder

The 6a spec parked emergency calling with three actions (conference emergency services, alert the on-call manager via SMS + call, log an incident) and two caveats (remote-agent 911 jurisdiction; kiosk guest has no PSTN leg). The 2026-06-02 brainstorm **re-scoped** this:

- **Emergency is about the inbound *phone* call from a hotel guest** (the 5a/5b PSTN → agent-softphone path), **not** the kiosk video call. The kiosk/video emergency path is **dropped**. This dissolves the "kiosk guest has no PSTN leg" caveat — the guest is already on a Twilio PSTN leg, so a real conference works.
- **The jurisdiction caveat is solved at the Twilio platform level**: the pilot property's street address is registered to the Twilio number as an Emergency Calling Address (confirmed in the Twilio console — 11935 N I-35 Service Rd, Oklahoma City, OK). 911 dialed *from that number* routes to the Oklahoma City PSAP. No per-property emergency-number DB field is needed for v1.
- **No SMS. No on-call-manager alert.** v1 does exactly one escalation — the 911 conference — plus a logged incident. (Manager alert / SMS remain schema-and-structure-friendly to add later.)
- **Topology: 3-way relay** — guest + agent + 911 dispatcher; the agent stays on to relay the address, room number, and context.

## 1. Verification already done (do not re-litigate)

The load-bearing unknown — *will Twilio let an emergency call join a `<Conference>`?* — was settled empirically on 2026-06-02 with a throwaway probe (since deleted), using **933** (the E911 address-readback **test** number; Twilio lists it as a supported emergency number for US/CA, and it never contacts a PSAP or dispatches responders):

- A `client.conferences(name).participants.create({ from: <registered number +14058750410>, to: '933' })` call was **accepted** by Twilio; the 933 leg reached `in-progress` inside the conference.
- The human participant on the other leg **heard the registered address read back inside the conference** → the emergency leg's audio bridges into the conference end-to-end.

**Conclusion:** conferencing an emergency leg works. Approach B (below) is viable. The probe used the exact production mechanism for adding the emergency leg (REST Participants API with `to` = an emergency number, `from` = the registered number).

**Sources:**
- [Twilio — Emergency Calling for Programmable Voice](https://www.twilio.com/docs/voice/tutorials/emergency-calling-for-programmable-voice) ("the `To` parameter must be the emergency number `911`, `933` or `112`"; "Any emergency call must come with a valid E.164-formated `From` number").
- [Twilio — Emergency telephone numbers](https://www.twilio.com/docs/voice/tutorials/emergency-calling-for-programmable-voice/emergency-telephone-numbers) (933 listed for US/CA).
- [Bandwidth — The 933 service](https://support.bandwidth.com/hc/en-us/articles/210291778-The-933-service) and [Level365 — Using 933 to Verify Emergency Address](https://support.level365.com/hc/en-us/articles/360039009292-Using-933-to-Verify-Emergency-Address) (933 reads the registered address back; no PSAP, no dispatch).

## 2. Scope

**Ship in 6c:**
- An **Emergency** control in the softphone in-call UI (AGENT + ADMIN), behind a confirmation dialog.
- `POST /api/calls/[id]/emergency` that merges the live guest+agent call into a Twilio Conference and adds a 911 leg with the property's registered caller ID.
- A `dial-result` branch that routes the guest into the emergency conference.
- A high-priority **incident** record + an audit row.
- An `EMERGENCY_DIAL_NUMBER` env override so all dev/pilot testing dials **933**, never real 911.

**Out of scope / deferred (schema- and structure-ready):**
- Kiosk/video emergency (dropped — the video-overlay Emergency button is removed).
- On-call-manager alert, SMS, PagerDuty.
- Incident **resolve** workflow + owner-portal display (Plan 7).
- Per-property emergency number / multi-property emergency caller-ID selection (single registered number in v1; the code keys caller ID off `properties.routing_did`, which generalises later).
- Recording of emergency calls (explicitly **not** recorded).

## 3. Locked decisions

1. **Trigger context**: active **inbound AUDIO** call only; from the softphone in-call UI. Removed from the video overlay.
2. **Topology**: 3-way relay — guest + agent + 911. Agent stays (can leave; conference does not end on the agent's exit).
3. **911 routing**: literal `911` (prod) with caller ID = the property's registered Twilio number; PSAP routing is a property of that number's registered address.
4. **Test safety**: `EMERGENCY_DIAL_NUMBER` env, default `'911'`, set to `'933'` for all dev + pilot smoke testing. Flip to `911` only at go-live.
5. **No SMS, no manager alert** in v1.
6. **Incident model**: a dedicated `incidents` table (not just `audit_logs`), inserted OPEN/HIGH in 6c; lifecycle + display deferred to Plan 7. An `audit_logs` row is also written, per the audit-everything convention.
7. **Architecture**: Approach B — keep the 5a/5b ring/first-wins path untouched; merge into a conference on trigger via the existing `<Dial action>` seam.

## 4. Architecture — the conference choreography (Approach B)

`POST /api/calls/[id]/emergency` (session-authed; service-role DB + Twilio REST):

1. **Auth + guard** (pure `canTriggerEmergency`): caller is the call's `handled_by_user_id`; call `state='IN_PROGRESS'`, `channel='AUDIO'`; `emergency_conference_name IS NULL` (idempotency). Operator-scoped.
2. **Stamp first**: set `calls.emergency_conference_name = 'emg-<callId>'`. Done *before* the redirect so the `dial-result` webhook (step 5) observes it.
3. **Find the agent leg**: `client.calls.list({ parentCallSid: <calls.twilio_call_sid = guest inbound SID> })` → the in-progress child leg (the agent's `<Client>` answer leg).
4. **Redirect the agent leg into the conference**: `client.calls(agentLegSid).update({ twiml: '<Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">emg-<callId></Conference></Dial></Response>' })`.
5. **Guest follows via the existing action seam**: redirecting the agent leg ends the guest's `<Dial><Client>` → the guest leg proceeds to its `action` URL (`/api/twilio/voice/dial-result`). That route, seeing `emergency_conference_name` set on the matched call row, returns guest **conference TwiML** (same conference) and does **not** mark the call terminal. (Only change to `dial-result`: one branch at the top; when the stamp is null, behavior is unchanged.)
6. **Add the 911 leg**: `client.conferences('emg-<callId>').participants.create({ from: <getEmergencyCallerId(property)>, to: <getEmergencyDialNumber()> })`. (Verified mechanism.)
7. **Persist**: insert `incidents` (OPEN, HIGH, with conference name/sid, emergency leg sid, `dispatched_to`) + `audit_logs` (`trigger_emergency`, entity_type `call`, entity_id = callId). `revalidate`/return state to the client.

Conference participant flags: `startConferenceOnEnter=true` for guest/agent so the conference begins immediately; `endConferenceOnExit=false` for all so the guest+911 continue if the agent drops. Conference ends when empty (Twilio default).

### 4.1 Fallback (agent leg not found / redirect fails)
If step 3/4 fails, redirect the **guest parent leg** directly into the conference (`client.calls(<guest SID>).update({ twiml: conference })`) and add 911. The agent drops, but the **guest still reaches 911** (guest safety wins). Record the degraded path on the incident (`notes`).

### 4.2 If the 911 add (step 6) fails
Surface the error to the agent UI; mark the incident failed (`notes`). The conference still holds guest+agent, so the agent can instruct the guest to hang up and dial 911 directly. Never silently swallow.

## 5. Schema — migration `0008_incidents_emergency.sql`

Committed before applied; local-only, consistent with 0001–0007.

**Alter `calls`:**
```sql
alter table calls add column if not exists emergency_conference_name text;
```
Null = normal call. Non-null doubles as the "this call went emergency" flag that `dial-result` keys on and that the call list can surface later.

**New `incidents` table** (operator-scoped, every-table-has-operator_id convention):
```sql
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id),
  call_id uuid references calls(id),
  triggered_by uuid references profiles(id),          -- the agent
  severity text not null default 'HIGH' check (severity in ('HIGH')),
  kind text not null default 'EMERGENCY_911' check (kind in ('EMERGENCY_911')),
  dispatched_to text not null,                         -- '911' (prod) or the test number actually dialed
  conference_name text,
  conference_sid text,
  emergency_call_sid text,                             -- the 911/933 leg SID
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists incidents_operator_recent on incidents(operator_id, created_at desc);
create index if not exists incidents_property on incidents(property_id);
create index if not exists incidents_call on incidents(call_id);
```
`severity`/`kind`/`status` carry single values today but are CHECK-constrained text (per the roles pattern, not enums) so future incident types / a resolve workflow need no destructive migration. 6c only inserts OPEN/HIGH rows.

**RLS** (`0008` continues the `0002`/`0004` patterns): operator-scoped via `current_user_operator_id()`. Read: ADMIN/OWNER in the operator, plus the triggering agent and the property's owner. Write: service role only (the emergency route uses the admin client). If a read policy must check `properties` ownership, use a `SECURITY DEFINER` helper (e.g. reuse `user_owns_property`) to avoid the RLS-recursion trap documented in CLAUDE.md.

Update `packages/shared/src/supabase-types.ts` for the new column + table.

## 6. Files

**New (pure, TDD first):**
- `apps/portal/lib/emergency/dispatch.ts` — `getEmergencyDialNumber()` (env `EMERGENCY_DIAL_NUMBER`, default `'911'`); `getEmergencyCallerId(property)` (→ `property.routing_did`, falling back to env `TWILIO_PHONE_NUMBER` — the verified probe used the latter; the registered-address number must be one or the other and they are the same for the single-tenant pilot).
- `apps/portal/lib/emergency/conference.ts` — `emergencyConferenceName(callId)`; conference TwiML builder(s) for the agent + guest legs (XML-escaped, in the `lib/voice/twiml.ts` style).
- `apps/portal/lib/emergency/guards.ts` — `canTriggerEmergency(call)` pure predicate.
- `apps/portal/lib/twilio/conference.ts` — `findAgentLeg(client, parentSid)`, `addEmergencyParticipant(client, confName, { from, to })`.

**New route:**
- `apps/portal/app/api/calls/[id]/emergency/route.ts` — orchestrates §4 (session auth via `createServerClient`, work via `createAdminClient` + Twilio REST).

**Edits:**
- `apps/portal/app/api/twilio/voice/dial-result/route.ts` — emergency branch at the top (pure decision helper `shouldRouteToEmergencyConference(callRow)` so it is unit-testable).
- `apps/portal/components/softphone/softphone.tsx` — Emergency button in the `in-call` block; confirm dialog via `components/ui/alert-dialog.tsx` ("Trigger 911 emergency response?" → Cancel / "Yes — trigger 911"); active-emergency banner; POST to `/api/calls/[id]/emergency` using `callIdRef.current`; disable the button once triggered.
- `apps/portal/components/video-call/video-call.tsx` — remove the Emergency button + stub dialog (and the now-unused `emergencyOpen` state / `AlertTriangle` import).

**Migration + types:** `supabase/migrations/0008_incidents_emergency.sql`; `packages/shared/src/supabase-types.ts`.

## 7. Testing

**Unit (Vitest, TDD):**
- `dispatch.ts`: default `'911'`; override respected; caller ID from `routing_did`.
- `conference.ts`: deterministic name from callId; well-formed, escaped TwiML.
- `guards.ts` / `canTriggerEmergency`: true only for IN_PROGRESS + AUDIO + not-already-emergency + owned.
- `shouldRouteToEmergencyConference`: true iff the call row has `emergency_conference_name`.

**Route tests** (mock Twilio client + Supabase admin, as in `tests/app/calls/playbook.test.ts`):
- `/emergency`: 401 unauth; 403 not the handler; 409 wrong state / already emergency (idempotent no-op); happy path stamps the column, calls `calls.list`/`calls(...).update`/`participants.create` with expected args, writes `incidents` + `audit_logs`.
- `dial-result`: returns guest conference TwiML and does **not** terminalize when the matched call row has `emergency_conference_name`; unchanged otherwise.

**Manual smoke (pilot, `EMERGENCY_DIAL_NUMBER=933`):** real inbound call → agent answers → Emergency → confirm → all three (guest + agent + 933) hear the address readback; `incidents` row written; `calls.emergency_conference_name` set. This end-to-end run also exercises the live-leg redirect (the §8 residual risk). Flip to `911` only at go-live.

## 8. Residual risk

The probe verified the genuinely uncertain part — Twilio **will** conference an emergency leg and its audio bridges. It did **not** exercise §4 steps 4–5: redirecting a *live, already-bridged* leg into a conference and letting the guest fall through `dial-result`. That is **standard Twilio call redirection** (well-trodden, much lower risk than the emergency-conferencing question), covered end-to-end by the §7 smoke test, with the §4.1 fallback (redirect the guest parent directly) as the backstop. The plan should run the smoke against 933 before declaring 6c complete.

## 9. Forward-compat seams

| Future feature | Seam left in 6c |
|---|---|
| Incident resolve + owner display (Plan 7) | `incidents.status`/`resolved_at` exist; owner-portal read policy + UI added later. |
| On-call-manager alert / SMS | Add outbound Twilio flow(s) on trigger; no schema change required (or a `properties.emergency_manager_phone` column later). |
| Multi-property emergency caller ID | Caller ID already keyed off `properties.routing_did`; each property registers its own number's address. |
| More incident types / severities | `kind`/`severity` are CHECK-constrained text — widen the constraint, no destructive migration. |
| Status page / observability (Plan 8) | `incidents` is operator-scoped and indexed by recency; surface counts/feed later. |
