# In-Call Kiosk⇄Agent Chat — Design

**Date:** 2026-07-13
**Status:** Design (spec) — approved in brainstorm; implementation plan next
**Relates to:** greenlit-in-principle 2026-07-12 (memory `chat-feature-direction`); mirrors the v1.1 live-captions ephemeral / provider-seam pattern; builds on the current call-surface shape (no refactor prerequisite).

## 1. Summary

An ephemeral, bidirectional **text chat** between the hotel kiosk (guest) and the agent, available **during video calls only**, for the exception path where speech fails: bad audio, heavy accents / limited shared language, mutual comprehension gaps, or the ID scanner missing a license (the agent asks the guest to *type* their address). It reuses the existing LiveKit call room via data channels, stores nothing, and never carries card data.

It is explicitly **not** a messaging product: no inbox, no history, no standalone/out-of-call chat. It is a safety net for the minority of calls where voice breaks down.

## 2. Scope

**In scope (v1):**
- Bidirectional typed messages over the live video-call room.
- Three surfaces: kiosk Connected screen, agent call tile (DocPiP), agent in-call overlay (portal tab).
- Animated typing indicator (both directions).
- Agent-side inbound chime (bundled licensed mp3).
- PCI card-number redaction (kiosk + agent), client-side, before send.

**Out of scope (v1 non-goals; seams noted where relevant):**
- Persistence / history / message audit — ephemeral by construction.
- Delivery / read receipts.
- Translation — leave only a `lang` field seam; its own future feature (high value, not easy).
- File / image sharing — also a PII/PCI risk (a photo of an ID or card).
- Standalone / out-of-call chat — rejected 2026-07-12.
- Chat on Twilio **audio** calls — no LiveKit room and no guest screen; technically inapplicable.

## 3. Why video-only

AUDIO calls ride Twilio (`@twilio/voice-sdk`); there is no LiveKit room, and the guest is on a phone with no screen. VIDEO (kiosk) calls ride LiveKit, and the guest is at a tablet with a keyboard. Chat therefore rides the LiveKit room and is inherently video-only. It works on any LiveKit-room call, including the busy-webcam **audio-only fallback** (still a room + a screen).

## 4. UX per surface

### 4.1 Kiosk (guest) — Option A: side-by-side

- **Entry:** a **"Type"** button joins Mute / Camera / End in `CallControls`. Chat **also auto-opens when the agent sends the first message**, so the guest never has to discover it.
- **Resting (chat open, keyboard down):** the agent video docks to a left column (~55%); a chat column on the right (~45%) holds the thread + input. When the keyboard is dismissed it relaxes to the full side-by-side.
- **Typing (keyboard up):** the on-screen keyboard overlays the bottom; the input pins just above it; the agent's face holds the top-left. Chat consumes *horizontal* space while the keyboard consumes *vertical* space, so they overlap in one corner instead of stacking — which is why side-by-side survives the keyboard where a top/bottom split would be crushed.
- A quiet **"Please don't type card numbers."** notice sits under the input.
- **Visual-only** for attention (typing dots + messages appearing); no chime.

### 4.2 Agent call tile (DocPiP, 380×300, always-on-top) — Video⇄Chat toggle

- The tile is the primary surface while the agent is foreground in RustDesk, and **cannot be reliably resized**, so chat shares the fixed window via a **Video ⇄ Chat toggle** (a "tab" inside the tile).
- **Chat mode:** the thread + reply input fill the main area; the guest video shrinks to a corner thumbnail; the existing controls (Mute / Connect / 911 / Hang up) stay.
- A new inbound message **badges the Chat tab** and plays the **agent chime**; a "guest is typing" bubble shows in the thread.

### 4.3 Agent in-call overlay (portal tab) — Playbook⇄Chat tab

- Shown when the agent alt-tabs to the full dashboard with the tile closed. (When the tile is open, this overlay stays collapsed to playbook-only exactly as today — the tile owns the call.)
- The guest video keeps its left position; the right panel — today just the playbook — gains a **Playbook ⇄ Chat** tab. An inbound message while on the Playbook tab badges Chat.

### 4.4 Typing indicator

- iMessage-style three-dot bubble, **pure CSS** (staggered keyframes), honoring the app's existing **reduced-motion** net (dots hold static under `prefers-reduced-motion`).
- Renders as a received-style bubble on the *other* party's side of the thread, replaced by their message when it lands. Same treatment on all three surfaces.

### 4.5 Sound

- **Agent side only, inbound only.** Bundled licensed asset: `chat-message.mp3` (Envato-licensed, per Kumar; source `~/Downloads/chat-message/chat-message.mp3`) copied to `apps/portal/public/sounds/chat-message.mp3`, mirroring the existing `ring.mp3` pattern (its own `<audio>` element).
- Distinct from the incoming-call ring. Plays through the already-unlocked audio context (chat is mid-call, after the Answer / tap-to-connect gestures) via the existing `audio-unlock` priming — no autoplay block.

## 5. Architecture

