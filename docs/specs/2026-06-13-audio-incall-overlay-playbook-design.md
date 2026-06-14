# Audio in-call overlay + playbook — design

**Date:** 2026-06-13
**Status:** Draft — awaiting review
**Surface:** Agent + Admin portals (`apps/portal/`)
**Migrations / new routes:** none

## Context

The property **playbook** (a PDF of after-hours procedures, FAQs, who-to-call) is shown to the
agent only during **video** calls — `PlaybookPanel` lives in the video-call overlay
(`components/video-call/video-call.tsx`, Plan 6b). The **audio** path (the Twilio softphone, Plan 5b)
never got it. This is a pure sequencing accident: the softphone (5b) shipped before the playbook
(6b), and 6b was built into the video overlay, which audio calls don't render. Phone routing is the
**core product** for the pilot, so an agent answering a hotel's phone needs that hotel's playbook at
least as much as on video.

While scoping, a second gap surfaced: the **agent and admin in-call screens look completely
different** on an audio call. The `Softphone` component is shared, and its in-call markup is identical
for both roles, but the two layouts mount it in very different containers:

- **Agent** (`app/(agent)/layout.tsx:40`): a fixed **320px right rail** → compact card.
- **Admin** (`app/(admin)/layout.tsx:36`): a **full-width strip** below the header → the same card
  stretches edge-to-edge (the softphone root is a plain card with no max-width,
  `softphone.tsx:328`).

Notably, **video already matches across both portals** — video uses a full-screen overlay
(`VideoCallHost` → `VideoCall`), which is layout-independent. Only **audio** diverges, because it
renders inline in differently-shaped containers.

## Goals

1. Surface the property playbook to the agent/admin **during an audio call**, reusing the existing
   playbook route (unchanged) and viewer (one backward-compatible width prop — see below).
2. **Unify the audio in-call screen** so it is identical in the agent and admin portals — and
   visually consistent with the existing video overlay.

## Non-goals (explicit)

- **Idle-state parity.** Admins have no Ready/Away toggle (`role === "AGENT"` gate at
  `softphone.tsx:361`); that is an intentional idle difference and stays out of scope.
- **Refactoring the video overlay.** The video path is smoke-tested and on the live critical path; we
  do not touch it. Audio mirrors its chrome by construction (see Visual consistency).
- **Overlay minimize/collapse** (dashboard access mid-call). Video takes over fully; audio matches.
  Notable as a possible future enhancement, not built here.
- **Anything recording-related** (recording was never enabled; out of scope).
- **Mobile.** Agent/admin portals are desktop-only in v1.

## Design

### The overlay

A new presentational component, **`AudioCallOverlay`**, rendered by `Softphone` when
`phase === "in-call"` (replacing the current inline in-call card section). Because it is a
document-level `fixed inset-0` overlay rendered by the **shared** `Softphone`, it is automatically
identical in both portals regardless of where the idle widget sits.

Structure mirrors the video overlay (`video-call.tsx`):

```
<div className="fixed inset-0 z-50 flex flex-col bg-background">
  ── Header strip ──────────────────────────────────────────────
     live mint dot · "On call · {propertyName}"

  ── Emergency banner (only when emergencyActive / emergencyFailed) ──
     full-width destructive strip (life-safety prominence)

  ── Body row (flex-1) ─────────────────────────────────────────
     [ ~25% call-info rail ]   [ ~75% PlaybookPanel ]
       deep-navy --color-call      <PlaybookPanel callId={callId} />
       property name + live          (the exact component video uses)
       seam/phone motif

  ── Notes-save-failed banner (when a save fails) ──────────────
     "Couldn't save notes…" + Retry / Discard

  ── Control bar ───────────────────────────────────────────────
     Room# · Notes · Mute · Hang up (coral) · 911 (destructive)
```

