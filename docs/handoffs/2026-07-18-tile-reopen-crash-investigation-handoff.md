# Handoff — Tile-reopen crash: root-cause LEAD found, diagnostic built but PARKED (2026-07-18)

**START HERE.** Two things happened this session:

1. **SHIPPED to `main`:** the outbound-video-calls close-out paperwork (tag, worktree, branches, plan stamp). Done, pushed, nothing left.
2. **PARKED (deliberately not merged):** a deep root-cause investigation into the open bug *"Reopen tile crashes the call when the agent's camera is busy."* It produced a **verified mechanism candidate** and a **ready-to-run diagnostic build** — held back because we cannot yet get trustworthy repro data. **Read §3 before touching this bug again.**

- Predecessors: [`2026-07-17-kiosk-connection-lines-net-zero-handoff.md`](2026-07-17-kiosk-connection-lines-net-zero-handoff.md) (net-zero) · [`2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md`](2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md) (the standing agenda) · [`2026-07-11-tile-primary-shipped-plus-followups-handoff.md`](2026-07-11-tile-primary-shipped-plus-followups-handoff.md) (where this bug was first written up, as item **A**)

## Current state

| Thing | State |
|---|---|
| `main` | **`0eb674e`** = `docs(outbound-video): stamp plan complete + cut close-out tag`. `origin/main` == `0eb674e`. |
| Prod | Untouched by this session's investigation. The close-out was docs-only. |
| Tag | **`plan-outbound-video-calls-complete`** cut at **`8ee3ae5`** (the fix merge that made outbound video actually-working) and pushed. |
| Diagnostic branch | **`debug/tile-reopen-audio-only`** — 2 commits (`3520ecc`, `aa24e8e`), 7 files, +385/−8. **LOCAL ONLY, never pushed, not on `main`.** See §4. |
| Untracked | `analysis-and-audit-2026_07_11/` — leave it (prior key leak, never `git add -A`). |

---

## 1. Outbound-video close-out — DONE

All four items from the 07-16 handoff's "Next actions → A" are complete:

- Worktree `.claude/worktrees/quizzical-lamarr-3dcccc` removed.
- Deleted 4 stale branches: `outbound-video-calls`, `outbound-video-presence-ownership`, `fix/flaky-duty-resync-test`, plus the leftover `claude/quizzical-lamarr-3dcccc` worktree branch. (Root `pnpm lint` no longer emits worktree noise.)
- `docs/plans/2026-07-15-outbound-video-calls.md` stamped **STATUS: COMPLETE** with the final two steps checked.
- Tag `plan-outbound-video-calls-complete` at `8ee3ae5`, pushed.

**Left open on purpose:** `task_71d65b0a`. The generalized `end-video` presence reset fixed its primary path, but the *"recovery heartbeat throttled behind foregrounded RustDesk"* sub-case is a separate residual. Kumar's call whether to close the chip.

---

## 2. The tile-reopen bug — NEW facts that change the framing

### 2a. What the 07-11 handoff did NOT know

Kumar supplied the environment this session, and it reframes everything:

- **It has never reproduced on a Mac.** On the Mac both apps get video simultaneously, so Lobby Connect never falls back to audio-only and never crashes.
- **The real incident was on a WINDOWS PC**, cross-browser: **Google Meet live in Microsoft Edge** holding the webcam, **Lobby Connect in Chrome**. The agent left Meet running and switched to Chrome to answer a test call from the kiosk.
- **Kumar has not recreated the exact scenario**, and the original observation came from the India-based agent.

### 2b. ⚠ THE CONFOUND — do not repeat this mistake

The 07-11 handoff framed the causal variable as *"the agent's camera is busy → audio-only."* **That is confounded.** The camera was busy **because a second live video conference was running**, so "audio-only" travels together with "two concurrent WebRTC sessions + memory/GPU pressure on a Windows box." Either could be the real trigger and they imply completely different fixes:

| If the cause is… | Then the fix is… |
|---|---|
| audio-only uplink | something about how the tile opens against a video-less peer connection |
| concurrent load / page freezing | nothing to do with the tile at all |
| the interaction of both | a narrow conditional guard |

**Any future repro must separate these** (see §5 for the experiment design).

### 2c. The mechanism candidate — VERIFIED in the installed SDK

This is the session's real find. In **livekit-client 2.20.0** (our pinned version, read directly out of `node_modules`):

