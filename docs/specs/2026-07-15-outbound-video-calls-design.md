# Agent-Initiated Outbound Video Calls (+ kiosk liveness) — Design

**Date:** 2026-07-15
**Status:** Design (spec) — approved in brainstorm; implementation plan next
**Relates to:** builds on the existing kiosk⇄agent video stack (LiveKit, `docs/specs/2026-07-05-phase4-livekit-swap*`); reuses the one-active-call index (migration 0016) and the state-guarded multi-owner finalization; folds in the long-deferred **kiosk liveness** seam (`docs/specs/2026-06-01-06a-kiosk-video-design.md` §6; `docs/v2-backlog.md` realtime item 3). Fixes tracked bug `task_71d65b0a` (presence not reset after a video call) as a side effect.

## 1. Summary

Let an **agent start a video call *to* a property's lobby kiosk** — the reverse of today's guest-initiated flow. The scenario is an agent-initiated **call-back**: the video call dropped, or the agent stepped away to check something with a supervisor / property manager and told the guest "I'll call you right back," so the guest doesn't have to guess when to re-tap the kiosk.

This is **not** a new call stack. Both ends already own the entire in-call video surface (agent overlay/tile, captions, in-call chat, RustDesk Connect; kiosk `Connected` + `CallControls` + LiveKit join). Outbound is the **same machinery with the originator reversed**: the agent originates and waits, the kiosk is signalled to ring, someone taps **Answer**, and both land in the identical connected surface. The build is three small new server routes, one new agent pre-connect state, one new kiosk incoming screen, and one additive column.

While we're adding a per-property kiosk→server poll for call discovery, we also light up **kiosk liveness** (dead since v1): the poll doubles as a fresh per-property heartbeat, so the agent can see a kiosk is offline *before* calling it, and the admin status page gets a real online/offline signal.

## 2. Scope

**In scope (v1):**
- Agent-initiated **video** call to a property's lobby kiosk (reverse-originator).
- Two agent entry points: a **"Kiosk"** button on each property card (next to the RustDesk **Connect** button), and a **10-second, agent-only "Call back"** shortcut on the just-ended call surface.
- New kiosk **"The front desk is calling — Answer"** incoming screen, discovered by a short poll; tap-to-answer → join.
- **Abrupt-disconnect handling:** kiosk returns Home with a **10s tap lockout** + calm "reconnecting" message; agent gets the 10s call-back shortcut.
- **`direction`** on `calls` (`INBOUND` default / `OUTBOUND`) — distinguishes the two in history/stats and drives the kiosk poll filter + owner/admin labeling.
- **Kiosk liveness** (folded in): `last_seen_at` write on heartbeat + poll; online/offline indicator on the **property card** (mint / muted) and the **admin status page** (mint / blaze).
- **Presence fix:** the video-call end path resets agent presence server-side (fixes outbound *and* the tracked inbound bug `task_71d65b0a`).

