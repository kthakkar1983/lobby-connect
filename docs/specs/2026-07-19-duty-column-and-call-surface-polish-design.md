# Duty column + call-surface polish — design

**Date:** 2026-07-19
**Status:** GATED (design approved by Kumar 2026-07-19; plan not yet written)
**Scope:** UI/UX only. Zero migrations, zero new API routes, zero RLS changes, no change to duty semantics, call routing, or emergency handling.

Supersedes the dashboard-layout gripe recorded 2026-07-05 (`docs/handoffs/2026-07-05-phase3-phaseD-kickoff-handoff.md` carry-forward) and absorbs the call-tile polish backlog from `docs/handoffs/2026-07-10-call-tile-polish-batch1-handoff.md`.

**Terminology.** *Visually gated* means: styled to read as unavailable, but **not** HTML-`disabled` — the control stays enabled and focusable so a click can be intercepted (§3.4).

**Plan sizing.** This spec covers two areas — the dashboard column and the call surfaces — joined by the shared `<ConnectControl>`. The implementation plan may split them into two phases; the shared component should land before the surfaces that consume it.

Mockups (living, may drift from this doc — the doc is authoritative):
- Dashboard: `https://claude.ai/code/artifact/78b99223-36b3-4979-969e-bfdf3e4886ab`
- In-call overlay: `https://claude.ai/code/artifact/155ff0d9-e84e-48ae-8c75-d6717b129bf2`

---

## 1. Why

Two long-standing complaints, plus a groomed backlog of nits.

**The right column is mostly empty.** `components/dashboard-workspace.tsx:79-101` lays the dashboard home out as `lg:grid-cols-[minmax(0,1fr)_340px]`. The 340px aside holds exactly two children: `Softphone` and `VideoCallHost`. `VideoCallHost` is **headless** — it renders no visible chrome of its own. So the column is one content-height softphone card in an `items-start` grid, and everything below it is dead space by construction.

**Audio and video surface asymmetrically.** Video was pulled out of a persistent card in Phase 3 (it now rings on property cards + Web Push), but audio kept its softphone card. Kumar, 2026-07-05: *"What was the point of removing video from the left rail if we're keeping audio as is anyway?"*

**Corrected usage model (Kumar, 2026-07-18).** Prior docs describe the agent as permanently remote-session-foreground with the portal in the background. That is **stale**. Agents are trained to disconnect RustDesk as soon as the guest is handled, and during dull time they are parked on the dashboard or in another tab. This is not a call centre; volume is low and dull time is long. Consequence for this design: **the dashboard is a screen she looks at for hours, so dead space is not merely untidy.** `CLAUDE.md` should be corrected separately (§12).

---

## 2. Scope

### In

| Area | Change |
|---|---|
| Softphone card | Ring becomes the go-on-duty control when off duty |
| Right column | New **shift card**; new **clocks card** |
| Copy | `Accepting calls` → `Not accepting calls` when off duty |
| Interaction | Off-duty guard: gated controls intercept and offer to start the shift |
| Header | Empties of everything shift-related; `DutyMenu` retires |
| Property card | The `answerGated` → "Go on duty" label swap is removed |
| Call surfaces | Extract `<CallShell>`; rework both control bars |
| Call surfaces | Remove `Hold` + `Swap`; normalize `End`; fixed-width toggles; grouping |
| Video overlay | Reopen-tile becomes a round mint-outlined icon button in the corner |
| Shared | `<ConnectControl>` replacing four hand-rolled copies |
| Observability | `RoomEvent.Disconnected` → Sentry on unexpected disconnect |

### Out

- **RustDesk fullscreen occluding the tile** — closed 2026-07-19. See §8.
- **Tile-reopen crash** — closed as not reproducible. See §8.
- **Admin off-home softphone** — Web Push already covers it. See §8.
- **Per-agent home-zone highlighting on the clocks** — cut; see D6.
- **Off-duty "last shift" readout** — cut; see D4.
- Duty semantics (D13 server-truth), call routing, 911 machinery, playbook content, kiosk.

### Non-negotiable invariants

- **Zero migrations.** Satisfies the blue-green additive-only rule trivially while the Vercel standby lives.
- **911 machinery is untouched.** Audio's 911 control moves only if §5 says so, and its two-tap arm/confirm logic stays byte-identical.
- **No change to `POST /api/presence/*`.** All four routes (`go-on-duty`, `end-shift`, `take-break`, `resume`) keep their current contracts. This work relocates callers, not semantics.

---

## 3. Dashboard

### 3.1 Column composition

The aside keeps its 340px width and its two existing children, and gains two cards. Final order, top to bottom:

