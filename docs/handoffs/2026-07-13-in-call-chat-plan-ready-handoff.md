# Handoff — In-Call Kiosk⇄Agent Chat: spec + plan DONE, ready to build

**Date:** 2026-07-13
**Branch:** `in-call-chat` (off `main` @ `6dfcabc`) — **design only, no product code yet**
**Status:** Brainstorm ✅ · Spec ✅ · Plan ✅ · **Implementation ⏳ (this is the next session's job)**

## START HERE (next session)

1. Read this handoff.
2. Read the spec: `docs/specs/2026-07-13-in-call-kiosk-agent-chat-design.md` (decision log D1–D12).
3. Read the plan: `docs/plans/2026-07-13-in-call-kiosk-agent-chat.md` (13 TDD tasks, Phases A–F).
4. Check out the branch (`git checkout in-call-chat`) and execute the plan with **superpowers:subagent-driven-development** (fresh subagent per task + two-stage review — this project's standard build discipline).

## What this feature is (one paragraph)

Ephemeral, bidirectional **text chat** between the kiosk (guest) and the agent, **during video calls only**, for the speech-failure exception path: bad audio, heavy accents / limited shared language, or the ID scanner missing a license (agent asks the guest to *type* their address). It rides the **existing LiveKit call room** via data channels — zero new infra, zero DB, **no persistence**. It never carries card data (client-side redaction). Standalone/out-of-call chat and audio-call chat are explicitly out.

## The decisions already locked (do NOT re-litigate)

- **Transport = LiveKit data channels** (`publishData`/`DataReceived`), `publishData` + a tiny versioned JSON envelope. Sender is derived from the **LiveKit participant identity**, never the payload. Grant needs `canPublishData`.
- **Video-only** (AUDIO = Twilio, no room, no screen). Works on the busy-webcam audio-only fallback (still a LiveKit room).
- **Ephemeral** — no storage, no receipts, no history, no migration, no RLS change. Reset per `active.callId`. Mirrors the live-captions pattern end-to-end.
- **PCI guard = both layers:** active kiosk-side redaction (`redactCardNumbers`: 13–19 digits + Luhn, masked **before** publish) + a passive "don't type card numbers" notice. Proven by a TDD positives/negatives table. This is load-bearing — it keeps LC out of PCI scope even though our LiveKit relay is self-hosted.
- **Surfaces:** kiosk = **Option A** side-by-side (video left, chat right; input rides above the on-screen keyboard; auto-opens on the agent's first message). Agent tile = **Video⇄Chat toggle** (fixed 380×300, can't resize). Agent overlay = **Playbook⇄Chat tab**.
- **Typing indicator** = animated pure-CSS three dots (iMessage-style), reduced-motion aware, both directions; throttled ping + receiver watchdog.
- **Sound** = **agent-side only, inbound only**, bundled licensed `chat-message.mp3` (Kumar's Envato asset at `~/Downloads/chat-message/chat-message.mp3` → copy to `apps/portal/public/sounds/chat-message.mp3`, mirroring `ring.mp3`). Kiosk is visual-only (auto-open makes a kiosk sound unnecessary). The web can't play OS system sounds — this is why we bundle an asset.
- **Build on the current call-surface shape** — the refactor plan's CallShell (Stage 3) / provider-slimming (Stage 6) are NOT prerequisites. Captions is the proof the shape absorbs one more ephemeral text stream.

## Reference implementation to mirror (captions)

Chat is captions-with-a-text-box on the portal side. Copy these patterns:
- Relay: `apps/portal/components/dashboard/call-surface-provider.tsx` — caption store/publish/subscribe/snapshot kept OUT of the memoized value (`:168-180`, `:126-133`), reset per `active.callId` (`:372-376`). Chat adds a parallel `chat` relay.
- Tile subscription: `apps/portal/components/call-tile/call-tile.tsx:113-116` (`useSyncExternalStore`).
- Message parsing isolated: `apps/portal/lib/captions/messages.ts` → chat's equivalent is shared `packages/shared/src/chat-protocol.ts`.
- Registered call-controls seam: `RegisteredCallControls` (`call-surface-provider.tsx:59-64`) — chat adds `sendChat`/`sendTyping`.
- LiveKit adapters where `room` is in scope but unexposed: portal `apps/portal/lib/video/livekit-session.ts:65-129`; kiosk `apps/kiosk/src/lib/video/livekit.ts:48-123`.

## Constraints to carry into the build

- **Byte-review** every diff touching live-call paths: the two LiveKit adapters, `video-call.tsx`, `call-tile.tsx`, kiosk `App.tsx`. Additive-only — call/media/notes/emergency behavior stays byte-identical. (Plan tasks are flagged `[BYTE-REVIEW]`.)
- **Standby invariants still hold** (blue-green window not yet decommissioned): additive-only, don't rename `agora_channel_name`, don't touch Vercel `AGORA_*`/`vercel.json`/Analytics. This feature needs none of those — no migration at all.
- **Staging discipline:** staging migrations must be back-applied when prod ships new ones — N/A here (no migration), but smoke on staging via Coolify (`staging` branch) before any merge. Deep-link/WebRTC gotcha from Phase E still applies generally (don't navigate the top window during a live call) — chat doesn't launch anything, so it's clear.
- **Prod deploys from `main` on merge** (Coolify auto-build). Do NOT merge until the staging smoke (plan Task 13) passes. Video-quality judgments need the **real iPad** (Mac Chrome is a pessimistic proxy) — but chat is text, so the iPad matters only for the kiosk layout/keyboard behavior, which Kumar wants to eyeball live anyway.

## Open tweaks Kumar flagged for "once I see it live"

- Tile Video⇄Chat toggle styling ("we can tweak it slightly once I see it live if need be").
- Kiosk Option A exact split ratio / keyboard behavior on the real iPad.
These are polish, not design reopens.

## Repo state

- Branch `in-call-chat`: 2 commits — `2f24839` (spec), `138fd86` (plan). Nothing else touched.
- `main` is unchanged (chat is isolated on its branch).
- The visual-companion mockups from the brainstorm are in `.superpowers/brainstorm/…` (gitignored, local-only) — not needed to build; the spec/plan carry everything.
- The `analysis-and-audit-2026_07_11/` folder remains deliberately uncommitted (separate decision; not part of this feature).

## Definition of done (this feature)

All 13 plan tasks merged, full CI green, staging smoke passed (both chat directions, typing dots, card-number masking, chime, tile toggle, overlay tab, reset-on-new-call), then merge `in-call-chat` → `main` (auto-deploys prod). Update the CLAUDE.md build-status table + `chat-feature-direction` memory on merge.
