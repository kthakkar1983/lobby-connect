# Phase 3 — agent + admin workspace: property cards, push-first alerting, call tile, Connect, hold (design spec)

**Date:** 2026-07-04 · **Status:** DESIGNED — brainstormed with Kumar 2026-07-03→04 (visual companion + Gate 3.0 evidence); this document is his review gate before the plan · **Parents:** target architecture `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` §4/§5/§5b · migration plan `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 3) · kickoff handoff `docs/handoffs/2026-07-03-phase3-kickoff-handoff.md`

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
| D2 | **Today's full-screen in-call overlays are untouched** | Kumar: "lets not mess with todays working full screen in-call set up." Card expansion is for RINGING only; Answer opens the existing overlay |
| D3 | **Push-first alerting, audible contract** | OS toast = best-effort context (names the property; click focuses the portal — included but nothing depends on it) |
| D4 | **Tile is call-scoped** | Opens on Answer (a real user gesture — DocPiP requires one), guest-video-first (eye contact), compact controls, closes at hang-up. Full brand-token binding — Kumar flagged the sketch's colors; no freehand styling in the build |
| D5 | **"Go on duty" is slim + local** | One deliberate click: primes ring audio (session-22 pattern) + requests push permission / refreshes the subscription. No routing/presence semantics |
| D6 | **"End shift" button** (dashboard header area) | Immediate presence→OFFLINE via a service-role presence route (same family as the heartbeat) so the fleet view reads true without waiting for staleness. No shift schedule — Kumar: "who is busy not who hasnt showed up yet" (schedule = v2 seam) |
| D7 | **Fleet "on duty" labels are derived** from existing presence | No schema, no routing change |
| D8 | **Second ring while on a call: answering it holds the current call** | Sequencing: hold A (conference) → answer B. Rare until the Twilio concurrency raise; designed in now |
| D9 | **Hold ships UI + AUDIO only in Phase 3** (Twilio Conference seam, the 6c precedent). **Video-hold wiring waits for LiveKit (Phase 4)** | Kumar correction — no Agora hold plumbing that Phase 4 would delete |
| D10 | **Connect is per-need** at multi-property scale (all-shift RustDesk is a single-property training artifact) | Pre-warm: credentials fetched at Answer so Connect fires instantly |
| D11 | Admin fleet = pod-grouped under the existing command strip; **Answer gated by `covering`; Connect never gated** | Restates the target-spec §5b locks |

## 3. Design

### 3.1 Property cards (shared component, two scopes)

- **Anatomy:** property identity · live state line (quiet / **ringing** / on call / on hold, + open-incident chip in blaze per brand severity rules) · tonight-at-a-glance (calls tonight, last-call time) · actions: **Answer** (only while ringing; agents always, admins only where `covering` is on) and **Connect** (always, never gated).
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
- **Faces:** VIDEO call → guest video fills the tile, compact bar beneath (timer · mute · hold · hang up · **911** · room#/quick-note ⏎ reusing the notes-durability path). AUDIO call → identity + hotel-local time + timer + the same controls. A **second-property ring** renders as a banner inside the tile (Answer there = D8 hold-then-answer).
- **Authority:** the in-tab overlay remains the authoritative call surface (D2); the tile mirrors state through the same client call-state (one source of truth, two portals — the Gate-3.0 createPortal pattern). Closing the tile mid-call changes nothing about the call; the overlay shows a "reopen tile" affordance (the Back-to-tab accidental-close lesson).
- **Brand binding:** tile document inherits the portal stylesheet (Gate-3.0 mechanism) and uses only brand tokens — the in-call face gets a proper design pass at build (Kumar's flag).
- **Degradation:** non-Chromium/no-DocPiP → no tile; overlay-only (today's behavior). Chrome/Edge SOP stands (runbook §11 seam).

### 3.4 Duty controls

- **Go on duty** (dashboard, replaces nothing): primes audio, ensures push permission + fresh subscription. Shown when un-primed/unsubscribed; quiet otherwise.
- **End shift** (header/user-menu area): immediate `status=OFFLINE` service-role write (presence writes stay service-role per the migration-0012 guard pattern). Not audited (presence writes aren't today; consistency over ceremony).
- Fleet labels: On duty (AVAILABLE, fresh) / On call / Away / Off duty (OFFLINE or stale) — derived, display-only.

### 3.5 Remote access + Connect

- **Migration 0019 `property_remote_access`:** `property_id` (FK, unique) · `operator_id` · `peer_id` · `unattended_password` · timestamps. **RLS: no client read policy at all — service-role only**; admins CRUD through server actions (`requireRole(ADMIN)` + service client), agents never see the table.
- **Credential API:** `GET /api/remote-access/[propertyId]` via `requireApiActor({allow:[AGENT,ADMIN]})` (operator-scoped — per-property tightening rides the existing v2 scoping seam), returns `{peerId, password}` just-in-time; audited `remote_access.credentials_issued` (+ `remote_access.updated`/`rotated` on admin writes). Credentials never render in UI.
- **Connect:** card button → fetch (or use pre-warmed) credentials → programmatic navigation to `rustdesk://connection/new/<peerId>?password=<pw>` (format verified in the target spec §4). **Pre-warm at Answer:** the accept flow fetches credentials for the ringing property so an in-call Connect is instant.
- **Admin CRUD UI:** property detail gains a Remote access card (peer id, set/rotate password, last-issued audit line).
- **Enrollment seam (v2, carried per handoff):** the provisioning script stays schema-free; a future self-registration endpoint can populate `property_remote_access` without changing this API's shape.

