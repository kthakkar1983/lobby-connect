> **SUPERSEDED (2026-07-14)** by `docs/handoffs/2026-07-14-in-call-chat-smoke-complete-handoff.md` — chat is now merged, prod-smoked, and the 3 smoke findings are fixed + verified. This doc is kept for history.

# Handoff — In-Call Kiosk⇄Agent Chat: BUILD COMPLETE, staging smoke + merge pending

**Date:** 2026-07-14
**Branch:** `in-call-chat` (off `main` @ `6dfcabc`) — **all code built, gated, hardened, reviewed; NOT merged**
**Status:** Brainstorm ✅ · Spec ✅ · Plan ✅ · **Build ✅ (13 tasks)** · CI gates ✅ · Whole-branch review ✅ · **Staging smoke ⏳** · **Merge ⏳**

## START HERE (next session)

The feature is fully implemented on `in-call-chat`. What remains is **manual + Kumar-gated**:
1. Deploy the branch to staging (Coolify auto-builds the `staging` branch — rebase/merge `in-call-chat` onto `staging`, or push a staging preview; no migration to back-apply — chat is zero-DB).
2. Run the **staging smoke** (checklist below) on the **real iPad kiosk + an agent** — Kumar wanted to eyeball the kiosk Option-A layout + tile toggle live anyway.
3. If green, **merge `in-call-chat` → `main`** (Coolify auto-deploys prod). Then update the CLAUDE.md build-status table + the `chat-feature-direction` memory (deferred to merge, per the plan's Definition of Done).

## What was built (11 feature commits + 2 review-fold-in commits)

`7eb7b0d`→`1432b11` = plan Tasks 1–12; `8d0d93e` + `c1e800e` = review fold-ins. +~1355/−59 across 30 files. **Zero migration / RLS / DB / new routes.**

- **Shared (`@lc/shared`):** `redactCardNumbers`+`luhnValid` (`chat-redact.ts`); versioned tolerant `encodeChat`/`decodeChat`/`newMessageId` + typing throttle/expiry predicates (`chat-protocol.ts`).
- **Transport:** `canPublishData` on the video token; `sendData`/`onData` seams on BOTH LiveKit adapters (portal `livekit-session.ts`, kiosk `livekit.ts`/`types.ts`) — byte-reviewed additive.
- **Portal:** chat relay on `CallSurfaceProvider` (captions-mirror, kept out of the memo, reset per `active.callId`); `video-call.tsx` owns publish/subscribe with redaction + local echo + **sender-from-LiveKit-identity** + a typing watchdog; new `ChatDock` + pure-CSS `TypingIndicator`; **tile Video⇄Chat toggle + unread badge + chime** (`chat-message.mp3` asset added); **overlay Playbook⇄Chat tab** (delegates send through the registered controls; no chime — tile is the sole audible alert).
- **Kiosk:** local chat state in `App.tsx` + `onData` (post-teardown guarded) + **auto-open on the agent's first message** + **mandatory pre-publish `redactCardNumbers`**; Option-A side-by-side `Connected` layout + Type button; own `TypingIndicator`. Kiosk perspective: local user = guest (guest bubbles right/sent, agent left/received — inverse of portal).

## Verification done

- **Full CI gate GREEN (twice):** `pnpm lint && pnpm typecheck && pnpm check:routes && pnpm -r --parallel test` all exit 0. Tests: shared 47 · kiosk 40 · portal 194. `gen:types:check` unaffected (no migration).
- **Per-task discipline:** each of the 12 tasks TDD'd + two-stage reviewed (byte-review on every live-call-path diff — the two adapters, `video-call.tsx`, `call-tile.tsx`, kiosk `App.tsx` — all confirmed additive; media/notes/emergency/captions byte-identical).
- **Opus whole-branch review = SHIP (no Critical).** Confirmed: byte-review holds, sender identity never spoofable (derived from the LiveKit participant identity, not the payload), redaction runs before the wire on both sides (tests assert the *decoded wire bytes* are masked), no double-chime/double-append, forward-compat tolerant decode.

## Review findings + resolution

- **Important — redactor leaked a PAN on plausible glued inputs** (card+expiry = 20 digits over the 19-cap, card+CVV = 19 fails whole-Luhn, dot-separated). It matched the *original* spec D7 but undercut the PCI-firewall claim. **Kumar chose "harden now."** `8d0d93e` hardens `redactCardNumbers`: recognizes dot separators + a **bounded, anchored embedded scan** (a Luhn-valid 13–19 window at the start/end of a 19–25-digit run with ≤6 leftover) — closes the leaks while **provably preserving every existing negative** (runs ≤18 digits are never embedded-scanned, so the 16-digit fail-Luhn case is structurally untouched; runs >25 digits aren't masked, so legit long numbers don't over-mask). Spec §6/D7 updated to match. Residual accepted edge: two full cards mashed into one >25-digit run.
- **Minor #2 — kiosk `onData` lacked the portal's post-teardown guard** → `c1e800e` adds `if (aborted()) return;` (mirrors the portal's `cancelled` guard). Inert during a live call; drops only late packets after teardown.
- **Minor #3/#4** (kiosk watchdog interval runs app-lifetime; overlay badge can show for tile-seen messages) — cosmetic, left as-is.

## Staging smoke checklist (plan Task 13 Step 3)

- Video call connects (kiosk ⇄ agent) as today (no regression).
- Guest taps **Type** → Option-A split; type "1425 Oak Street" → appears on the agent tile + overlay.
- Agent replies from the **tile** (Video⇄Chat toggle) → appears on the kiosk; the agent's first message **auto-opens** the kiosk chat.
- **Typing dots** show both directions; clear on send + after the ~5s watchdog.
- Type a **test card number** on the kiosk (e.g. `4111 1111 1111 1111`, and `4111 1111 1111 1111 1225`) → it is **masked** before it appears on the agent side.
- **Chime** plays on the agent side on inbound (⚠ verify it actually plays from the DocPiP window — the `<audio>` lives in the PiP document; if silent, move it to the main-window overlay). Kiosk is silent.
- Overlay **Playbook⇄Chat** tab works; tile-open collapses the overlay to playbook-only.
- Call end / new call → thread resets (nothing persists).

## Open live-eyeball tweaks Kumar flagged (polish, not reopens)

- Kiosk Option-A split ratio (currently 55/45) + on-screen-keyboard behavior on the real iPad; CallControls sits inside the 55% video column (may read off-center) — tune live.
- Chat panel is a light `bg-card` column on the dark stage — Kumar may prefer all-dark.
- Tile Video⇄Chat toggle styling (a `rounded-[3px]` segment) — tweak live.

## Repo state

- `in-call-chat` HEAD = `c1e800e`; `main` unchanged. `analysis-and-audit-2026_07_11/` remains deliberately untracked.
- Superseded: `docs/handoffs/2026-07-13-in-call-chat-plan-ready-handoff.md` (this doc replaces it).