```js
// Room, on connect:
if (isWeb() && this.options.disconnectOnPageLeave) {   // <-- DEFAULT TRUE, we never override it
  window.addEventListener('pagehide',     this.onPageLeave);
  window.addEventListener('beforeunload', this.onPageLeave);
}
if (isWeb()) { window.addEventListener('freeze', this.onPageLeave); }   // <-- UNGATED

this.onPageLeave = () => { this.log.info('Page leave detected, disconnecting');
                           yield this.disconnect(); };
```

- `disconnectOnPageLeave: true` is the shipped default (`roomOptionDefaults`), and `buildLiveKitVideoOptions()` in `packages/shared/src/video.ts` **does not set it**.
- These listeners are on the **MAIN window** — the one where the Room was constructed.
- **Any `pagehide` / `beforeunload` / `freeze` on the main window makes the SDK call `room.disconnect()` itself.**

That produces **exactly this bug's fingerprint**: a *clean participant leave* (so the kiosk takes its `onAgentLeft` → home path, not the apology path), **no thrown exception, no Sentry event, and no app-level `leave()` call**.

**This also explains a gotcha we already had but never understood.** CLAUDE.md records from Phase E: *"deep-link launches must NEVER navigate the top window while a WebRTC call is live"* — the `rustdesk://` bug where `window.location.assign` on the main window killed the LiveKit PeerConnections. **This handler is why that was true.** Same class, same signature.

Upstream corroboration: livekit/client-sdk-js issue **#1968** (open) reports the identical signature — clean server-side leave, `RoomEvent.Disconnected reason=undefined`, no WS close frame — triggered by Edge Sleeping Tabs.

### 2d. ELIMINATED by source inspection (not guesswork)

- **adaptiveStream / dynacast are `false`** by default (`roomOptionDefaults`) and we never set them ⇒ LiveKit is **not** watching element visibility, so hiding/moving the video element cannot trigger a subscription renegotiation.
- **LiveKit's DocPiP-aware `RemoteVideoTrack` observer (upstream PR #1868, already in 2.20.0) never registers for us** — element observation is gated behind `adaptiveStreamSettings`, which is undefined when adaptiveStream is off.
- **`devicechange` has no disconnect authority** in the SDK: `handleDeviceChange → selectDefaultDevices()` is a floating promise with no path to `disconnect()`.
- **No known Chromium bug** exists for DocPiP breaking WebRTC — searched WICG spec repo, livekit repos, Stack Overflow. ⚠ *Coverage caveat: `issues.chromium.org` is sign-in gated, so only issue titles were readable; a Chromium bug could exist and be invisible to that search.*
- **Per spec, `requestWindow()` fires nothing on the opener** (no pagehide/freeze/visibilitychange) — only an `enter` event on the controller. *Not verified:* whether Chrome sets the opener's `visibilityState` to hidden.

### 2e. One genuinely new Windows-only fact (source-backed)

Chrome on Windows runs an `IMFSensorActivityMonitor` (**enabled by default**) that fires **`devicechange` when another application merely grabs or releases the webcam** — no physical device change. Windows' Media Foundation is exclusive-access by default and Chrome never sets the sharing attribute. **There is no Mac equivalent**, which is a real platform asymmetry worth keeping in mind.

> **Sourcing correction:** an earlier claim in this session that *"macOS shares the camera"* was **inference, not sourced** — no authoritative source was found. What is actually established is (a) Kumar's own observation that both apps got video on the Mac, and (b) that **Windows exclusivity IS source-backed**.

### 2f. The candidate fix — NOT APPLIED

`disconnectOnPageLeave: false` in our room options, since `video-call.tsx` already owns teardown explicitly via `lkSession.leave()`.

**Deliberately not applied.** It is still a guess until a trail confirms which mechanism actually fires. Shipping it blind would likely *mask* the real cause rather than fix it — and if the true cause is page **freezing**, this option does **not** help, because the `freeze` listener is registered **ungated**.

---

## 3. ⚠ WHY THIS IS PARKED (read before resuming)

**Kumar's decision, 2026-07-18:** the India-based agent is not very tech-savvy. Running the diagnostic would mean waiting on her to reproduce it and then trusting her description of what happened — and **Kumar cannot be confident in information relayed that way**. Acting on unreliable evidence risks committing to a wrong mechanism *with false confidence attached*, which is worse than having no data.

**So: do NOT ship a fix for this bug off reasoning alone.** The analysis in §2 is strong but it is a *lead*, not a confirmed root cause. The Iron Law stands — no fix without a confirmed root cause, and the only thing that confirms it is a real trail from a real repro.