1. **Softphone card** — unchanged position. `VideoCallHost` stays mounted and headless beneath it.
2. **Shift card** — new.
3. **Clocks card** — new.

The softphone card is deliberately **not** merged into the shift card. Kumar, 2026-07-18: *"leave the current softphone tile as is (copy edit later with ux) and slot the proposed card right below it."* Its copy is deferred to a later UX pass.

> **Consequence:** because both new cards live in the aside, they inherit the aside's `hidden` behaviour off-home (`dashboard-workspace.tsx:92-95`). See §3.5.

### 3.2 Softphone card — the ring becomes the duty control

`components/softphone/softphone.tsx:819-827` renders a 64px ring with a `Phone` icon and an `lc-seam-drift` glow layer. The in-file comment calls it *"decorative anchor, not a status light"* — it currently has no function.

**Off duty:** the ring becomes an actionable control that calls the same handler as the retired header button. The `lc-seam-drift` glow, which already exists, becomes meaningful: it is the only bright thing on an otherwise greyed screen. Label beneath: `Go on duty`. Sub-copy changes to `Your line is offline.`

**On duty:** reverts to today's decorative anchor with `Incoming calls ring here.`

**Accepting toggle** (`softphone.tsx:829-847`) reads `Not accepting calls` and is visually gated while off duty. It is **not** HTML-`disabled` — see §3.4.

Card structure is otherwise untouched. Note for the implementer: this card is a **hand-rolled `<div>`** (`softphone.tsx:774`), not `<Card>` — the only major dashboard panel that isn't. Converting it is **out of scope**; do not opportunistically refactor it in this work.

### 3.3 Shift card

| State | Contents |
|---|---|
| On duty | Running clock · `On duty since HH:MM` · `Break` and `End shift` buttons |
| On break | Break indicator · `Resume` · `End shift` |
| Off duty | `Not on duty` — nothing else |

Every value already exists client-side: the elapsed clock is what `duty-control.tsx:157-164` renders today, and break/resume/end map to the existing presence routes.

**Deliberately excluded:** a "calls tonight" figure (Kumar: *"not needed, shows on the chart anyway"*) and a "last shift" readout (see D4).

`Line ready` / `Accepting` do **not** appear here — the softphone card directly above owns both, and duplicating them would be worse than the dead space this replaces.

### 3.4 The off-duty guard

Gated controls **stay enabled and focusable.** Clicking one opens a small dialog:

> **You're off duty**
> That isn't available until your shift starts. Would you like to start it now?
> `Start my shift` · `Not yet`

`Start my shift` calls the same go-on-duty handler as the ring; `Not yet` dismisses.

**Why not `disabled`:** a `disabled` button fires no click event, so it cannot be intercepted. It also gives touch users no feedback whatsoever and is low-contrast for everyone. Keeping the control live and responding on use is both the only way to build this and the better accessibility outcome.

**Applies to:** the Accepting toggle, and property-card `Connect` and `Answer`.

**Security note:** this is presentation only. The authoritative gates stay exactly where they are — `softphone.tsx:587` (`if (!canWorkRef.current) return;`) and the server-side D13 duty check. The guard must **not** become the only thing preventing an off-duty action.

### 3.5 The header empties

`DutyControl` is removed from the header slot (`dashboard-workspace.tsx:83`). `DutyMenu` (`duty-control.tsx:75-89`) retires; `End shift` becomes a first-class labelled button on the shift card, keeping its `LogOut` icon.

**Two polish items are absorbed rather than fixed separately:**
- *Inconsistent pill sizing* — caused by `Go on duty` (`duty-control.tsx:122`) being the sole default-size `h-9` control in an otherwise all-`h-8` row. It leaves the header entirely, so the mismatch cannot recur.
- *Distinct End-shift icon* — `End shift` stops hiding behind a `ChevronDown` and becomes a visible `LogOut` button.

**Accepted consequence (Kumar, 2026-07-18: "just go with a clean header with nothing shift related on it"):** an ADMIN on a non-home route (`/admin/users`, `/admin/calls`, …) has no duty affordance and must navigate home to end a shift. AGENTs never hit this — `AGENT_NAV` has exactly one entry. The 10h `MAX_SHIFT_MS` cap force-closes a forgotten shift regardless, so nothing runs away.

### 3.6 Property card

Remove the `answerGated` label swap at `property-card.tsx:129-137`. The button reads `Answer` in all states; the off-duty case is handled by §3.4's guard, not by a per-card "Go on duty".

This also **retires the audio/video asymmetry** noted during exploration: video showed a duty gate on the card while audio's Answer stayed enabled, `animate-pulse`-ing, and silently no-op'd off duty (`property-card.tsx:58`, `softphone.tsx:587`). After this change neither channel gets special treatment — one guard covers both.

