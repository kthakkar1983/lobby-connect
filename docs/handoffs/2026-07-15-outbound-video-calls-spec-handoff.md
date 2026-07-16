# Handoff — Outbound Video Calls: SPEC WRITTEN + COMMITTED, awaiting review (2026-07-15)

**START HERE.** Brainstorm is **done**; the design is written up as a spec and committed. The next action is **Kumar's spec review**, then the **writing-plans** skill → a task-by-task implementation plan → subagent-driven build (the usual per-task two-stage-review + whole-branch pattern). Nothing is built yet. The overall infra reference stays `2026-07-09-cutover-executed-live-handoff.md`; the prior thread's carry-forward is in **OUTSTANDING** below.

## TL;DR

- **Feature = agent-initiated OUTBOUND VIDEO calls** to a property's lobby kiosk (call-back for a dropped call, or the "I'll get back to you after I check with my supervisor" flow). **Audio/PSTN outbound is deliberately CUT.**
- **Spec:** [`docs/specs/2026-07-15-outbound-video-calls-design.md`](../specs/2026-07-15-outbound-video-calls-design.md) — committed on branch **`outbound-video-calls`** (`a8e30a4`). Read it first; it's canonical.
- **Architecture = reuse-and-reverse:** it's the *existing* kiosk⇄agent LiveKit video stack with the originator reversed. ~80% is already built (room, token, finalization, both in-call surfaces, captions, in-call chat, RustDesk Connect). New = 3 small server routes + one agent pre-connect state + one kiosk incoming screen + one additive column.
- **Folded in:** **kiosk liveness** (dead since v1 — the heartbeat is a literal no-op) — the new 3s poll doubles as a fresh per-property heartbeat, so it's nearly free. Also **fixes tracked bug `task_71d65b0a`** (presence not reset after a video call) via the shared end path.
- **Next step gate:** awaiting Kumar's read of the spec. If approved → `writing-plans`.

## The design in one screen (full detail in the spec)

**Flow (reverse-originator):** agent clicks **"Kiosk"** on a property card → `POST /api/calls/start-outbound-video` creates the LiveKit room + an `OUTBOUND`/`RINGING` `calls` row + flips agent `ON_CALL` → agent lands in a new **"Calling [hotel]…"** state (Cancel available) → the kiosk **polls** `GET /api/kiosk/incoming-call` (~3s while idle) → shows **"The front desk is calling — Answer"** → tap Answer → `POST /api/kiosk/answer-call` (RINGING→IN_PROGRESS) → joins the room → both in the **identical** connected surface (captions/chat/RustDesk all work unchanged).

**3 new server routes:** `start-outbound-video` (originate, `AGENT|ADMIN`), `kiosk/incoming-call` (discovery poll + liveness stamp, kiosk-token), `kiosk/answer-call` (kiosk-side mirror of `answer-video`).

**2 migrations, both additive / blue-green-safe:** `0022` `calls.direction` (`INBOUND` default / `OUTBOUND`, text+CHECK), `0023` `kiosks` liveness table (operator-scoped select RLS, service-role writes, upsert-by-property).

**Entry points:** property-card **"Kiosk"** button next to the RustDesk **Connect** button (greys out when the kiosk reads offline) + a **10s, agent-only "Call back"** shortcut on the just-ended call surface.

**Glare / concurrency (mostly free):** the one-active-call index (`0016`) already covers `VIDEO + RINGING/IN_PROGRESS` per property → two live calls physically can't coexist (loser → 409). Graceful degrade: a guest tap during the agent's outbound call surfaces **Answer**, not an error. On a *terminal* drop the kiosk returns Home with a **10s tap-lockout** + "Reconnecting you to the front desk — one moment" (clean hang-up = no lockout; agent gets the 10s call-back window).

**Ring window:** **30s** (`OUTBOUND_RING_WINDOW_SECONDS`, new in `@lc/shared/protocol.ts`) → `NO_ANSWER`.