---

## 4. The parked diagnostic branch

**`debug/tile-reopen-audio-only`** — commits `3520ecc` (instrumentation) + `aa24e8e` (LiveKit log capture). **LOCAL ONLY — never pushed to origin.** If the machine changes or the branch is pruned, this work is gone and must be rebuilt from this document.

**Safety:** every call site is a **no-op unless `?tilediag=1`** is set, so the branch is inert even if merged. Full gate was green on it: typecheck · lint · **1202 tests** (shared 52 · kiosk 74 · portal node 835 · portal jsdom 241) · `check:routes` · portal + kiosk builds.

### Files

| File | Change |
|---|---|
| `apps/portal/lib/debug/tile-diag.ts` | **new** — bounded ring-buffer event sink + `diagEnabled()` (`?tilediag=1`, sticky via `localStorage` key `lc.tilediag`; `?tilediag=0` clears), `errName()`, `enumName()` |
| `apps/portal/components/debug/tile-diag-strip.tsx` | **new** — on-screen trail, fixed bottom-left, copy/clear, live `alive Ns` tick; registers opener-lifecycle + `devicechange` listeners |
| `apps/portal/lib/video/livekit-session.ts` | `RoomEvent.Disconnected` (+`DisconnectReason`), `ConnectionStateChanged`, `Reconnecting`/`Reconnected`, `LocalTrackUnpublished`, `MediaDevicesError`; `diag` in `leave()`; **captures the `getUserMedia` error names the catch blocks currently swallow**; `setLogLevel("debug")` + `setLogExtension` routing the SDK's own logs into the trail (filtered to lifecycle/teardown lines) |
| `apps/portal/lib/duty-tile/call-tile-manager.ts` | `requestWindow` invoked / RESOLVED / REJECTED, document-prepared, `pagehide` |
| `apps/portal/components/video-call/video-call.tsx` | join-effect **unmount** cleanup, `handleEnd` entry, `onGuestLeft`, `collapsed` transitions |
| `apps/portal/components/dashboard/call-surface-provider.tsx` | `openTileForCall` (records **whether a call was live** at open time), `tile.closed` (programmatic vs user); renders `<TileDiagStrip/>` in the **main** window |
| `apps/portal/tests/lib/video/livekit-session.test.ts` | mock gains `DisconnectReason`, `setLogLevel`, `setLogExtension` — the session destructures them, and vitest throws on destructuring an export a mock does not define |

### Why an on-screen strip and not the console

**DevTools attaches to the Document-PiP window and kills it**, so the console is unusable while reproducing a tile bug (memory `call-tile-polish` / chat-feature notes). The strip lives in the **main** window so it survives the tile — and the call — dying.

### The decision table the trail produces

| Trail shows | Cause |
|---|---|
| `lk.log [info] Page leave detected, disconnecting` | **SDK page-lifecycle teardown** — and the preceding `win.pagehide` / `win.freeze` / `win.visibilitychange` names which event did it |
| `videocall.unmountCleanup` → `lk.leave called by app` | **React remount** — our own code tore the room down |
| `lk.DISCONNECTED reason=…` with **neither** of the above | transport / server drop (`SIGNAL_CLOSE`, `DUPLICATE_IDENTITY`, …) |
| `alive Ns` tick **frozen** | the page/renderer itself died (the load branch) |
| `tile.requestWindow RESOLVED` present or absent before the drop | **auto-answers the 07-11 open question**: did the PiP window open first, or did the call die on the click? |

---

## 5. How to resume (when a trustworthy repro is possible)

**Precondition: a Windows PC and someone whose report can be trusted — ideally Kumar himself.** A Mac cannot reproduce this at all.

1. `git checkout debug/tile-reopen-audio-only`, re-run the gate, deploy it somewhere the Windows box can reach (staging is safest; prod is inert without the flag).
2. Open the portal once with **`?tilediag=1`** (sticky thereafter).
3. Run the confound-separating experiment — **cell A is the high-value one**:

| | Camera held by | Load | If it crashes, it means |
|---|---|---|---|
| **A** ⭐ | Windows **Camera app** (no call) | light | **audio-only is the cause**; load is irrelevant |
| **C** | Edge/Meet with **camera off** | heavy | **load is the cause**; audio-only is irrelevant |
| **B** | Edge/Meet live (the original) | heavy | known-crashing control |

   Each run: hold the camera → answer a kiosk video call in Chrome → confirm the audio-only banner → **"Back to tab"** → **"Reopen tile"** → **copy the diag strip**.