### 5.1 Transport — LiveKit data channels

- Send with `room.localParticipant.publishData(bytes, { reliable })`; receive via `RoomEvent.DataReceived`. Message payloads use the **reliable** DC (ordered/retried); typing pings may be lossy (`reliable: false`) since a receiver-side watchdog covers a dropped stop.
- Add `canPublishData: true` to the video-token grant at `apps/portal/app/api/video/token/route.ts:29`.
- **Message envelope** (JSON, UTF-8): `{ v: 1, type: "msg" | "typing", id, text?, state?, ts }` — `text` for `msg`; `state: "start" | "stop"` for `typing`.
- **Sender is derived from the authenticated LiveKit participant identity** (`kiosk` vs `agent-<userId>`) on receipt — never self-reported in the payload (a client cannot spoof being the other side).
- **Versioned + tolerant parsing** (`v` present; unknown `type`/fields ignored) because **portal and kiosk deploy separately** — a newer field must not break an older client.
- Envelope encode/parse + the typing throttle/watchdog live as pure helpers in `@lc/shared` (both sides agree on one wire format; mirrors the isolation of `lib/captions/messages.ts`).

### 5.2 Portal (agent) — mirrors the captions pattern

- **Chat relay on `CallSurfaceProvider`:** a non-memoized store (`chatStoreRef` + listeners + `publishChat` / `subscribeChat` / `getChatSnapshot`), kept **out of** the memoized context value so per-message updates don't re-render every consumer — identical to the caption relay. Reset per `active.callId`.
- **`sendChat(text)` + typing signals as registered call-controls** (extend `RegisteredCallControls`), so the tile — a pure mirror — can dispatch a send / typing back to the live-call owner.
- **`video-call.tsx` (the live-call owner) owns the actual publish/subscribe**, via an extended `LiveKitCallSession` interface (`sendData` / `onData` added inside `joinLiveKitCall`, where the `room` object is in scope but today unexposed).
- **`ChatDock`** presentational component (thread + input + typing bubble) reused by the tile and the overlay; a chat tab/toggle control mirrors `CaptionToggle`.

### 5.3 Kiosk (guest) — local state, no provider

- Chat state lives in `App.tsx` (the kiosk has no `CallSurfaceProvider` and no captions), plumbed to `Connected` / `CallControls` like `onMute` / `onEnd`.
- Extend `KioskVideoSession` with `sendData` / `onData` inside `joinLiveKit`.
- New "Type" button + Option A split layout + auto-open on the first agent message.

### 5.4 Typing indicator protocol

- On input change, throttle-send `{ type:"typing", state:"start" }` (at most ~1 per 2s while composing); send `state:"stop"` on send / blur / cleared input.
- Receiver shows the dots on `start`, hides on `stop` **or** after a ~5s watchdog with no refresh (covers a dropped `stop`).

## 6. PCI card-data guard

- Pure `redactCardNumbers(text): string` in `@lc/shared` (used by both apps).
- **Algorithm (hardened 2026-07-14 after whole-branch review):** find maximal runs of `[0-9 .-]` (space, dot, hyphen separators), strip separators → candidate digits, then mask the run iff **either** (a) the whole run is length ∈ [13,19] AND Luhn-valid (the base rule), **or** (b) the run is 19–25 digits and contains a Luhn-valid 13–19 window **anchored at the start or end** with ≤6 leftover digits on the other side — i.e. a PAN glued to a short expiry/CVV. The 19–25 length bound + start/end anchoring keep legitimate long numbers from masking on an interior coincidence, and runs ≤18 digits are never embedded-scanned, so a non-card 16-digit run (a Luhn-failing mistype) stays untouched. Issuer prefix (Visa / MC / Amex / Discover / …) is **not** required to redact, so no real card slips through an incomplete prefix table. *Original spec rule was whole-run-only, which leaked a PAN glued to an expiry/CVV or dot-separated (review finding); the hardened rule above closes those without over-masking. Residual accepted edge: two full cards mashed into one >25-digit run.*
- **Runs on the kiosk before `publishData`** (mandatory) so a PAN never enters the LiveKit stream; applied symmetrically to the agent's outbound text (defense-in-depth).
- Guest-facing "don't type card numbers" notice under the kiosk input.
- **Proven by a TDD table:** positives (real test PANs, spaced/dashed) masked; negatives (house numbers 1–5 digits, ZIP 5/9, phone 10–11, room numbers, dates, order/confirmation numbers) pass untouched.
- **Rationale:** LiveKit is self-hosted, so transmitting a PAN through it would pull cardholder data into LC's path — a hole in the PCI firewall the whole model protects. Client-side pre-publish redaction keeps "LC never touches card data" literally true. See `docs/security-posture.md`; memory `business-model-remote-desktop`.

## 7. Attention model

- Inbound (agent): badge the Chat tab/toggle + play the chime. The always-on-top tile is the alert channel; **no Web Push mid-call** — Web Push stays scoped to the incoming-call ring.
- **Accepted edge:** if the agent **closed** the tile *and* backgrounded the portal, an inbound message waits until they reopen the tile / return to the tab — consistent with the product treating the tile as the in-call surface.