**Out of scope (v1 non-goals; seams noted):**
- **Audio / PSTN outbound** — deliberately cut. No Twilio TwiML App, no outgoing grant, no dialer (agents can't reach rooms, have other channels for hotel staff, and lack local knowledge for third parties). If a real audio-callback need appears later it's a self-contained add-on. (Decision D1.)
- **Calling guest personal devices** — always the lobby kiosk, never a guest phone. (D2.)
- **Auto-connect on the kiosk** — a person taps Answer (consent + autoplay gesture + no empty-lobby broadcast). (D4.)
- **Richer liveness surfacing** — owner home, an admin fleet-board column: v2 follow-up. This build does the property card + status page only.
- **Realtime signaling** for the kiosk poll — a short poll ships; a held-connection / Realtime upgrade is a later seam (the box makes polling cheap; see D8).
- **A queue / retry / voicemail** if the kiosk doesn't answer — it finalizes NO_ANSWER, same as an inbound no-answer.

## 3. Architecture — reuse-and-reverse

Rejected alternative: a **separate outbound path** (its own signaling + room + finalization). It would duplicate room creation and finalization and drift from the inbound path over time. We reuse instead. (D3.)

### 3.1 End-to-end data flow (happy path)

1. **Agent clicks "Kiosk"** on a property card (or the 10s "Call back" shortcut) → `POST /api/calls/start-outbound-video` `{ propertyId }`. Actor-gated `AGENT | ADMIN` via `requireApiActor` (same gate as RustDesk Connect).
2. **Server originates:** creates the LiveKit room (channel name), inserts a `calls` row — `channel: VIDEO`, `direction: OUTBOUND`, `state: RINGING`, `property_id`, `handled_by_user_id: <agent>`, `ring_started_at: now()` — flips the agent to `ON_CALL`, and returns `{ callId, channelName, token }`. If a video call is already active for that property, the insert hits the **one-active-call index (0016)** → `23505` → **`409`** (glare floor; agent sees "kiosk is busy").
3. **Agent joins the room and waits** — the existing video surface renders a new **"Calling [hotel]…"** pre-connect state with a **Cancel** control.
4. **Kiosk discovers the call** via `GET /api/kiosk/incoming-call` (x-kiosk-token, polled ~3s while idle on Home). It returns `{ callId, channelName }` for a `RINGING` `OUTBOUND` VIDEO call on this kiosk's property, else `null`. Kiosk transitions Home → **"The front desk is calling — Answer."**
5. **Someone taps Answer** → `unlockAudioPlayback()` (autoplay gesture, free) → `POST /api/kiosk/answer-call { callId }` marks the row `IN_PROGRESS` (state-guarded from `RINGING`, sets `answered_at`) → kiosk fetches a video token for that channel (`/api/video/token`) → joins.
6. **Kiosk joins** → the agent's side sees the remote participant connect → **"Calling…" → Connected**. From here it is byte-identical to an inbound call.
7. **Either side ends it** → existing finalization (agent `end-video`, kiosk `call-ended`, reaper backstop — all state-guarded + idempotent). Agent presence resets to AVAILABLE/AWAY (§8).

### 3.2 New server surface (3 routes)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/calls/start-outbound-video` | `requireApiActor({ allow: [AGENT, ADMIN] })` | Create room + OUTBOUND RINGING call row + set agent ON_CALL; return `{ callId, channelName, token }`. 409 on the one-active-call index. |
| `GET /api/kiosk/incoming-call` | kiosk config token | Return `{ callId, channelName } \| null` for a RINGING OUTBOUND VIDEO call on this token's property. Also stamps liveness `last_seen_at` (§7). |
| `POST /api/kiosk/answer-call` | kiosk config token | State-guarded `RINGING → IN_PROGRESS` + `answered_at`; the kiosk-side mirror of the agent's `answer-video`. |

### 3.3 Reused unchanged

LiveKit room + `/api/video/token`; `end-video` / `kiosk/call-ended`; the reaper (`reap-stale-calls`) both-sides-gone backstop; the agent's whole in-call surface (`video-call.tsx`, overlay, tile, captions, in-call chat, RustDesk Connect); the kiosk `Connected` + `CallControls`; the one-active-call index (0016).

## 4. UX per surface

New screens **model the existing ones** so they read as native; final pixels ride the next UI/UX pass.

### 4.1 Agent (all inside the existing video surface)

- **"Kiosk" button** on each property card, next to Connect — small monitor/video icon + short label ("Kiosk"). **Greys out with an "Offline" hint** when the property's liveness dot is down, so the agent doesn't fire a doomed call.
- **"Calling [hotel]…"** pre-connect state — the one genuinely new agent state (today the agent only ever *answers*). Models the current video overlay chrome; shows the hotel name and a **Cancel** control. Flips to the normal Connected overlay on kiosk-answer, or to **"No answer"** at the ring-window timeout.
- **"Call back" shortcut** — appears on the just-ended call surface, **agent-only, 10s, then gone**. Fires the same originate call as the Kiosk button, pre-targeted to that property. Serves the accidental-drop "reconnect now" moment; the deliberate "call back in a few minutes" case is the property-card button.

### 4.2 Kiosk

- **"The front desk is calling — Answer"** incoming screen — new, distinct from the guest-initiated "Connecting you…" ringing screen; models the existing `Ringing`/`Home` visual language. Discovered by the 3s poll (only while idle on Home). Tap **Answer** → `unlockAudioPlayback()` → `answer-call` → join → existing `Connected`.
- **Abrupt-disconnect lockout** — on a **terminal** drop from a connected call (SDK gave up; *not* a clean hang-up), the kiosk returns Home but **disables the tap for 10s**, showing a calm **"Reconnecting you to the front desk — one moment."** An incoming agent call-back still lands during those 10s (flips straight to Answer). After 10s the tap re-enables and the guest can self-initiate. A **clean** hang-up applies no lockout.

### 4.3 Ring window

**30s** outbound ring window (new `OUTBOUND_RING_WINDOW_SECONDS` in `@lc/shared/protocol.ts`) — the agent shouldn't stare at "Calling…" for the 120s inbound window. At timeout the row finalizes `NO_ANSWER` and the agent sees "No answer." (D5.)

## 5. Data model

### 5.1 `calls.direction` — migration 0022 (additive)

```sql
alter table public.calls
  add column direction text not null default 'INBOUND'
    check (direction in ('INBOUND', 'OUTBOUND'));
```

Text + CHECK (project convention, not a Postgres enum). Additive + defaulted → **blue-green-safe** (the frozen Vercel/Agora standby ignores it; box-prod uses it). Regenerate `database.generated.ts` + re-narrow `direction` to the union in the `supabase-types.ts` overlay; `pnpm gen:types` after applying.

### 5.2 `kiosks` liveness — migration 0023 (new table, isolates high-frequency writes off `properties`)

```sql
create table if not exists public.kiosks (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists kiosks_one_per_property on public.kiosks(property_id);
alter table public.kiosks enable row level security;
-- select scoped to operator (mirrors other tables); writes service-role only.
create policy kiosks_select_operator on public.kiosks
  for select using (operator_id = current_user_operator_id());
```

A dedicated table (vs. a `properties.kiosk_last_seen_at` column) keeps the 3–30s write cadence off the otherwise read-heavy `properties` row. One kiosk per property today (the config token is property-scoped); the table is forward-compatible with multiple. Writes are **service-role only** (the kiosk-token routes use the admin client — same posture as other kiosk routes); no client insert/update policies.

## 6. Concurrency / glare

Layered, and mostly free:

1. **Hard floor — the one-active-call index (0016).** Two active VIDEO calls per property physically cannot coexist. Whichever insert lands first wins; the loser gets `23505 → 409`. No new logic.
2. **Graceful degrade makes pure glare invisible.** If the agent's outbound call wins and the guest then taps, the kiosk's poll is already surfacing the incoming call, so the guest sees **"Answer"** rather than an error — the collision resolves into a normal answer. If the guest's inbound call wins, the agent's originate gets a 409 and the guest's call rings the agent inbound anyway.
3. **10s kiosk lockout** (§4.2) is the calm-UX layer for the post-drop reconnect race: the agent has right-of-way for 10s; the guest's tap is held so nobody sees a raw "busy."

In practice glare is rare (the guest isn't rushing to re-tap, and ~90% of calls are guest-initiated) — this just makes the rare case clean rather than ugly.

## 7. Kiosk liveness

- **Write:** the always-on kiosk heartbeat (~30s, runs in every screen) starts writing `kiosks.last_seen_at = now()` (today it's a no-op that returns 204). The 3s idle **incoming-call poll** also stamps it, so an idle kiosk reads fresh within seconds. Both go through the kiosk-token → admin-client write path, **upserting by `property_id`** (resolving `operator_id` from the property on first insert), so no separate provisioning step is needed.
- **Read / status:** a kiosk is **online** iff `last_seen_at` is fresh **or** it's on an active call (a mid-call kiosk polls less but is obviously live). Staleness threshold **~90s** to start (survives a missed heartbeat), tunable in `protocol.ts`. Pure helper (shape mirrors `effectivePresence` / `isReachableForDial`).
- **Surfaces (this build):**
  - **Property card:** online = **mint** dot (same token as the existing live presence dots), offline = **muted/grey** + "Offline" label; the Kiosk button greys out when offline.
  - **Admin status page:** online = **mint**, offline = **blaze** (needs-attention — that surface's job). Red stays reserved for 911. Color is always paired with a label.
- **Deferred (v2):** owner home, an admin fleet-board column.

## 8. Presence

Originating an outbound call flips the agent `ON_CALL`; ending it resets to `AVAILABLE`/`AWAY`, mirroring inbound. The reset rides the **same end path as the tracked bug `task_71d65b0a`** ("agent stuck 'not accepting' after a video call — `end-video` doesn't reset presence server-side"). We **fix the end-path presence reset** here so outbound doesn't inherit it — which clears the existing inbound bug in the same change. (D9.)

## 9. Attribution / logging

- The outbound row carries `property_id` (from the card → correct hotel), `handled_by_user_id` (the originating agent), `direction: OUTBOUND`, `channel: VIDEO`, `caller_number: null`. It lands in the property's call history and the agent's stats automatically. Video runs on the self-hosted box (flat cost) → **attribution is a logging concern, not a billing one** (the original "which hotel picks up the tab" worry was a Twilio/PSTN concern, which is cut). (D6.)
- **Do not let an outbound NO_ANSWER read as a "missed call."** A NO_ANSWER normally renders as **Missed** (blaze) in the owner's history, implying a guest failed to reach the front desk — a service gap. For an OUTBOUND row that is wrong. `direction` lets us label outbound rows as such and keep them out of the "missed"/service-failure framing. Data + labeling handled now; heavy visual treatment rides the polish pass. (D10.)

## 10. Reliability / edge cases

| Case | Behavior |
|---|---|
| Kiosk offline / tablet asleep | Liveness dot pre-warns (button greyed). If called anyway → 30s → `NO_ANSWER`, agent sees "No answer." |
| Agent cancels while "Calling…" | Finalize `NO_ANSWER` + leave room; the kiosk poll returns `null` → kiosk returns Home (poll-interval latency, acceptable). |
| Guest taps Answer on a just-cancelled call | `answer-call` finds the row no longer `RINGING` → `409`/no-op → kiosk shows "call ended" → Home. |
| Agent's tab/WebRTC gone after kiosk joins | Kiosk joins an empty room → no remote participant → reuse the existing "agent left" handling → apology/Home. |
| Transient network blip mid-call | LiveKit auto-reconnect + existing kiosk reconnecting overlay; nobody re-dials. Lockout applies only to a **terminal** drop. |
| Glare (both start at once) | One-active-call index → one wins, loser 409; graceful degrade (§6). |
| Two agents call the same kiosk | Second originate hits the index → 409 "busy." |

## 11. Testing

- **TDD (unit, Vitest) — pure logic:**
  - `direction` resolution + the `resolveFinalState`-adjacent labeling (outbound NO_ANSWER ≠ missed).
  - Kiosk reducer's new `INCOMING` / `ANSWER` / lockout transitions + guards (same shape as `shouldFireRingTimeout` / `shouldEndForMaxDuration`).
  - Outbound ring-timeout guard; the incoming-call discovery mapping; the glare `23505 → 409` mapping; the agent's 10s call-back visibility timer.
  - Kiosk liveness staleness function (fresh-or-on-call → online).
- **Smoke (live) — the LiveKit reverse-connect can only be verified running:** staging **and the real iPad kiosk** (per the "don't judge video on a Mac" rule). Walk: agent originate → kiosk rings → Answer → Connected → captions/chat/RustDesk work → hang up → agent presence resets. Plus glare, the 30s no-answer, and the terminal-drop 10s lockout.

## 12. Sequencing (for the plan)

1. **Migrations + types** — 0022 `calls.direction`, 0023 `kiosks`; regen types.
2. **Server** — `start-outbound-video`, `kiosk/incoming-call` (+ liveness write), `kiosk/answer-call`; wire `last_seen_at` into the existing heartbeat; the end-path presence-reset fix; `OUTBOUND_RING_WINDOW_SECONDS`.
3. **Kiosk** — incoming/Answer screen + reducer transitions + the 3s idle poll + `unlockAudioPlayback` on Answer + join; the terminal-drop 10s lockout + "reconnecting" state.
4. **Agent** — "Calling…" pre-connect state + Cancel; property-card "Kiosk" button + liveness dot; the 10s "Call back" shortcut.
5. **Liveness surfacing** — property-card dot + admin status-page tile.
6. **Attribution/labeling** — outbound indicator + missed-call exclusion in owner/admin call views.
7. **Smoke** on staging + real iPad.

## 13. File-touch map (for the plan)

**New:** `app/api/calls/start-outbound-video/route.ts`, `app/api/kiosk/incoming-call/route.ts`, `app/api/kiosk/answer-call/route.ts`; `apps/kiosk/src/screens/IncomingCall.tsx` (or an equivalent Home/Ringing state); `lib/kiosk/liveness.ts` (pure staleness) + a portal read helper; `supabase/migrations/0022_*`, `0023_*`.
**Modified:** `apps/kiosk/src/App.tsx` + `state/call-machine.ts` (incoming/answer/lockout transitions + poll); `app/api/kiosk/heartbeat/route.ts` (write `last_seen_at`); the video-call end path (presence reset); the property-card component (Kiosk button + liveness dot); the agent video surface (Calling… state + Call-back shortcut); the admin status page; owner/admin call-row/list (direction label); `packages/shared/src/protocol.ts` (`OUTBOUND_RING_WINDOW_SECONDS`, liveness staleness); `supabase-types.ts` overlay.

## 14. Decision log

- **D1 — Audio/PSTN outbound cut.** Agents can't reach rooms, have other channels for hotel staff, and lack local knowledge for third parties; missed-call-back stays unadvertised (under-promise / over-deliver). No Twilio TwiML App / outgoing grant.
- **D2 — Target is always the lobby kiosk**, never a guest personal device.
- **D3 — Reuse-and-reverse**, not a separate outbound stack.
- **D4 — Kiosk rings; a person taps Answer** (not auto-connect) — consent, autoplay-gesture unlock, no empty-lobby broadcast, and it reuses the existing tap-to-connect machinery.
- **D5 — 30s outbound ring window** (vs. the 120s inbound window).
- **D6 — Attribution is logging, not billing** (video is flat-cost on the box); auto-attributed by originating from the property card.
- **D7 — Two entry points:** property-card "Kiosk" button (anchor) + a 10s agent-only "Call back" shortcut (drop moment).
- **D8 — Kiosk discovery via a short poll** (~3s idle); realtime is a later seam. The box makes the higher cadence cheap (the original polling-cost worry was Vercel-metered).
- **D9 — Fix the end-path presence reset** (`task_71d65b0a`) as part of this — benefits inbound + outbound.
- **D10 — Outbound NO_ANSWER must not read as a "missed call"** service gap; `direction` drives the labeling.
- **D11 — Kiosk liveness folded in** (signal is nearly free once we poll): `last_seen_at` write + property-card dot (mint/muted) + admin status-page tile (mint/blaze). Richer surfacing deferred to v2.