4. Read the trail against the decision table in §4, *then* pick the fix.
5. **Free check that needs no deploy:** open **`chrome://crashes`** on that Windows PC. A GPU/renderer crash record around an incident would support the load branch immediately. (Note: the research argues *against* the crash branch — a renderer/GPU/capture-service crash would not produce a *clean* leave — but the `alive Ns` tick settles it either way.)

**Alternative, zero-synthetic-repro path:** deploy to prod, enable `?tilediag=1` once on the agent's Windows machine (sticky), and wait for it to happen on a real shift. Trades control for not needing her to run anything — she'd only need to send a screenshot.

**When the bug is closed, delete the instrumentation** — `lib/debug/tile-diag.ts`, `components/debug/tile-diag-strip.tsx`, and every `diag(...)` call site. One piece is arguably worth keeping permanently: **a `RoomEvent.Disconnected` handler that Sentry-logs an unexpected disconnect.** The portal currently drops rooms *silently* (no `Disconnected`/`ConnectionStateChanged` handling at all), which is exactly why this bug left no trace for a week.

### Interaction with the "Connect reopens the tile" feature (still true)

`connectToProperty` calls `openTileForCall()` when a call is live and the tile is closed — **the same `requestWindow` path** as the manual "Reopen tile" button. So this bug affects **both** surfaces in the camera-busy case. Fixing it protects both.

---

## 6. Standing agenda (unchanged)

Everything below is carried forward untouched from [`2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md`](2026-07-16-outbound-video-smoke-fixes-shipped-handoff.md):

- **Kiosk camera/mic prompts — Tier 1** (Kumar, on the pilot iPad, ~5 min): Auto-Lock Never · **Guided Access → Mirror Display Auto-Lock = ON** (GA blanks the screen at 20 min without it) · Safari camera/mic **"Allow for This Website"**, never "Allow Once" · do **NOT** "Add to Home Screen".
- **Kiosk Safari → native WKWebView wrapper** — pre-second-hotel, tracked in migration plan Phase-5 step 5. Own brainstorm→spec→build.
- **RustDesk credential hardening** (encrypt-at-rest + fail-closed issuance audit) — post-pilot / pre-second-hotel, same plan step.
- **Tile-polish backlog:** Connect color-split (card navy vs in-call teal), quiet the Reopen-tile pill, shared `<ConnectControl>`, disabled-Connect contrast, reopen reposition. Fold in `[[dashboard-layout-rework-deferred]]`.
- **Time-tracker UI:** duty-pill polish (consistent pill sizing; distinct End-shift icon). *Placement change was DECLINED — stays top-right.*
- **Bigger deferred (own brainstorm each):** attention-aware dormant/wake tile · RustDesk true-fullscreen macOS-Spaces SOP.

## 7. Gotchas (new + standing)

- 🆕 **livekit-client disconnects the room itself on `pagehide`/`beforeunload`/`freeze` on the main window** (`disconnectOnPageLeave` defaults true; `freeze` is ungated). This is the mechanism underneath the Phase-E rustdesk gotcha. Anything that disturbs the top document's lifecycle during a live call can end it — cleanly and silently.
- 🆕 **The portal's LiveKit leg has NO disconnect handling**, so a dropped room is invisible: no Sentry, no UI, no log. Budget for that when debugging any "the call just ended" report.
- 🆕 **A confounded variable nearly sent this investigation the wrong way.** "Camera busy" and "second video conference running" are the same event. Separate them before believing either.
- **DevTools kills the Document-PiP window** — never plan a tile repro around the console.
- **Never `git add -A`** — `analysis-and-audit-2026_07_11/` stays untracked (prior key leak). Stage explicit paths.
- **Prod auto-deploys from `main` on merge (Coolify).** Reload the iPad kiosk after a kiosk deploy — it caches the old Vite bundle.
- **Blue-green invariants (until decommission):** additive-only migrations; do NOT rename `agora_channel_name`; Vercel `AGORA_*` env + the Agora account stay; `KIOSK_CONFIG_SECRET` identical.
- Supabase refs: **prod `ztunzdpmazwwwkxcpyfp`**, **staging `cgtvqjxhbojztzumshca`**.
- **Don't judge video on a Mac** — the iPad's hardware H.264 is the real gate.
