# Realtime incoming-call signaling (video) — design

**Date:** 2026-06-28 · **Status:** SHIPPED in v1.2 (branch `realtime-incoming-call`, merged to `main`; migration 0018 applied to prod; live prod smoke pending) · **Branch:** `realtime-incoming-call`

Replaces the 3-second `/api/calls/incoming-video` poll with a Supabase Realtime **broadcast-ping + refetch** signal. This is the first surface in the realtime-migration program described in `docs/handoffs/2026-06-28-realtime-and-hosting-cost-handoff.md`. It is the deliberate, scoped reversal of locked **decision #4** (20s polling, no subscriptions) for this one signaling path.

Presence, kiosk-liveness, and dashboard auto-refresh are explicitly **out of scope** — separate specs that will reuse the plumbing proven here.

---

## 1. Problem

The agent/admin video banner (`IncomingVideoBanner`) polls `GET /api/calls/incoming-video` every **3 seconds** per open tab, 24/7, to learn when a kiosk guest starts a video call. Each poll is *both* a Vercel function invocation *and* a Supabase query, and the cost scales with **# agents × hours online**, decoupled from actual call volume. At ~20 properties / ~10 agents this is an estimated ~2.9M DB-querying invocations/month doing nothing on a quiet night — the single largest contributor to the portal's Active-CPU burn (handoff: 75% of the free Fluid cap).

Audio incoming is already push (Twilio), so only the **video** path polls.

## 2. Goal

- Ring the agent within ~1–2s of the guest tapping Call, via Realtime **push** instead of a 3s timer.
- Make incoming-call DB/compute load scale with **actual calls**, not idle fleet time.
- Keep the existing scoping, RLS, ringtone, tab-title flash, and accept flow byte-for-byte — only the *freshness trigger* changes.
- Prove the reusable pattern (per-operator channel, server broadcast, channel-auth, reconnect catch-up) for the later presence/kiosk/dashboard specs.

## 3. Non-goals

- Presence heartbeat (`/api/presence`), kiosk-liveness heartbeat, dashboard `AutoRefresh`, owner-home N+1 — all separate.
- Changing call-state machine, finalization, `calls` RLS, the audio path, or the authoritative scoping in `/api/calls/incoming-video`.
- Carrying call data over the channel (the push is a content-free nudge; see §4).

## 4. Architecture — broadcast-ping + refetch

**One private per-operator Broadcast channel:** topic `operator:{operatorId}:calls`. The `{operatorId}` segment is the decision-#6 multi-tenant seam — v1 has one operator, but the channel and its RLS are operator-scoped from day one.

**The push carries no call data** — just `{ event: "calls-changed" }`. It only *tells the client to refetch*; the authoritative, correctly-scoped list still comes from `GET /api/calls/incoming-video` (unchanged). This keeps all target-property scoping in the one server route we already trust, and makes a duplicate/spurious ping harmless (idempotent refetch).

### 4.1 Publishers (server-side, service-role)

After their existing DB write, these routes fire a best-effort broadcast to the property's operator channel:

| Route | When | Why broadcast |
|---|---|---|
| `/api/kiosk/call-started` | after inserting the `RINGING` video row | ring starts on agent tabs |
| `/api/calls/[id]/answer-video` | after the claim succeeds | other agents' banners clear |
| `/api/kiosk/call-ended` | on finalize | banner clears |
| `/api/calls/[id]/end-video` | on finalize | banner clears |

The broadcast is **detached and best-effort**: `void broadcastCallsChanged(operatorId).catch(captureToSentry)`. A Realtime hiccup must never fail or delay the call path — the 60s safety-net poll (§4.3) still delivers the ring. This mirrors the detached-heartbeat discipline already used in the voice incoming webhook.

The reaper cron is **not** a publisher: a leaked `RINGING` row self-clears because the banner refetch time-bounds the ring window (`REAP_RINGING_AFTER_MS`), so a reaper broadcast would be redundant. (Noted as a forward seam, not built.)

### 4.2 Subscriber (agent/admin client)

`IncomingVideoBanner` gains an `operatorId` prop (passed from the shell layout, which already resolves the actor). On mount it:

1. Creates an **authenticated browser Supabase client** (new — see §5), calls `supabase.realtime.setAuth()` so the channel carries the agent's JWT.
2. Subscribes to `operator:{operatorId}:calls` with `{ config: { private: true } }`, listening for the `calls-changed` broadcast event.
3. On each `calls-changed` event → runs the existing `tick()` (one refetch of `/api/calls/incoming-video`).
4. On `SUBSCRIBED` and on reconnect → runs `tick()` once (catch-up — see §4.3).
5. On `CHANNEL_ERROR` / `TIMED_OUT` → tears down and resubscribes (self-healing).

The 3s `setInterval` is removed. The existing focus-refetch is kept (cheap safety net).

### 4.3 Catch-up, reconnection, safety net (the three hard parts)

- **Missed-event catch-up:** `tick()` runs once on `SUBSCRIBED` and on every reconnect. Because the refetch is authoritative, any broadcast missed while disconnected is reconciled on reconnect. No event log / replay needed.
- **Reconnection:** resubscribe on channel error/timeout; the Supabase client auto-reconnects the socket, and the on-subscribe `tick()` reconciles.
- **Safety-net poll (deliberately kept):** a **60s** fallback poll remains behind the push. Rationale: a missed ring = a missed guest call, the worst failure mode here, so call-safety beats polling purity. 60s is **20× cheaper** than 3s (≈2.9M → ≈145k invocations/mo) while Realtime delivers the real ~1s latency. The interval is a single tunable constant (`INCOMING_VIDEO_FALLBACK_POLL_MS`); it can be raised or dropped to 0 once Realtime is proven in prod.

