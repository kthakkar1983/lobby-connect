# Notes Durability + Error Surfacing, and the Owner Calls Tab

**Created:** 2026-06-10 (session 17). **Status:** LOCKED — ready for `writing-plans`.
**Context:** 2026-06-10 architecture-audit remediation (`TASKS.md`). Sits between Phase 1
(H1/H2/H3 — done) and Phase 2 (P2-1 seam extractions). H1 patched the *symptom* of notes loss
(a stale closure) with a ref-mirror; this addresses the *shape* of the problem — a single
unretried, silently-swallowed write — and bundles a related owner-portal UX change the user asked
for in the same session.
**Audit cross-refs:** the swallowed-error pattern underlies audit items #2 (emergency rollback),
#15 (presence), and the general "fire-and-forget `.catch(()=>{})`" smell. This work does **not**
replace P2-1 (server-side `requireApiActor` seam); it is the *client* side and is orthogonal.

---

## 1. Scope

Two threads, one PR. Both are deliberately **minimal + pilot-proportional** (one hotel, one agent
at a time, tiny data volumes).

**In scope:**

- **Thread A — agent-side reliability.** A small shared `reliableFetch` helper (retry + Sentry on
  exhaustion). Rewire the call-notes save so a failed save is **retried and, if it still fails,
  surfaced inline with the typed text preserved** — never silently dropped. Route the other
  consequential one-shot writes (`answered`, `emergency/control`, `end-video`) through the same
  helper for observability.
- **Thread B — owner Calls tab.** A **note icon** on rows that have notes; rows **expand inline**
  instead of navigating to a sparse detail page; a **channel filter** (All / Phone / Video).

**Out of scope / non-goals:**

- **No autosave, no localStorage drafts.** (User decision — see §1 decisions.) Notes still persist
  at call-end; we only make that save reliable and its failure visible.
- **No server/DB/RLS/migration changes.** `POST /api/calls/notes` and the `calls` schema are
  unchanged. Owner reads use the existing RLS-scoped client. Zero migrations.
- **No change to call routing, Twilio/Agora glue, presence derivation, finalization, or the
  emergency state machine.** We only change how *client write failures* are retried and surfaced.
- **Not P2-1.** The server-side auth-preamble seam is a separate task; this PR leaves those routes'
  internals alone beyond swapping the client-side `.catch`.
- **No new toast usage on the agent surface.** The failure affordance is inline (user decision).

**Decisions locked by the user (session 17 brainstorm):**

1. **Persistence durability → "keep call-end save + retry."** Not autosave-to-DB, not a localStorage
   net. Smallest change that closes the silent-loss hole for the common (transient) failure.
2. **Hard-failure UX → "inline + text preserved."** A persistent, dismissible banner with Retry /
   Discard, decoupled from call phase. Not a toast (missable), not silent-with-a-badge.
3. **Owner notes → "indicator only, no preview"** — a note icon next to the channel icon.
4. **Owner rows → expand inline** (accordion), not navigate; the standalone detail page felt empty.
5. **Audio/Video → a filter up top.**
6. **Shape choices (recommended, reversible):** the helper is a plain async util (not a hook — it
   must work inside the bare SDK-event closures and stay trivially testable); the inline expansion
   **pre-loads** detail data with the list query rather than lazy-fetching (free at pilot scale).

---

## 2. Problem — current state

**Notes flow.** The agent types Room # + notes into local React state during a call. They are
persisted exactly **once, at call-end**, via a fire-and-forget POST:

- `apps/portal/components/softphone/softphone.tsx:206` — `endCall()` → `fetch("/api/calls/notes", …).catch(() => {})`
- `apps/portal/components/video-call/video-call.tsx:109` — `handleEnd()` → same, `.catch(() => {})`
- Server: `apps/portal/app/api/calls/notes/route.ts` updates `calls.room_number` + `calls.notes`
  scoped to `handled_by_user_id = user.id`; returns `204`.