**Kiosk liveness (folded in, this build):** heartbeat (~30s, all screens) + the 3s idle poll write `kiosks.last_seen_at`; online = fresh **or** on an active call; ~90s staleness. Surfaces **this build:** property-card dot (**mint** online / **muted** offline) + admin **status-page** tile (**mint** / **blaze**). Deferred to v2: owner home + an admin fleet-board column.

**Attribution:** `property_id` + `handled_by` stamped at originate → correct hotel's history + agent stats. Video = flat-cost on the box, so attribution is a **logging** concern, not billing. **Outbound `NO_ANSWER` must NOT render as a "missed call"** (that implies a guest service gap) — `direction` drives the labeling.

**Decision log:** D1–D11 in the spec §14. Key ones: D1 audio-out cut, D3 reuse-and-reverse, D4 Answer-not-auto-connect, D5 30s ring, D8 poll-not-realtime (box makes it cheap), D9 fix the presence-reset bug, D11 fold in liveness.

## Next actions (in order)

1. **Kumar reviews the spec.** If changes → amend on `outbound-video-calls`, re-run the spec self-review.
2. **`writing-plans`** → task-by-task plan (spec §12 sequencing + §13 file-touch map are the skeleton). Save to `docs/plans/2026-07-15-outbound-video-calls.md`.
3. **Build** subagent-driven — per-task two-stage reviews + opus whole-branch = SHIP (the established pattern). TDD the pure logic (spec §11); the LiveKit reverse-connect is **smoke-only on staging + the real iPad** ("don't judge video on a Mac").
4. **Merge** `--no-ff` → `main`; Coolify auto-deploys `lc-portal-prod` / `lc-kiosk-prod`. Prod smoke: originate → kiosk rings → Answer → connected → hang up → presence resets; + glare + 30s no-answer + terminal-drop lockout.

## Repo state / gotchas

- On branch **`outbound-video-calls`** (`a8e30a4`, spec only). `main` @ `b0cd132`. Branch **not** pushed.
- `analysis-and-audit-2026_07_11/` stays **deliberately untracked** — do **not** `git add -A` (there was a prior key-leak from a blanket add; add files explicitly).
- **Blue-green invariants still hold** (frozen Vercel/Agora standby = instant rollback until decommission): additive-only migrations (0022/0023 comply), don't rename `agora_channel_name`, Vercel `AGORA_*` + account stay, `KIOSK_CONFIG_SECRET` identical. Outbound is a **box-prod-only** feature — a rollback to the standby would lose it (accepted).
- The `kiosks` liveness write path: kiosk-token routes use the **admin (service-role) client** (same posture as other kiosk routes + `property_remote_access`) — no client write policies.
- After the migrations: `pnpm gen:types` + re-narrow `direction` to the union in the `supabase-types.ts` overlay; keep CI green.

## OUTSTANDING — carried forward (non-outbound)

From `2026-07-14-in-call-chat-smoke-complete-handoff.md`, still open:

1. **UI/UX header polish batch (b + c)** — remaining time-tracker polish. Placement change **(a) DECLINED** (duty control stays top-right). **(b)** unify one pill "shell" (height/min-width/type) across off / on-duty / on-break. **(c)** "End shift" + "Sign out" share the `LogOut` icon — give End shift its own (e.g. `TimerOff`). Files: `components/dashboard/duty-control.tsx`, `components/account-menu.tsx`. Fold in `[[dashboard-layout-rework-deferred]]`.
2. **Broader deferred (own brainstorm each):** attention-aware dormant/wake call tile + RustDesk true-fullscreen SOP; **credential-hardening** (encrypt-at-rest + fail-closed issuance audit) = pre-second-hotel (migration plan step 5).
3. **Kiosk liveness richer surfacing** (owner home + admin fleet column) — the v2 remainder after this build ships the card + status-page slice.
4. Non-blocking: `task_71d65b0a` is being fixed **as part of** the outbound build (presence reset on video-call end).