## 5. Channel authorization

Private channel + RLS on `realtime.messages`, operator-scoped.

- **Migration `0018_realtime_calls_authz.sql`:** a `for select to authenticated` policy on `realtime.messages` allowing a user to read broadcasts on `operator:{their operator}:calls`:

  ```sql
  create policy "operator members read operator calls channel"
  on "realtime"."messages"
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 2)::uuid = current_user_operator_id()
  );
  ```

  `current_user_operator_id()` is the existing SECURITY DEFINER helper. Parsing the operator id out of the topic and comparing to the caller's operator is the multi-tenant gate; in v1 it always matches (one operator) but is correct for v2.

- **Realtime Settings:** "Allow public access" must be **disabled** for the project so private-channel RLS is enforced (Realtime dashboard setting / project config). Documented as a one-time deploy step in the plan; no code.

- The push is non-sensitive ("something changed"), so even if the policy were coarse the exposure is just call-timing metadata — but we do it operator-scoped from the start because it's the seam and costs one small migration.

## 6. New & changed pieces

| Piece | Change |
|---|---|
| `apps/portal/lib/supabase/browser.ts` | **New.** Authenticated browser client via `createBrowserClient` (`@supabase/ssr`), reads session from cookies so Realtime carries the agent JWT. (Re-introduces the browser client deleted as unused in Phase 4 — Realtime is now its use.) |
| `apps/portal/lib/realtime/calls-channel.ts` | **New.** Pure/server helpers: `operatorCallsChannelTopic(operatorId)` name builder; `broadcastCallsChanged(operatorId)` (HTTP `POST /realtime/v1/api/broadcast`, `apikey: SUPABASE_SERVICE_ROLE_KEY`, body `{ messages: [{ topic, event: "calls-changed", payload: {} }] }`). Unit-tested. |
| `apps/portal/components/video-call/incoming-video-banner.tsx` | Subscribe to channel; `tick()` on event / subscribe / reconnect; remove 3s interval, add 60s fallback; resubscribe-on-error; accept `operatorId` prop. |
| 4 publisher routes (§4.1) | One detached `void broadcastCallsChanged(operatorId).catch(...)` after the existing write. |
| Shell layout rendering `IncomingVideoBanner` | Pass `operatorId` (already resolved for the actor). |
| `packages/shared/src/protocol.ts` (or a local const) | `INCOMING_VIDEO_FALLBACK_POLL_MS = 60_000`. (Cross-surface timing constants live in `protocol.ts` per the Phase-4 convention.) |
| `supabase/migrations/0018_realtime_calls_authz.sql` | RLS policy (§5). |

No new env vars (uses existing `NEXT_PUBLIC_SUPABASE_URL`, anon key, and service-role key). `pnpm gen:types` after the migration if it alters generated types (the policy alone does not change table types — likely a no-op, verified in the plan).

## 7. Error handling & invariants

- Broadcast failure is swallowed + Sentry-reported; never blocks/fails the call path. The 60s poll is the guarantee.
- Authoritative state is always the refetch — the push only triggers it, so spurious/duplicate/out-of-order pings are harmless.
- A silently-dead subscription is covered by: resubscribe-on-error → focus-refetch → 60s poll, in that order of timeliness.
- Zero change to `calls` RLS, call-state machine, finalization, audio path, presence.

## 8. Testing

**Unit (Vitest):**
- `operatorCallsChannelTopic` — name shape, operator id placement.
- `broadcastCallsChanged` — endpoint URL, `apikey` header, message body shape (mock `fetch`); swallows/Sentry-reports a non-2xx without throwing.
- `IncomingVideoBanner` (mock Realtime client + `fetch`): `calls-changed` event → refetch; `SUBSCRIBED` → refetch; reconnect → refetch; `CHANNEL_ERROR` → resubscribe; 60s fallback still fires; existing ringtone/tab-title/accept behavior unchanged.
- Existing `tests/app/calls/incoming-video.test.ts` (route) — unchanged, must stay green.

**Prod smoke (Realtime only works against a real Supabase project):**
- Kiosk taps Call → agent banner rings in ~1–2s (push), not on a 3s cadence — confirm in the network tab that the 3s poll is gone and only a ~60s backstop remains.
- Cancel / answer / end → banner clears on other agents' tabs promptly.
- Kill the agent tab's network, start a call, restore network → banner catches up (reconnect `tick()`), no missed ring.
- Two agent tabs covering the same property both ring and both clear on answer.

## 9. Rollout & risk

- Single migration (additive RLS policy), one Realtime Settings toggle, no destructive changes — safe to ship behind the existing 60s backstop, so a Realtime misconfiguration degrades to "rings within 60s" rather than "never rings."
- Reversible: deleting the subscription + restoring the 3s interval returns to today's behavior; the migration is a standalone policy.

## 10. Out of scope / follow-ups

- Presence migration (own spec) — note the `realtime.messages` policy can be extended to presence channels there.
- Kiosk-liveness held connection; dashboards subscribe-and-refetch-on-change; owner-home N+1 batch fix.
- Dropping the 60s backstop to pure-push once Realtime reliability is observed in prod.