Kumar's rationale: with five properties per pod and more later, a per-tile "Go on duty" repeated across every card reads as noise.

**Card anatomy, for the record** (verified at `property-card.tsx:95-143`): a kiosk online/offline dot beside the name; `Answer` and `Silence` rendered **only while ringing**; and `{connectSlot}`. There is **no "Kiosk" button** — an early mockup invented one.

### 3.7 Clocks card

Four analog faces, 2×2. Labels: `India` · `US · Eastern` · `US · Central` · `US · Pacific`.

- **Analog, not digital** — the shift card directly above already carries a large digital mono clock; four more numeric readouts beneath it would read as one undifferentiated block.
- **Day/night tinting** — light face for 06:00–17:59 local, navy face otherwise. Analog is ambiguous about AM/PM, and for someone reasoning across a 10.5-hour offset "is it the middle of the night in Pacific" is the actual question. This is the one thing analog does *better* than digital here, not just differently.
- Rendered from `Intl.DateTimeFormat` with an explicit `timeZone`. No server data, no new route.
- Each face carries an `sr-only` textual time so the information is not vision-only.
- Update interval 20s is sufficient for minute-hand accuracy; do not tick per second.

**Not redundant with per-property times.** Kumar, 2026-07-19: the time on a property card tells the agent *which zone that hotel is in*. These clocks answer *where America is right now*. Different jobs.

---

## 4. Shared call shell

Extract `<CallShell>`, consumed by both in-call overlays.

Both files already carry a `SHARED-CHROME SEAM` comment predicting this exact need (`audio-call-overlay.tsx:140-142`: *"If the two drift, extract a shared `<CallShell>` consumed by both"*), and they have already drifted — 37/63 in audio versus 40/60 in video.

`<CallShell>` owns: the header strip, the `--color-call` stage slot, the playbook slot, and the control bar. Differences become **explicit props**, not accidental divergence:

| Prop | Audio | Video |
|---|---|---|
| `split` | 70/30 | 60/40 |
| `stage` | none | guest video |
| `emergency` | 911 present | absent |

**Kumar, 2026-07-19: the audio/video differences in 911 and the video stage are deliberate and must not drift further.** Making them props is what enforces that.

On the split: audio has no video to show, so its call card genuinely needs less room than video's. 70/30 gives the playbook meaningfully more space; 63/37 was, in Kumar's words, *"barely noticeable compared to 60-40."*

---

## 5. Control bar

### 5.1 Remove `Hold` and `Swap`

Both are hardcoded `disabled` with `title="Coming soon"` (`video-call.tsx`, ~line 670). Hold was **deferred entirely to multi-property** when the Phase-3 plan was gated. They occupy prime control-bar space doing nothing, and removing them is what creates room for everything else here.

### 5.2 Normalize `End`

Today `End` is `text-[1.1875rem] font-bold` with an 18px icon while every sibling is `text-sm` with a 16px icon — a one-off scale hack.

It drops to the shared control scale, stays navy (`bg-primary`), stays the visually heaviest control in the bar, and is relabelled **`End call`**. Removing Hold and Swap more than pays for the longer label.

### 5.3 Stop the bar reflowing

`Mute`/`Unmute` and `Cam off`/`Cam on` change button width when toggled, shifting the row under the agent's cursor mid-call. Labels become fixed-width `Mute` and `Camera`, with state carried by fill rather than by text.

### 5.4 Grouping

Call controls (`Mute`, `Camera`, `Captions`) sit together in one tray. `Connect` and `End call` are separated by a divider, because they leave or end the call rather than adjust it — `Connect` in particular hands off to RustDesk and is a categorically different action from a mic toggle.

---

## 6. Reopen-tile control

**Placement: a round, icon-only button in the true bottom-right corner of the guest video stage, with a mint outline.**

Today it is a teal filled pill at `bottom-16 right-3` (`video-call.tsx:510-522`), floating above the caption band and reading as mid-frame against a guest who fills the shot.

- **Icon-only circle, ~38px.** Far smaller footprint over a live person than a labelled pill.
- **True corner.** The caption band (`video-call.tsx:508`, `absolute inset-x-3 bottom-3`) insets its right edge while the button is present, rather than the button floating above the band.
- **Mint outline on a scrim.** Mint is the live/connect role in the brand, so it reads as *available action*. **This is the app's first mint outline-only treatment** — a small new pattern rather than reuse of an existing one. Called out so it is a choice, not an accident.
- **Accessibility:** icon-only requires `aria-label="Reopen tile"` plus a native `title` tooltip. Removing the visible label must not remove the name for assistive tech, and the tooltip is how a new agent learns the icon.

