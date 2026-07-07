# Phase 3 — agent + admin workspace: property cards, push-first alerting, call tile, Connect, hold (design spec)

**Date:** 2026-07-04 · **Status:** APPROVED — brainstormed with Kumar 2026-07-03→04 (visual companion + Gate 3.0 evidence); passed his spec gate 2026-07-04 with one edit folded in (**D12** — Connect from the in-call surfaces) and the palette stance settled (blaze stays: sparing attention accent, the non-emergency replacement for red; red itself reserved for 911/emergency). **Second gate edit (Kumar, plan review 2026-07-04): HOLD IS DEFERRED out of Phase 3 entirely** — "simplify things here and push it to when we have more than one property"; D8/D9/§3.6 kept below as the recorded design for the multi-property moment (likely rides Phase 4/LiveKit so audio + video hold land together) · **Third amendment (Kumar, Phase-D kickoff 2026-07-06): D13 — duty becomes server-truth** (`status=OFFLINE` ⇔ off duty, heartbeat gated server-side, "Go on duty" is the only door back in; §3.4 rewritten) — triggered by the Phase-5 re-smoke finding that `onDuty` re-armed itself on every refresh · **Parents:** target architecture `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` §4/§5/§5b · migration plan `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 3) · kickoff handoff `docs/handoffs/2026-07-03-phase3-kickoff-handoff.md`

Sourcing: brainstorm decisions are quoted/attributed (2026-07-04). Chromium floating-window + throttling behavior is **evidence-backed by Gate 3.0** (both OSes, real machines, logs pasted in-session). Web Push delivery behavior is *prior knowledge — deliberately verified by Gate 3.1 before anything depends on it*.

---

## 0. Context — Gate 3.0 results and what they changed

- **Gate 3.0 (deskphone-tile prototype) PASSED on both OSes** — merged `ba1b828`, prod route `/duty-tile-prototype`. Evidence: macOS + Windows 10 / Chrome 149; 1s heartbeat max-gap ≤1.1s with the browser **minimized**; rings fired 0.0s late including a 360s ring (past Chrome's 5-min intensive-throttling window); tile stayed on top of **fullscreen RustDesk running SynXis during a real guest check-in**; answered from the tile every time; ring audio never blocked. The thin-desktop-shell escalation is **retired**.
- **But the brainstorm rejected the all-shift tile.** Kumar: the all-shift design "solve[s] two problems at once" from a "keeping the tab active perspective" — he wants the ring-reliability problem solved on its own merits and the floating tile used "in a way that would genuinely add value." This spec is built on that separation (§1).
- Phase 3 is feature work on **current hosting (Vercel) + current video (Agora)** — zero infra risk; the Phase-1 soak and Phase-2 real-night gate proceed independently.
- Pilot reality (Kumar, 2026-07-04): the hotel **phone line is not yet transferred** (deliberate one-thing-at-a-time training; kiosk went first). Phase 3 lands **before** real phone volume — it is what makes the phone cutover safe.

## 1. The core decision — two problems, two solutions

1. **P1 — "it must always ring."** Solved by a **push-first signal path** with an **audible contract**: *the agent can always HEAR the ring, wherever her attention is* (Kumar: "as long as they can hear it ring, like with twilio, they can always switch quickly to the lc tab and answer from the dashboard"). Answering over fullscreen = alt-tab (or toast click) to the dashboard. No surface has to be visually on top for ringing to work.
2. **P2 — "the call should follow her into RustDesk."** Solved by a **call-scoped floating tile** (Document PiP): opens on the Answer click, *is* the call while she works the PMS — guest video first, for eye contact with the kiosk guest — and dies at hang-up. It exists only when it adds value.

## 2. Decision log (2026-07-04 brainstorm, chronological)

| # | Decision | Note |
|---|---|---|
| D1 | **Dashboard-first answering:** the ringing property's **card expands + rings in place**; retires the static right-rail incoming placements (softphone incoming block + persistent video card + off-home toast) | The Twilio `Device`/`VideoCallHost` machinery stays mounted in the shared layout exactly as today — only the incoming *UI* moves |
| D2 | **Today's full-screen in-call overlays are untouched** | Kumar: "lets not mess with todays working full screen in-call set up." Card expansion is for RINGING only; Answer opens the existing overlay. One additive exception folded in at the spec gate: the Connect control (D12) |
| D3 | **Push-first alerting, audible contract** | OS toast = best-effort context (names the property; click focuses the portal — included but nothing depends on it) |
| D4 | **Tile is call-scoped** | Opens on Answer (a real user gesture — DocPiP requires one), guest-video-first (eye contact), compact controls, closes at hang-up. Full brand-token binding — Kumar flagged the sketch's colors; no freehand styling in the build |
| D5 | **"Go on duty" is slim + local** | One deliberate click: primes ring audio (session-22 pattern) + requests push permission / refreshes the subscription. No routing/presence semantics |
| D6 | **"End shift" button** (dashboard header area) | Immediate presence→OFFLINE via a service-role presence route (same family as the heartbeat) so the fleet view reads true without waiting for staleness. No shift schedule — Kumar: "who is busy not who hasnt showed up yet" (schedule = v2 seam) |
| D7 | **Fleet "on duty" labels are derived** from existing presence | No schema, no routing change |
| D8 | ~~Second ring while on a call: answering it holds the current call~~ **DEFERRED with hold (plan-gate edit)** | Multi-property scenario; with one property + Twilio concurrency 1 a second audio call can't arrive. Today's behavior stands: a kiosk ring during a phone call can be answered alongside or left to ring out |
| D9 | ~~Hold ships UI + AUDIO only in Phase 3~~ **DEFERRED ENTIRELY (plan-gate edit): all of hold waits for the multi-property moment** | Kumar 2026-07-04: "simplify things here and push it to when we have more than one property." Cards/tile/provider keep a dormant `on-hold` state seam; §3.6 stays as the recorded design. Likely lands with Phase 4/LiveKit (audio + video hold together) |
| D10 | **Connect is per-need** at multi-property scale (all-shift RustDesk is a single-property training artifact) | Pre-warm: credentials fetched at Answer so Connect fires instantly |
| D11 | Admin fleet = pod-grouped under the existing command strip; **Answer gated by `covering`; Connect never gated** | Restates the target-spec §5b locks |
| D12 | **Connect is available from inside a live call** — the in-call overlays (audio + video) and the call tile carry a Connect action alongside the call controls | Kumar's spec-gate edit (2026-07-04). Additive button only — no other overlay change (scoped exception to D2); wired to the same pre-warmed credential fetch (D10) so an in-call Connect fires instantly |
| D13 | **Duty is server-truth, derived from presence** (2026-07-06 amendment): `status=OFFLINE` ⇔ off duty — no `on_duty` column, no migration. The heartbeat can only *refresh a live shift*, never start one; **"Go on duty" is the only transition out of OFFLINE**. Client hydrates from the server instead of assuming `onDuty=true` on mount | Amends D5 ("no presence semantics" no longer holds — the button now enters the shift) and hardens D6/D7. Kumar's condition, verified in code before approval: nothing load-bearing hangs on the Go-on-duty *gesture* — push permission is once-per-device (subscription persists), the tile's gesture is the Answer click (D4), and ring priming already has a first-interaction unlock (`softphone.tsx` mount listener). Full design: §3.4 |

## 3. Design

### 3.1 Property cards (shared component, two scopes)

- **Anatomy:** property identity · live state line (quiet / **ringing** / on call — "on hold" stays a dormant state-name seam until hold ships, + open-incident chip in blaze per brand severity rules — palette stance settled at the spec gate: blaze stays as the sparing attention accent, red reserved for 911/emergency) · tonight-at-a-glance (calls tonight, last-call time) · actions: **Answer** (only while ringing; agents always, admins only where `covering` is on) and **Connect** (always, never gated).
- **Ringing = the card expands in place** (grows, mint ring treatment — the same vocabulary as the softphone incoming state and the Gate-3.0 tile) with channel + elapsed. Answer claims the call through the **existing** answer/answer-video routes (first-wins claims unchanged), then opens the existing overlay (D2).
- **Agent dashboard:** pod card grid replaces the current right-rail incoming placements; the rest of the agent bento (stats, chart, recent calls) stays.
- **Admin dashboard:** command-center strip stays on top; below it, **pods grouped by agent** (agent header: name + derived presence + property count), each pod's cards beneath; unassigned properties in a trailing group.
- **Retired placements:** softphone card's incoming block, the persistent "Video" card, `IncomingCallToast` off-home. The components' *logic* (accept flows, ringtone element, `useRingingTabTitle`) is reused, not rewritten.

### 3.2 Alerting stack (P1)

| Layer | Path | Status |
|---|---|---|
| A (new, primary for video/kiosk) | Twilio-style always-rings via **Web Push**: push service wakes our service worker regardless of tab throttling → SW shows an OS notification (property name; click focuses portal) **and** posts a message to the open tab → tab plays the **loud primed ringtone** + flashes the title. Audio playback is not timer-throttled (Gate-3.0-adjacent evidence; *Gate 3.1 verifies the full chain*) | build |
| B (existing) | In-tab Supabase Realtime broadcast + 60s fallback poll + refetch-on-focus | unchanged |
| C (existing) | Twilio Voice SDK's own background-proof ring for phone calls | unchanged, proven in prod |

- **Send side:** the same server moments that broadcast an incoming call today (kiosk `call-started`; voice path untouched) also send a push via the new push module. Voice/TwiML/dial logic is NOT modified (D1 note; §4).
- **Subscription lifecycle:** "Go on duty" requests Notification permission + subscribes (VAPID); subscription upserted to `push_subscriptions` (§3.7) via a session-authed route. Expired/410 endpoints pruned on send failure. Multiple devices per user allowed (endpoint-keyed).
- **Degradation:** permission denied or non-supporting browser → layers B + C (today's status quo, minus nothing). SW dead → B + C. All three dead → the 60s poll on a throttled tab still lands within the 120s ring window (worst-case, documented, not designed-for).

### 3.3 The call tile (P2 — Document PiP, Chromium)

- **Opens from the Answer click** — `requestWindow()` is called synchronously inside the click handler (gesture constraint, recorded from Gate 3.0), then the accept flow proceeds; if the tile fails to open, the call proceeds normally in the tab (tile is additive, never load-bearing).
- **Faces:** VIDEO call → guest video fills the tile, compact bar beneath (timer · mute · hang up · **911** · **Connect** (D12) · room#/quick-note ⏎ reusing the notes-durability path; hold control returns with hold). AUDIO call → identity + hotel-local time + timer + the same controls. ~~A second-property ring renders as a banner inside the tile (Answer there = D8 hold-then-answer)~~ — deferred with D8/hold.
- **Authority:** the in-tab overlay remains the authoritative call surface (D2); the tile mirrors state through the same client call-state (one source of truth, two portals — the Gate-3.0 createPortal pattern). Closing the tile mid-call changes nothing about the call; the overlay shows a "reopen tile" affordance (the Back-to-tab accidental-close lesson).
- **Brand binding:** tile document inherits the portal stylesheet (Gate-3.0 mechanism) and uses only brand tokens — the in-call face gets a proper design pass at build (Kumar's flag).
- **Degradation:** non-Chromium/no-DocPiP → no tile; overlay-only (today's behavior). Chrome/Edge SOP stands (runbook §11 seam).

### 3.4 Duty controls — REWRITTEN by D13 (2026-07-06): duty is server-truth

**Why (found in the Phase-5 re-smoke):** the Phase-C build kept duty as per-tab client state — `onDuty` inits `true` on every softphone mount, so any refresh/login silently re-entered the shift and the next heartbeat overwrote the OFFLINE that End shift wrote. Three leaks, same root: (1) refresh re-arms the shift; (2) a second tab's heartbeat resurrects an ended shift (the heartbeat route wrote status unconditionally); (3) the Accepting toggle (`ready`) also inits `true`, so a refresh flipped "not accepting" (AWAY) back to accepting.

**The model:** `profiles.status` is already the duty store — audio dial (`isReachableForDial`), video poll/push (`isVideoSilencedStatus` deny-list), and the fleet label (`dutyLabel`) all read it. D13 makes the *client* obey the *server* instead of the reverse. A shift is **live** when `effectivePresence(status, last_seen_at, now) !== "OFFLINE"` — not explicitly ended, not swept, not lapsed past `PRESENCE_STALE_AFTER_MS` (90s).

- **Heartbeat gate** (`POST /api/presence`): a beat posting AVAILABLE/AWAY may only *refresh a live shift*. If the shift is over (raw OFFLINE, or stale), the beat does NOT write status/last_seen and returns `200 { onDuty: false }` so the tab flips itself off within one beat — this closes both multi-tab resurrection and stale-overnight resurrection. Allowed beats keep today's behavior (204, video ON_CALL preservation intact). **ON_CALL exception:** a beat that resolves to ON_CALL (posted by an in-call softphone, or upgraded by the route's own fresh-video check) bypasses the gate entirely — a live call outranks both the 90s window and a raw OFFLINE, so a >90s network blip mid-call can't dump the agent off duty. Documented edge this accepts: end-shift in tab A while tab B is mid-call → tab B's ON_CALL beats win until hang-up (she *is* on a call; v1 accepts it).
- **Lapse persistence:** when a gated beat discovers a *lapsed* shift (raw status still live but stale), it writes `status='OFFLINE'` — the event-driven version of the daily sweep, so video push stops targeting a lapsed shift immediately instead of at the 08:00 UTC cron. The write re-checks staleness in its WHERE clause (`last_seen_at <` cutoff) so it can never clobber a concurrent Go-on-duty. `last_seen_at` is not touched.
- **Go on duty** (`POST /api/presence/go-on-duty`, new, sibling of end-shift; service-role like all presence writes): sets `AVAILABLE` + fresh `last_seen_at`. **The only transition out of OFFLINE.** The button keeps its Phase-C gesture jobs — prime ring audio + arm push (permission prompt must live inside a click; the subscription itself persists per-device thereafter).
- **End shift**: unchanged (immediate `status=OFFLINE` service-role write; not audited — presence writes aren't).
- **Hydration** (`GET /api/presence`, new handler on the existing route): returns `{ onDuty, accepting }` computed server-side (`isLiveShift`, `status !== 'AWAY'`) — server clock, no client staleness math. On mount the softphone inits `onDuty` AND the Accepting toggle from it (closes leak 3). **Ordering: hydrate first, then start beating** — the first beat posts `intendedStatus()`, which reads the Accepting toggle, so a beat racing ahead of hydration would overwrite a true AWAY with the pre-hydration default (leak 3 through the back door). The 90s stale window makes waiting ~1 GET round-trip free. On GET failure/timeout: **fail-open** — default on-duty/accepting and start beating; the server gate makes a wrong duty guess self-correct on the first beat's `{ onDuty: false }` (the rare AWAY-overwrite in this failure path is accepted — the toggle is visible on screen).
- **Refresh semantics (continuity):** F5/crash-reopen mid-shift → heartbeat still fresh → hydrates back on duty, no click (the ring element re-primes on her first interaction — the existing mount-time `pointerdown`/`keydown` unlock; push needs nothing). Overnight open, swept, explicitly ended, or machine-slept past 90s → off duty until the Go-on-duty click. Named consequence, accepted: a laptop that sleeps mid-shift wakes **off duty** and shows it — the button is the only door back in.
- **What D13 does NOT touch:** dial gating, push target list, video poll scope, fleet labels (all already read status — they converge for free), the end-shift route, DutyControls' props/UI, the daily sweep (stays as the closed-tab backstop; a closed tab that never ended its shift keeps receiving push until swept — tightening the sweep cadence is a box-cron follow-up, post-cutover), the Twilio Device registration (still mounts regardless of duty; an off-duty agent is simply never targeted), kiosk, 911. Zero migrations. The `DEFAULT_LOGIN_STATUS` constant ("login defaults to AVAILABLE" — now false) is deleted along with its test assertion; the fail-open default lives in the hydration code with its own comment.
- Fleet labels: On duty (AVAILABLE, fresh) / On call / Away / Off duty (OFFLINE or stale) — derived, display-only, unchanged (and now trustworthy: the state they derive from can no longer be resurrected by a stray tab).

### 3.5 Remote access + Connect

- **Migration 0020 `property_remote_access`** (renumbered at plan time — ship order puts push first)**:** `property_id` (FK, unique) · `operator_id` · `peer_id` · `unattended_password` · timestamps. **RLS: no client read policy at all — service-role only**; admins CRUD through server actions (`requireRole(ADMIN)` + service client), agents never see the table.
- **Credential API:** `GET /api/remote-access/[propertyId]` via `requireApiActor({allow:[AGENT,ADMIN]})` (operator-scoped — per-property tightening rides the existing v2 scoping seam), returns `{peerId, password}` just-in-time; audited `remote_access.credentials_issued` (+ `remote_access.updated`/`rotated` on admin writes). Credentials never render in UI.
- **Connect surfaces (D12):** the property card, **and inside a live call** — both in-call overlays (audio + video) and the call tile. All placements share one client helper: fetch (or use pre-warmed) credentials → programmatic navigation to `rustdesk://connection/new/<peerId>?password=<pw>` (format verified in the target spec §4). **Pre-warm at Answer:** the accept flow fetches credentials for the ringing property so an in-call Connect is instant.
- **Admin CRUD UI:** property detail gains a Remote access card (peer id, set/rotate password, last-issued audit line).
- **Enrollment seam (v2, carried per handoff):** the provisioning script stays schema-free; a future self-registration endpoint can populate `property_remote_access` without changing this API's shape.

