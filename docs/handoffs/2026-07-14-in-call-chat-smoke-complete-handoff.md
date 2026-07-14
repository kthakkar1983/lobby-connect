# Handoff — In-Call Kiosk⇄Agent Chat: PROD-SMOKED + smoke fixes SHIPPED (2026-07-14)

**START HERE.** In-call chat is **built, merged, prod-deployed, live-smoked, and the three smoke findings are fixed + verified.** Kumar's verdict: *"seems to be working… we can mark it done."* This closes the chat thread. This doc supersedes `2026-07-14-in-call-chat-build-complete-smoke-pending-handoff.md`. The overall infra reference stays `2026-07-09-cutover-executed-live-handoff.md`; the other open (non-chat) work is in **OUTSTANDING** below (carried forward from `2026-07-13-max-shift-cap-shipped-handoff.md`).

## TL;DR

- **In-call chat = DONE.** Feature merged `268f11c`; this session shipped two prod-smoke fix merges on top. Ephemeral, video-only, LiveKit data channels, PCI redaction both layers. Zero migration / RLS / DB / new routes.
- **Three smoke issues found on prod, all fixed + Kumar-verified:** chime (two root causes), iPad keyboard scroll, card redaction.
- **Prod is current:** `main` @ `b0cd132`, Coolify auto-deploys `lc-portal-prod` / `lc-kiosk-prod`. Frozen Vercel/Agora standby untouched (instant rollback).

## The three smoke findings + resolutions

### 1. Chime — TWO root causes, two fixes

- **(a) Chat-face gate** (merge `507a509`, `call-tile.tsx`): the tile chimed only while `chatMode !== "chat"`, so once the agent opened the Chat face no later guest message made a sound. The agent lives heads-down in RustDesk with the tile a small always-on-top PiP, so "on the Chat face" ≠ "watching it." → chime on **every** inbound guest line; the unread badge stays gated to the video face.
- **(b) DocPiP autoplay lock** (merge `b0cd132`, the deeper one): the **first** guest message was still silent until the agent clicked into the tile. Root cause = **the DocPiP is a separate document with its own autoplay/user-activation state.** The agent's "Answer" click unlocked the *main* window, not the PiP, so the tile-owned `<audio>` was autoplay-**blocked** until the PiP itself got a gesture. Fix = **move the chime `<audio>` + playback into `CallSurfaceProvider` (main window)**, played from `appendChatLine` on every inbound guest line (never the agent's own echo). The tile now keeps ONLY the unread badge. Main-window audio plays even while backgrounded — same mechanism as the Twilio ring.
- **⚠ DURABLE GOTCHA:** *never rely on a DocPiP document for audio/alerting.* Its autoplay lock is independent of the opener window. Play alert sounds from the main window.

### 2. iPad keyboard scrolled the whole screen up → ✅ VERIFIED FIXED

- Root cause: the kiosk was sized to the **layout** viewport (`html, body, #root { height: 100% }`), which iOS does **not** shrink for the on-screen keyboard — it scrolls the page up to reveal the focused input instead.
- Fix (merge `507a509`): new `apps/kiosk/src/lib/use-visual-viewport-size.ts` drives `#root` height from the **VisualViewport API** + pins `#root` `position: fixed` and locks body scroll → the call area **shrinks to the space above the keyboard**, top stays fixed, no scroll. Kumar: *"looks good now."*

### 3. Card redaction — Luhn gate DROPPED → ✅ VERIFIED FIXED

- Root cause: the smoke typed `4111 1111 1111 1234`, which **fails the Luhn checksum**; the redactor only masked Luhn-valid runs (by spec). Key insight: real cards *always* pass Luhn (so real cards were always caught) — what slipped through was a card-shaped Luhn-failure or a **fat-fingered real card** (~15/16 real digits, in cleartext).
- Fix (merge `507a509`, Kumar chose the aggressive posture): `digitsCarryPan` now masks **any 13–19 digit run regardless of Luhn** (the 20–25-digit embedded scan still uses Luhn). **Accepted, now-live trade-off:** a genuine 13–19 digit number (international phone w/ country code, some 13-digit itinerary numbers) is also masked — recoverable, since the guest is on live video. Spec §6/D7 updated. This **reverses** the earlier hardened "provably preserves every non-card negative incl. the 16-digit fail-Luhn" invariant. Kumar: *"card number hidden now… looks good."*

## Commits this session (all on `main`, prod-deployed)

| Merge | What |
|---|---|
| `507a509` | Fix batch 1: chime-on-every-guest-line + kiosk keyboard VisualViewport shrink + redaction Luhn-gate dropped. Files: `call-tile.tsx`, kiosk `App.tsx`/`index.css`/`use-visual-viewport-size.ts`, `chat-redact.ts`, spec §6/D7. |
| `b0cd132` | Fix batch 2: chime moved from the DocPiP tile to `CallSurfaceProvider` (main window) so the first message is audible. |

TDD throughout (red→green): `chat-redact.test.ts`, `call-tile.test.tsx`, `call-surface-provider.test.tsx`, `use-visual-viewport-size.test.tsx`. **Gate at each merge:** shared 48 / kiosk 44 / portal 770 node + 196 jsdom; typecheck, lint, check:routes; kiosk + portal production builds — all green.

## Remaining chat polish (deferred, NOT reopens)

- Kiosk Option-A split ratio (55/45) on the real iPad — Kumar said the split itself is fine; leave unless he flags it.
- Chat panel light `bg-card` column vs an all-dark treatment on the dark stage.
- Tile Video⇄Chat toggle styling (`rounded-[3px]` segment).
- Standalone (out-of-call) chat stays **REJECTED** (Kumar 2026-07-12). If ever revisited: a third `calls.channel` value `CHAT` on the existing ring/claim/finalize machinery, not an async inbox.

## OUTSTANDING — next chat (carried forward, non-chat)

1. **UI/UX header polish batch (b + c)** — the remaining time-tracker polish (placement change **(a) DECLINED** — duty control stays top-right). Read `components/dashboard/duty-control.tsx` + `components/account-menu.tsx`. **(b)** duty pills aren't consistently sized — unify one pill "shell" (height/min-width/type) across off / on-duty / on-break; consider "On break · Mm" for parity with "On duty · Hh Mm". **(c)** "End shift" and "Sign out" share the `LogOut` icon — give End shift its own (e.g. `TimerOff`). Fold in `[[dashboard-layout-rework-deferred]]` for a broader pass.
2. **Broader deferred agenda (own brainstorm each):** **outbound calls** on the agent dashboard + pod attribution (which `property_id` the outbound leg bills to); attention-aware dormant/wake call tile + RustDesk true-fullscreen SOP; **credential-hardening** (encrypt-at-rest + fail-closed issuance audit) = pre-second-hotel (migration plan step 5).

## Repo state / gotchas

- `main` @ `b0cd132`. Branches `in-call-chat-smoke-fixes` / `chat-chime-mainwindow-fix` merged `--no-ff` + deleted.
- `analysis-and-audit-2026_07_11/` remains **deliberately untracked** (separate Kumar call).
- Blue-green standby invariants still hold until decommission: additive-only migrations, don't rename `agora_channel_name`, Vercel `AGORA_*` + account stay, `KIOSK_CONFIG_SECRET` identical.
- Non-blocking bug still tracked (`task_71d65b0a`): agent stuck 'not accepting' after a VIDEO call (`end-video` doesn't reset presence server-side; recovery heartbeat throttled behind foregrounded RustDesk).