Rejected alternatives: keeping the teal pill (chrome over the guest, and a second teal fill competing with `Connect`); moving it into the control bar (Kumar found it accessible but disliked it there).

**Audio has no video stage**, so there is no corner to tuck this into. On the audio overlay the reopen control goes **in the control bar**, as a labelled button — the only sane placement absent a stage, and the space freed by removing `Hold` and `Swap` covers it. This is the one place the control-bar placement survives.

---

## 7. Shared `<ConnectControl>`

`Connect` exists in four places across two colour families:

| Site | Treatment |
|---|---|
| `components/dashboard/connect-button.tsx:43-60` | navy `variant="neutral"`, **no icon**, has duty gate + inline error |
| `components/softphone/audio-call-overlay.tsx:296-303` | teal `bg-accent` + `Monitor` |
| `components/video-call/video-call.tsx:683-692` | teal `bg-accent` + `Monitor` — `className` **byte-identical** to the above |
| `components/call-tile/call-tile.tsx:324-333` | same recipe scaled for the tile |

One `<ConnectControl>` replaces all four, taking icon, label, tone and click delegation as props.

**The navy/teal split is kept**, deliberately: teal-on-white and teal-on-navy read differently, and the in-call surfaces are dark. The shared component makes unifying a one-prop change if Kumar later wants to test it.

**Behavioural gap to close:** none of the three in-call copies carry the duty gate or the error affordance the canonical component has (`connect-button.tsx:27,54-58`). In-call, a failed remote-access launch is currently **silent**. `<ConnectControl>` should surface the error on every surface.

Also fix: disabled `Connect` on the tile is low-contrast on navy (teal@50% on ink@50%) — an edge case reachable only when `propertyId == null`.

---

## 8. Closed, not built

**RustDesk fullscreen occluding the tile — closed 2026-07-19.** Kumar tested on the Windows PC: a *fresh* Connect opens RustDesk fullscreen with the tile correctly on top; the tile only ends up behind when a RustDesk session is **already connected** and merely gets raised. This matches the source behaviour — `setNewConnectWindowFrame` runs its placement path only `if (preSessionCount == 0)`. **The fix is the SOP that already exists:** disconnect RustDesk after each guest, which is what agents are already trained to do. Ops note, not code. LC cannot reach it anyway — the `rustdesk://` scheme parses only `key`, `password`, `switch_uuid`, `relay`.

**Tile-reopen crash — closed as not reproducible.** Repeated attempts on the same setup never reproduced it. **The mechanism remains real and latent:** in livekit-client 2.20.0 `disconnectOnPageLeave` defaults `true` and the `freeze` listener is registered **ungated**, both on the main window, so any `pagehide`/`beforeunload`/`freeze` makes the SDK disconnect the room itself — cleanly and silently. That is what made the Phase-E `rustdesk://` gotcha real, and it stays a standing hazard. The local-only branch `debug/tile-reopen-audio-only` is unpushed; deleting it is Kumar's call.

**Related finding worth recording:** Kumar observed Windows allowing **two applications to hold the webcam simultaneously** (Google Meet and Lobby Connect, both with video and audio flowing). This contradicts the sourced claim that Windows Media Foundation is exclusive-access by default, and it undermines the original report's premise that a busy camera forced an audio-only fallback.

**Admin off-home softphone — dropped.** Verified working: `public/push-sw.js:51-67` focuses the tab and posts `focus-home`, and `dashboard-workspace.tsx:73` turns that into `router.push(HOME[role])`. The residual — silencing a ring requires a trip home, and no ambient line status off-home — is minor.

**`RoomEvent.Disconnected` → Sentry.** The one piece of the closed investigation kept. The portal has **no disconnect handling at all** on its LiveKit leg, so a dropped room produces no Sentry event, no log, and no UI. That invisibility is precisely why a week of investigation produced no evidence. A handler that reports an unexpected disconnect (with `DisconnectReason`) turns a recurrence into an issue instead of a rumour. A disconnect following a local `leave()` is expected and must not report.

---

## 9. Decision log