### 3.6 Hold — DEFERRED out of Phase 3 (recorded design for the multi-property moment)

**Not built in Phase 3** (plan-gate edit, D9). Kept as the design of record so it isn't re-derived later; the 2026-07-04 plan (superseded Phase F) worked the choreography out in full:

- Mechanism: the **6c conference precedent** — Hold stamps `hold_conference_name = hold-<callId>` and redirects the AGENT leg into that conference with `endConferenceOnExit="true"` (an agent crash/reload ends the guest's call cleanly instead of orphaning them in hold music); the guest's `<Dial>` action then fires and dial-result routes the guest in (`endConferenceOnExit="false"`); the route then flips the guest participant `hold=true` (Twilio hold music) via a bounded participant poll. Resume = participant `hold=false` (both stay conferenced — audio-identical to a bridge).
- **911-on-a-previously-held call needs its own path:** dial-result never re-fires once conferenced, so the emergency route must REST-redirect the GUEST first, then the agent (agent-first would end the hold conference). This is why hold carries 911-grade byte review whenever it ships.
- A redirected agent leg is SDK-uncontrollable (the 6c lesson) — in-call controls while/after hold go server-side (Participant API) or get disabled.
- Held state renders on the property card + tile + overlay; resume from any of them. Migration when built: `calls.hold_conference_name` + `calls.on_hold`.
- Video hold = LiveKit track-pause (Phase 4). Deferring audio hold too means both halves can land together as one feature.

### 3.7 Migrations

- Renumbered to ship order at plan time (plan: `docs/plans/2026-07-04-phase3-workspace.md`): **0019 `push_subscriptions`:** `user_id` (FK) · `operator_id` · `endpoint` (unique) · `p256dh` · `auth` · `created_at` · `last_seen_at`; RLS: owner-only select/delete; inserts via the session-authed route (user-scoped). **0020 `property_remote_access`** (§3.5). (A `calls` hold-columns migration rides with hold whenever it ships — deferred, §3.6.) Types regenerated (`pnpm gen:types`) per the Phase-4 drift check.

## 4. What does NOT change (load-bearing)

The entire dial/routing path (webhooks, HMAC, TwiML, parallel-dial, presence-gating), the 911 conference machinery (anything adjacent gets byte-level review), both in-call overlays, kiosk semantics, captions, RLS posture, the heartbeat presence *model* (20s beats, service-role writes, 90s staleness — the D13 amendment adds a duty gate to the route but changes no cadence/constant/write-path), the reaper/finalization machinery. No Vercel/hosting changes in this phase.

## 5. Gate 3.1 — push-ring spike (FIRST build task, same method as Gate 3.0)

- **Scope (~1 day):** VAPID keys + minimal SW + subscribe button + a self-scheduled server push (extend `/duty-tile-prototype` or a sibling page) that fires N seconds later; on receipt the SW shows the toast + messages the tab; the tab plays the loud ring and logs delivery latency, visibility state, and audio state (the Gate-3.0 report format).
- **Pass =** loud ring lands within a few seconds of the scheduled push with the tab throttled (browser minimized, fullscreen RustDesk in front) on Kumar's Windows PC + Mac. Toast display is **observed, not gating** (audible contract). Click-to-focus observed.
- **Fail →** recorded fallback: the all-shift keepalive tile (Gate 3.0 proved it works) returns as Plan B — a product-design concession, not an unknown.

## 6. Build order (the plan's skeleton; each step staging-first, independently shippable)

1. **Gate 3.1** push-ring spike → evidence.
2. **Property cards + ring-on-card** (agent pod grid + admin fleet; retire right-rail placements) — highest daily value, pure UI over existing state.
3. **Push productionized** (SW, subscription lifecycle, send-side wiring, prune) + Go on duty / End shift.
4. **Call tile** (answer-gesture open, faces, reopen affordance). **Phase D opens with the D13 duty-persistence cluster** (2026-07-06 amendment — heartbeat gate + go-on-duty route + hydration) before the tile tasks; the tile's track-grab is re-aimed at LiveKit (`RemoteTrack.mediaStreamTrack`) since the Agora strip.
5. **Remote access** (0020, admin CRUD, credential API, Connect on card + in-call overlays + tile (D12) + pre-warm; provisioning-script password moves from PM into the vault).
6. ~~Hold (audio)~~ **DEFERRED (plan-gate edit, D9)** — Phase 3 ends at step 5 + close-out.
- Prod smoke per step; the migration plan's Phase-3 **done-when is amended** (plan-gate edit) to: answer on expanded card (agent + covering admin) · one-click Connect to the real hotel PC **from the card and from inside a live call (D12)** · admin-connect to a non-covered property · **loud ring with the browser minimized behind fullscreen RustDesk (push path) + toast observed** · tile opens on Answer and carries the call over RustDesk.

## 7. Non-goals / v2 seams

Shift scheduling (D6) · per-property API scoping (existing v2 seam) · per-connect credential rotation (target spec §4 seam) · answer-from-toast as a requirement (D3) · **hold, entirely — audio AND video (D9 plan-gate edit; recorded design in §3.6, revisit at multi-property)** · thin desktop shell (retired by Gate 3.0) · self-registering hotel-PC enrollment (seam only) · admin bulk-provisioning UI (script covers v1) · any kiosk change.

## 8. Risks

1. **Push delivery variance** (battery savers, corporate networks, browser closed) — Gate 3.1 measures it on the real machines; layers B + C remain regardless; SOP keeps Chrome running in background on Windows.
2. ~~Hold touches the same seams as 911~~ — risk RETIRED for Phase 3 (hold deferred, plan-gate edit): the only remaining voice-path change is the additive `propertyId` TwiML Parameter, byte-reviewed. The hold risk note moves with the §3.6 recorded design.
3. **Retiring the right-rail placements regresses answering** — mitigated by moving mounts rather than rewriting accept logic, plus the existing test suite around accept/claim flows.
4. **DocPiP gesture consumption** — `requestWindow()` must precede async accept work in the same click handler (recorded build constraint from Gate 3.0).
5. **Migration-numbering/type drift** — 0019/0020 + `gen:types` in the same tasks (CI drift check enforces).