Failure modes that survive H1's ref-mirror fix:
1. The one POST fails (blip / 5xx) → notes lost, agent never knows, nothing in Sentry.
2. `endCall()` clears `roomNumber`/`notes` and resets phase regardless of the save outcome — so even
   a recoverable failure destroys the text.

**Error swallowing.** The agent call surfaces swallow almost every write:
`postPresence`, `answered` (`softphone.tsx:176`), `notes`, `emergency/control`
(`softphone.tsx:194,229`), `end-video` (`video-call.tsx:119`) — all `.catch(() => {})`. None reach
Sentry (Sentry is only wired into the route-segment `error.tsx` boundaries). The notes loss was
invisible for *exactly* this reason; the same blindness hides every other failure.

**Owner Calls tab.**
- List `apps/portal/app/(owner)/owner/calls/page.tsx` — rows show time · status · `secondary`
  (`property · handler · Room N · duration`). **No notes indicator**; the query doesn't select
  `notes`. Clicking a row **navigates** to `/owner/calls/[id]`.
- Detail `apps/portal/app/(owner)/owner/calls/[id]/page.tsx` — renders a sparse fields grid + a
  Notes `SectionCard` (hidden when empty). Mostly empty page → the user wants this inline instead.
- Audio and Video calls are intermixed with no way to separate them.

---

## 3. Thread A — `reliableFetch` + notes durability + error surfacing

### 3.1 `apps/portal/lib/http/reliable-fetch.ts` (new, TDD'd)

```ts
reliableFetch(
  input: RequestInfo,
  init?: RequestInit,
  opts?: { retries?: number; label: string },
): Promise<Response | null>
```

Behavior:
- Attempts the fetch. **Retries** (default `retries = 2`, so ≤3 total) with short backoff
  (e.g. 300ms · 900ms) on a **thrown** error (network) or a **5xx** response.
- **Does not retry** on a received non-5xx response (incl. 4xx) — returns it immediately; retrying a
  401/400 won't help.
- Returns the `Response` if any response was received (any status); returns **`null`** only when all
  attempts threw.
- **Sentry:** `captureException` with `{ label, status? }` context when it ultimately fails —
  i.e. on a `null` return (network exhausted) or a final 5xx. 4xx is the caller's domain (surfaced,
  not auto-reported).
- No React, no `fetch` wrapper magic — a plain function callable from anywhere, including the bare
  `call.on("disconnect")` / Agora `user-left` closures.

Callers treat **`null` or `!res.ok`** as failure.

### 3.2 Notes save rework — decouple "unsaved notes" from call phase

The save outcome must outlive the call, so a recoverable failure can't be wiped by the phase reset.

**Softphone (`softphone.tsx`):**
- New top-level state: `notesSave: "idle" | "saving" | "failed"` and a preserved
  `pendingNotes: { callId, roomNumber, notes } | null`.
- `endCall()` (refactored): do call teardown + phase reset **immediately** (the call is over), then
  fire the save via `reliableFetch("/api/calls/notes", …, { label: "calls.notes" })` using the
  ref-mirrored values. On success → clear `pendingNotes`, `notesSave = "idle"`. On `null`/`!ok` →
  `notesSave = "failed"`, keep `pendingNotes`.