## 8. Reliability / error handling

- The data channel is best-effort infrastructure (like captions / the presence heartbeat). Message payloads use LiveKit's reliable DC; there are still **no delivery/read receipts** — we don't promise reliability we can't guarantee, and both parties are live.
- Input is disabled when the room is not connected; on LiveKit reconnect, re-subscribe. The in-flight thread is client-only and simply resumes.
- A rare dropped line is recoverable by re-typing — a human is present on each end and sees the thread.

## 9. Data model / privacy

- **Zero persistence.** No table, no migration, no RLS change. Messages exist only in client memory for the call's duration and are discarded on call end / `active.callId` change.
- No new PII at rest. A guest-typed address flows through the agent into the PMS via RustDesk (the real record), never into LC's DB — the established posture.

## 10. Testing

- **TDD (pure):** `redactCardNumbers` (positive/negative table), envelope encode/parse (incl. tolerant / unknown-`type` cases), typing throttle + watchdog helper.
- **Component:** `ChatDock` (send, receive-append, typing bubble show/hide, redaction-applied-on-send, badge on inbound while hidden); kiosk chat panel (Type opens, auto-open on agent message, keyboard-up layout).
- **Byte-review** the live-call-path diffs (both LiveKit adapters, `video-call.tsx`, the token grant) per house convention.
- **Staging smoke:** video call → type guest→agent and agent→guest → typing dots both ways → a card number masked before it appears on the other side → tile Video⇄Chat toggle + chime → overlay Playbook⇄Chat tab.

## 11. Sequencing

Build on the **current** call-surface shape. Captions is the existence proof that the shape absorbs one more ephemeral text stream (its provider relay + reuse-across-surfaces pattern) without the refactor plan's CallShell (Stage 3) or provider-slimming (Stage 6). Those remain optional future tidiness, **not** prerequisites for this feature.

## 12. File-touch map (for the plan)

**Shared (`packages/shared/src/`):** `redactCardNumbers` (+ tests); chat envelope encode/parse + typing throttle/watchdog helpers (+ tests).

**Portal (`apps/portal/`):**
- `app/api/video/token/route.ts` — add `canPublishData`.
- `lib/video/livekit-session.ts` — extend `LiveKitCallSession` (`sendData` / `onData`).
- `components/dashboard/call-surface-provider.tsx` — chat relay + `sendChat` / typing controls.
- `components/video-call/video-call.tsx` — own publish/subscribe; wire the relay; overlay Playbook⇄Chat tab.
- `components/call/chat-dock.tsx` (new) + chat toggle/tab control — reused in tile + overlay.
- `components/call-tile/call-tile.tsx` — Video⇄Chat toggle.
- typing-bubble component (new, pure CSS) + chime `<audio>` element.
- `public/sounds/chat-message.mp3` (bundled asset).
- *(the audio in-call overlay is NOT touched — audio calls have no chat.)*

**Kiosk (`apps/kiosk/`):**
- `src/lib/video/livekit.ts` + `src/lib/video/types.ts` — extend `KioskVideoSession`.
- `src/App.tsx` — chat state + plumbing.
- `src/screens/Connected.tsx` + `src/screens/CallControls.tsx` — Type button, Option A split, chat column.
- typing bubble + `redactCardNumbers` import.

## 13. Decision log

- **D1 — Transport = LiveKit data channels.** Not Supabase Realtime / DB-poll / new WS: the room already connects exactly these two peers; zero new infra/DB/auth. `publishData` + JSON envelope, not LiveKit's `useChat`/text-streams (both apps use raw `livekit-client`, not the `@livekit/components-react` framework).
- **D2 — Ephemeral.** No storage / receipts / history (mirrors captions; keeps the PII-light posture).
- **D3 — Video-only** (AUDIO = Twilio, no room, no screen).
- **D4 — Kiosk = Option A side-by-side** (survives the on-screen keyboard; keeps the human present).
- **D5 — Tile = Video⇄Chat toggle** (fixed, non-resizable 380×300).
- **D6 — Overlay = Playbook⇄Chat tab** (consistent with the tile; video always visible).
- **D7 — PCI = active kiosk-side redaction** (13–19 digits + Luhn, pre-publish; **hardened 2026-07-14** to also recognize dot separators and a PAN glued to a short expiry/CVV — see §6) **+ passive notice** — both layers.
- **D8 — Attention = tile badge + agent chime; no mid-call Web Push.** Kiosk visual-only (auto-open makes a kiosk sound unnecessary).
- **D9 — Typing indicator = animated CSS dots**, reduced-motion aware, throttled ping + watchdog.
- **D10 — Sound = bundled licensed `chat-message.mp3` (Envato), agent-side inbound only.**
- **D11 — Sender identity derived from the LiveKit participant identity, not the payload.**
- **D12 — Build on the current shape;** refactor stages are not prerequisites.