**Split decision:** ~25% call-info rail / ~75% playbook (not video's 40/60). Audio has no video to
fill the left stage, so the PDF — the actual content on an audio call — gets the room. Same chrome
and deep-navy `--color-call` motif as video, slightly different proportions.

**Differences from the video overlay (by design):**
- Left stage is a **call-info rail** (no video), not a video stage.
- Control bar has **Mute / Hang up / 911**, not Mute / Cam / Hold / Swap. The existing 911
  `AlertDialog` + active/failed emergency banners move into the overlay.

### Component structure

- **`apps/portal/components/softphone/audio-call-overlay.tsx`** (new) — presentational only. Receives
  the in-call state and handlers that `Softphone` already owns:
  - data: `propertyName`, `callId`, `muted`, `roomNumber`, `notes`, `pendingNotes`/`notesSave`,
    `emergencyActive`, `emergencyFailed`.
  - handlers: `onToggleMute`, `onHangUp`, `onTriggerEmergency`, `onRoomNumberChange`,
    `onNotesChange`, plus the pending-notes retry/discard handlers.
  - **Constraint:** the overlay calls `Softphone`'s **existing** handlers — it does **not**
    reimplement mute/hang-up. This preserves the 6c rule that, when `emergencyActive`, Mute/Hang-up
    route through the Conference Participant control endpoint (not the Voice SDK). Reusing the
    handlers keeps that branching intact for free.
- **`Softphone`** (`components/softphone/softphone.tsx`) — when `phase === "in-call"`, render
  `<AudioCallOverlay … />` instead of the current inline `mt-3 space-y-3` block. All call/notes/
  emergency state and effects stay in `Softphone`. The `incoming`/`ready`/`error`/`pendingNotes`
  states keep their current inline rendering in the widget (small Accept/Decline on `incoming`,
  matching video's small incoming banner).
- **Route reused unchanged:** `GET /api/calls/[id]/playbook` (already call-type-agnostic,
  operator-scoped, AGENT/ADMIN-only, rejects OWNER).
- **`PlaybookPanel` move + one prop:** relocate `components/video-call/playbook-panel.tsx` →
  `components/call/playbook-panel.tsx` (it is shared call UI now, not video-specific) and add a `basis`
  width prop (default `basis-3/5` = video's current 60%) so audio can request 75%. Update the import in
  `video-call.tsx` (keeps the default → **video's rendered output is unchanged**) and import it in
  `audio-call-overlay.tsx`.

### Visual consistency with video

Audio mirrors the video overlay's chrome (overlay frame, header strip, deep-navy `--color-call`
stage, bottom control bar, notes-save-failed banner) using the **same brand tokens/classes** — the
match is achieved by construction. `video-call.tsx`'s **rendered output does not change**; its only
edit is the `PlaybookPanel` import path + a seam comment.

**Forward-compat seam (noted, not built):** the common chrome could later be extracted into a shared
`CallShell` presentational component consumed by both `VideoCall` and `AudioCallOverlay`, eliminating
the duplicated chrome. Deferred to keep the smoke-tested video path untouched for the pilot; a code
comment in both files will point to this seam.

### Behavior

- **When shown:** only while on the call (`phase === "in-call"`). Ringing stays the inline
  Accept/Decline in the widget. The overlay unmounts when the call ends (phase leaves `in-call`).
- **Notes durability:** unchanged — `Softphone`'s existing `pendingNotes` mechanism (decoupled from
  call phase, per the 2026-06-10 notes-and-errors work) still owns persistence. If a save fails after
  hang-up, the overlay has unmounted, so the existing **inline** `pendingNotes` Retry/Discard banner
  in the now-idle widget catches it. No regression; the typed Room#/notes are never silently dropped.
- **Both portals:** identical, because the overlay is rendered by the shared component.
- **Desktop only.**

## Files

**New**
- `apps/portal/components/softphone/audio-call-overlay.tsx`
- `apps/portal/components/call/playbook-panel.tsx` (moved from `components/video-call/`)

**Modified**
- `apps/portal/components/softphone/softphone.tsx` — render `<AudioCallOverlay>` on `in-call`
- `apps/portal/components/video-call/video-call.tsx` — update `PlaybookPanel` import path + seam comment
- `apps/portal/tests/components/softphone.test.tsx` — assert the overlay renders on `in-call`

**Unchanged (reused)**
- `apps/portal/app/api/calls/[id]/playbook/route.ts`
- `PlaybookPanel`'s fetch/render logic (only its root flex-basis becomes a prop)

## Testing

- Route + `PlaybookPanel` are already covered (Plan 6b).
- Add a small jsdom test: `Softphone` renders `AudioCallOverlay` with the correct `callId` when
  `phase === "in-call"`, and renders the inline card (not the overlay) otherwise.
- Verify the emergency-control routing constraint is preserved (overlay Mute/Hang-up dispatch the
  same `Softphone` handlers) — assert via the handler wiring, not a new emergency code path.
- Manual smoke (prod, voice is prod-only): answer an audio call as agent → overlay appears with the
  playbook; repeat as admin → identical overlay; 911 dialog still works; hang-up tears down and saves
  notes; a property with no playbook shows the empty state.

## Risks / mitigations

- **Regressing the in-call path while relocating its markup.** Mitigation: state/effects/handlers
  stay in `Softphone` untouched; only the in-call **render** moves into the overlay. Covered by the
  softphone test suite + a prod voice smoke.
- **Breaking the emergency-conference control routing** (the 6c smoke bug). Mitigation: reuse
  `Softphone`'s existing handlers; do not reimplement mute/hang-up in the overlay.
- **`PlaybookPanel` move breaking the video overlay.** Mitigation: pure path change; video overlay +
  existing tests must stay green.

## Open items / future seams

- Extract a shared `CallShell` chrome consumed by both overlays (noted seam above).
- Overlay minimize/collapse for dashboard access mid-call (audio doesn't demand full attention the way
  video does) — only if requested.