- **Unsaved-notes banner** — rendered at the **top of the widget, independent of `phase`**, whenever
  `notesSave === "failed"`:
  > "Couldn't save notes from the last call." **[Retry]** **[Discard]**
  - **Retry** re-runs the save with `pendingNotes` (shows `saving`); success clears it.
  - **Discard** clears `pendingNotes` (agent's explicit choice; no confirm — low stakes).
  - Because it's phase-independent, a **new incoming call is not blocked** — the banner sits above
    the normal incoming/in-call UI until resolved.
- *Known limitation (documented seam):* only **one** pending unsaved-note is tracked; a second
  failed call-end before the first is resolved overwrites it. Acceptable for a one-agent pilot.

**Video-call (`video-call.tsx`):**
- `handleEnd()` (refactored): tear down video (close tracks, leave channel) as today, then save via
  `reliableFetch`. On success → `onClose()`. On failure → **keep the overlay mounted** in a
  "call ended — notes unsaved" state showing the same Retry / Discard affordance; `onClose()` only
  after the save resolves or the agent discards. `video-call-host.tsx` is unchanged (still owns
  `onClose`).

### 3.3 Other one-shot writes → through the helper (observability, UI mostly unchanged)

Swap `.catch(() => {})` → `reliableFetch(…, { label })` for the **consequential one-shots**:

| Site | Label | UI on failure |
|---|---|---|
| `answered` (`softphone.tsx:176`) | `calls.answered` | none — Sentry only (nothing the agent typed is at stake; `/status` webhook is a backstop) |
| `emergency/control` leave/mute (`softphone.tsx:194,229`) | `emergency.control` | keep optimistic UI; Sentry on failure |
| `end-video` (`video-call.tsx:119`) | `calls.end_video` | none — Sentry only (reaper is the backstop) |
| emergency **trigger** (`softphone.tsx:247`) | `emergency.trigger` | keep the existing bespoke `emergencyFailed` banner; **also** `captureException` |

### 3.4 Deliberately left best-effort

The **20s presence heartbeat** (`postPresence`, `softphone.tsx:33`) stays fire-and-forget **by
design** — a single missed tick self-heals on the next interval, so retry/Sentry would only add
noise. This boundary is documented in a code comment so it reads as intentional, not an oversight.

---

## 4. Thread B — Owner Calls tab

### 4.1 Note icon on rows

`CallRow` shows a small `StickyNote` (lucide) icon next to the phone/video channel icon when
`hasNotes` is true. No preview text (user decision). `hasNotes` is computed **server-side** as
`Boolean(call.notes?.trim())` so the boolean is always available even though the note text is also
sent down for the expansion.

### 4.2 Rows expand inline; shared `CallDetailBody`

- `CallRow` becomes `"use client"` with local `expanded` state; the channel/notes/time/status header
  becomes a button that toggles. Expanded → renders `<CallDetailBody data={…} />` below the header
  (accordion). Uses an accessible disclosure (`aria-expanded`, `aria-controls`).
- **New** `apps/portal/components/owner/call-detail-body.tsx` — presentational, takes a normalized
  `CallDetail` shape and renders the fields grid + incident link + Notes + recording seam (the body
  currently inlined in the detail page). Used by **both** the inline expansion and the standalone
  page → single source of truth.
- The standalone `/owner/calls/[id]` page is **kept** (the incident detail page deep-links to it,
  `incidents/[id]/page.tsx:84`). It fetches the same `CallDetail` shape and renders the back-link +
  `<h1>` + `<CallDetailBody>`.

### 4.3 Enriched list query + batched incident lookup

The list `page.tsx` query gains the detail fields the body actually renders, so the expansion has
everything in memory: `caller_number, notes, recording_url` (added to the existing select). One
**batched** incidents-existence query (`incidents` where `call_id in (…)`, select `id, call_id`)
builds a `Map<call_id, incidentId>`. Property name/tz and handler names are already resolved on this
page. The expansion renders instantly — **no per-expand round-trip**.
- *Documented seam:* if the calls list ever grows large, switch the expansion to lazy-fetch on first
  open; the `CallDetailBody` component and its prop shape stay identical.

### 4.4 Channel filter (Audio / Video)

A pill row up top — **All · Phone · Video** — mirroring the existing property-filter pills and the
`?property=` pattern. New `?channel=AUDIO|VIDEO` search param, validated against the `CallChannel`
union (`@lc/shared`); when set and valid, `.eq("channel", channel)` is added to the query. Composes with `?property=`. `moreHref` (Load more)
and the property pills preserve the active `channel`; the channel pills preserve the active
`property`. "Phone" is the label for `AUDIO` (matches the detail page's "Phone call").

---

## 5. Data flow

**Notes save — happy path:** type → hang up → teardown + phase reset → `reliableFetch` POST → `204`
→ `pendingNotes` cleared. (Indistinguishable from today for the agent.)

**Notes save — failure path:** type → hang up → teardown → `reliableFetch` retries (≤3) → still
failing → Sentry capture + `notesSave="failed"` → **banner with preserved text**. Agent taps
**Retry** (network recovered) → `204` → banner clears. The text was never in danger.

**Owner expand:** list renders rows (each carrying its full `CallDetail` payload + `hasNotes`) →
agent taps a row → `expanded` toggles → `<CallDetailBody>` renders from in-memory data. Tap the
note-bearing row of a video call filtered via **Video** → same, instant.

---

## 6. Testing

- **`reliable-fetch.test.ts`** (Vitest, mocked `fetch`): success first try; retry-then-succeed on
  5xx; exhaustion → `null` + one `captureException`; 4xx → returned immediately, no retry, no
  capture; backoff attempt count. (Sentry mocked.)
- **Channel-filter guard:** validate `?channel=` against the `CallChannel` union (`@lc/shared`) —
  valid pass-through; junk → no filter. If extracted to a small `lib/owner` helper, unit-test it
  there; trivial enough to keep inline otherwise.
- **Component (jsdom lane from H1):** softphone — simulate a failed notes save (mock `fetch` reject),
  assert the unsaved-notes banner renders with the typed text and that **Retry** re-POSTs; assert a
  successful save shows no banner. (Extends `tests/components/softphone.test.tsx`.)
- The existing suite stays green; no server/RLS tests change.

---

## 7. Files

**Create:**
- `apps/portal/lib/http/reliable-fetch.ts`
- `apps/portal/tests/http/reliable-fetch.test.ts` (node lane — the runner only globs `tests/**`)
- `apps/portal/components/owner/call-detail-body.tsx`

**Modify:**
- `apps/portal/components/softphone/softphone.tsx` — `reliableFetch`; `notesSave`/`pendingNotes` +
  banner; route `answered`/`emergency`/`emergency.control` through the helper.
- `apps/portal/components/video-call/video-call.tsx` — `reliableFetch`; keep-overlay-on-failure +
  Retry/Discard; route `end-video` through the helper.
- `apps/portal/components/owner/call-row.tsx` → `"use client"`, expand state, note icon,
  `<CallDetailBody>`; `CallRowData` gains the detail payload + `hasNotes`.
- `apps/portal/app/(owner)/owner/calls/page.tsx` — enriched select, batched incidents map, channel
  filter pills + param, `moreHref`/pill href param preservation, build `CallDetail` per row.
- `apps/portal/app/(owner)/owner/calls/[id]/page.tsx` — render shared `<CallDetailBody>` under the
  back-link/header (de-dupe the inlined body).
- `apps/portal/tests/components/softphone.test.tsx` — failure-banner cases.

**Unchanged:** `app/api/calls/notes/route.ts`, all migrations, RLS, routing, presence derivation,
finalization, `video-call-host.tsx`.

---

## 8. Build sequence

1. `reliable-fetch.ts` + tests (red→green).
2. Rewire softphone notes save + banner; component test.
3. Rewire video-call notes save + keep-overlay-on-failure.
4. Route the other one-shot writes through the helper.
5. `CallDetailBody` extraction; point the detail page at it (no behavior change yet).
6. Owner list: enriched query + incidents map + `CallDetail` per row.
7. `CallRow`: client, expand, note icon.
8. Channel filter pills + param plumbing.
9. Full suite + lint + typecheck; manual prod smoke (notes save success + forced-failure banner;
   owner expand + filter).