### 3.6 Hold (audio, Phase 3 scope)

- Mechanism: the **6c conference precedent** — on Hold, the call's legs move into a Twilio Conference with the guest participant `hold=true` (Twilio hold music); Resume flips it back. Same server-side Participant-API control family as the emergency path; the exact TwiML/redirect choreography is a plan-level task with **911-grade byte review** (it touches the same seams).
- Held state renders on the property card + tile + overlay; resume from any of them.
- Video calls in Phase 3: **no hold control rendered** (D9) — the seam (state names, card/tile rendering) is built so LiveKit track-pause drops in at Phase 4.

### 3.7 Migrations

- **0019 `property_remote_access`** (§3.5). **0020 `push_subscriptions`:** `user_id` (FK) · `operator_id` · `endpoint` (unique) · `p256dh` · `auth` · `created_at` · `last_seen_at`. RLS: owner-only select/delete; inserts via the session-authed route (user-scoped). Types regenerated (`pnpm gen:types`) per the Phase-4 drift check.

## 4. What does NOT change (load-bearing)

The entire dial/routing path (webhooks, HMAC, TwiML, parallel-dial, presence-gating), the 911 conference machinery (anything adjacent gets byte-level review), both in-call overlays, kiosk semantics, captions, RLS posture, the heartbeat presence model, the reaper/finalization machinery. No Vercel/hosting changes in this phase.

## 5. Gate 3.1 — push-ring spike (FIRST build task, same method as Gate 3.0)

- **Scope (~1 day):** VAPID keys + minimal SW + subscribe button + a self-scheduled server push (extend `/duty-tile-prototype` or a sibling page) that fires N seconds later; on receipt the SW shows the toast + messages the tab; the tab plays the loud ring and logs delivery latency, visibility state, and audio state (the Gate-3.0 report format).
- **Pass =** loud ring lands within a few seconds of the scheduled push with the tab throttled (browser minimized, fullscreen RustDesk in front) on Kumar's Windows PC + Mac. Toast display is **observed, not gating** (audible contract). Click-to-focus observed.
- **Fail →** recorded fallback: the all-shift keepalive tile (Gate 3.0 proved it works) returns as Plan B — a product-design concession, not an unknown.

## 6. Build order (the plan's skeleton; each step staging-first, independently shippable)

1. **Gate 3.1** push-ring spike → evidence.
2. **Property cards + ring-on-card** (agent pod grid + admin fleet; retire right-rail placements) — highest daily value, pure UI over existing state.
3. **Push productionized** (SW, subscription lifecycle, send-side wiring, prune) + Go on duty / End shift.
4. **Call tile** (answer-gesture open, faces, reopen affordance).
5. **Remote access** (0019, admin CRUD, credential API, Connect + pre-warm; provisioning-script password moves from PM into the vault).
6. **Hold (audio)** — last, alone, with the 911-grade review.
- Prod smoke per step; the migration plan's Phase-3 **done-when is amended** (same commit as this spec) to the pivoted wording: answer on expanded card (agent + covering admin) · one-click Connect to the real hotel PC · admin-connect to a non-covered property · hold/resume on audio · **loud ring with the browser minimized behind fullscreen RustDesk (push path) + toast observed**.

## 7. Non-goals / v2 seams

Shift scheduling (D6) · per-property API scoping (existing v2 seam) · per-connect credential rotation (target spec §4 seam) · answer-from-toast as a requirement (D3) · video-hold wiring (Phase 4) · thin desktop shell (retired by Gate 3.0) · self-registering hotel-PC enrollment (seam only) · admin bulk-provisioning UI (script covers v1) · any kiosk change.

## 8. Risks

1. **Push delivery variance** (battery savers, corporate networks, browser closed) — Gate 3.1 measures it on the real machines; layers B + C remain regardless; SOP keeps Chrome running in background on Windows.
2. **Hold touches the same seams as 911** — mitigated by sequencing it last, byte-level review, and the conference machinery being a proven pattern (6c).
3. **Retiring the right-rail placements regresses answering** — mitigated by moving mounts rather than rewriting accept logic, plus the existing test suite around accept/claim flows.
4. **DocPiP gesture consumption** — `requestWindow()` must precede async accept work in the same click handler (recorded build constraint from Gate 3.0).
5. **Migration-numbering/type drift** — 0019/0020 + `gen:types` in the same tasks (CI drift check enforces).