| # | Decision | Rationale |
|---|---|---|
| **D1** | Softphone card stays; shift card slots **below** it | Kumar 2026-07-18. Rejected merging them into one duty card. |
| **D2** | The softphone ring becomes the go-on-duty control | Kumar's idea. The ring is already decorative-only and already has a glow; this gives both a job. |
| **D3** | Header empties completely | Kumar 2026-07-18, overriding the earlier "duty pill stays top-right" decision. Absorbs both time-tracker polish items. |
| **D4** | Off-duty shift card shows `Not on duty` only | `lib/shifts/query.ts`'s `fetchTimesheet` is admin-scoped and consumed only by `/admin/shifts`; a "last shift" readout would need net-new agent-facing plumbing for a state lasting seconds. Kumar: *"no need to build that, just cut the line."* |
| **D5** | No "calls tonight" on the shift card | Kumar: already on the chart. |
| **D6** | Clock labels are geographic; **no** home-zone highlight | Kumar 2026-07-19: some agents may be US-based, so there is no universal "you". Could return later derived per-agent; not worth building now. |
| **D7** | Analog clocks with day/night tinting | Differentiates from the digital shift clock above; answers the AM/PM question analog otherwise loses. |
| **D8** | Gated controls stay enabled and intercept | A `disabled` button fires no click and cannot be intercepted; it is also worse for touch and keyboard. |
| **D9** | Extract `<CallShell>`; audio 70/30, video 60/40 | Gets both of Kumar's options at once — one component (no further drift) with the ratio as a parameter. |
| **D10** | Remove `Hold` and `Swap` | Permanently disabled; Hold deferred to multi-property. Frees the space everything else needs. |
| **D11** | `End` → `End call`, at the shared control scale | Kumar 2026-07-19. Removing two dead buttons pays for the longer label. |
| **D12** | Reopen-tile = round mint-outlined icon button, video corner | Kumar preferred the ghost treatment but not mid-frame placement. Chrome does not belong on live guest video. |
| **D13** | Keep the navy/teal `Connect` split | Surface-appropriate; `<ConnectControl>` makes reversing it one prop. |
| **D14** | Keep a `RoomEvent.Disconnected` → Sentry handler | The only durable value salvaged from the closed crash investigation. |

---

## 10. Testing

**Unit / jsdom**

- Clock formatter: a pure function mapping `(instant, timeZone) → {hours, minutes, isNight}`, tested with fixed instants across the DST boundary for each zone. **Do not** assert on wall-clock `now`.
- Off-duty guard: clicking a gated control while off duty opens the dialog and **does not** call `connectToProperty` / `acceptAudio` / the accepting mutation. This is the load-bearing test for §3.4 — the controls are no longer `disabled`, so nothing else proves a click cannot get through.
- Guard confirm path: `Start my shift` calls the same handler as the ring.
- Shift card renders the correct state for on-duty / on-break / off-duty.
- `Not accepting calls` copy appears only when off duty.
- `<ConnectControl>`: renders its error state; delegates click; disabled variant carries an accessible name.
- Reopen button exposes an accessible name while icon-only.
- `RoomEvent.Disconnected`: reports to Sentry on an unexpected disconnect; **stays silent** after a local `leave()`.

**Not jsdom-verifiable — prod smoke required**

CSS placement, the ring glow, day/night tinting, the corner button against real guest video, control-bar reflow, and the 70/30 vs 60/40 split. Standing lesson from the 2026-07-17 kiosk session: verify by **looking at and interacting with** the real thing on real hardware — never by reasoning or a static screenshot.

**Regression guard.** The 911 two-tap path and all call/notes/emergency handlers must be byte-identical after the `<CallShell>` extraction. Review this line-by-line rather than trusting the test suite.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| `<CallShell>` extraction silently changes 911 or notes behaviour | Byte-level review of the emergency and notes paths; they are pure relocation. Highest-risk item in this spec. |
| The off-duty guard becomes load-bearing for authorization | Explicitly presentation-only; server-side and `softphone.tsx:587` gates stay. Tested. |
| Removing `disabled` lets an off-duty click through | Dedicated test; the guard intercepts in the capture phase. |
| Admin cannot end a shift off-home | Accepted (§3.5). `MAX_SHIFT_MS` backstops it. |
| Header emptying leaves it visually thin | Reviewed live at smoke; the greeting band was already the header's main content. |
| Mint outline-only is a new pattern | Flagged (§6). Revisit if it reads as alert rather than action. |

---

## 12. Follow-ups (not this spec)

- Correct the stale "permanently remote-session-foreground" framing in `CLAUDE.md` (and the corresponding memory note).
- Softphone card copy edit (Kumar deferred to a later UX pass).
- Dead code: `ChannelBar` / `ChannelLegend` in `components/dashboard/channel-viz.tsx` have zero references repo-wide.
- Stale doc: `docs/v2-backlog.md:108` still describes `IncomingCallToast` and a persistent right-column Video card as current; both were deleted in Phase 3.
- Converting the softphone's hand-rolled card `<div>` to `<Card>`.
