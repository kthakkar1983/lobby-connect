# Corrections to the duty-column + call-surface polish plan

**Date:** 2026-07-19
**Status:** Verified against source at `main` = `2bcb899`. Branch `duty-column-polish`.
**Applies to:** `docs/plans/2026-07-19-duty-column-and-call-surface-polish.md`

> **Read this file alongside the plan. Where the two disagree, THIS FILE WINS.**
> Every claim below was verified by reading the cited source. The plan was written
> from a spec-authoring session and its line references, helper names and
> per-surface assumptions have drifted or were never checked.

Baseline before any change: **node 835 tests / 123 files, jsdom 241 tests / 27 files — 1076 green.**

---

## 0. Kumar's decision on the audio control bar (2026-07-19)

The spec §5 says "rework both control bars". **Audio's bar has none of the controls §5.1/5.2/5.4 describe.** Verified:

| Surface | Control bar contents |
|---|---|
| Video (`video-call.tsx:645-698`) | Mute · Camera · Captions · **Hold**(dead) · **Swap**(dead) · Connect(teal) · **End**(navy, `text-[1.1875rem]`) |
| Audio (`audio-call-overlay.tsx:294-322`) | Captions · Connect(teal) · Mute · **Hang up**(blaze) |

All controls on BOTH surfaces are hand-rolled `<button>` elements, **not** the shared `<Button>` component.

**Kumar chose:** normalize audio's sizing onto the shared `<Button>` scale (h-8) **and** relabel `Hang up` → `End call`, but **keep it blaze (`bg-attention`), not navy**. 911 stays red in the top-right corner.

So the terminating control reads **`End call` on both surfaces**, with a deliberate per-surface fill:

| | Label | Fill | Why |
|---|---|---|---|
| Video | `End call` | navy `bg-primary` | spec §5.2 / D11 |
| Audio | `End call` | blaze `bg-attention` | punch-list B1 — preserved |

**This difference is deliberate and must become an explicit `<CallShell>` prop**, not accidental drift. That is precisely what §4 exists to enforce.

⚠ **Do NOT delete the rationale comment at `audio-call-overlay.tsx:312-314`.** Update its wording for the new label, keep its substance:

```
/* End call is blaze (not navy): red=911 was reading as the "end call" cue.
   Intentional override of "blaze = needs-attention, never a CTA" for this
   one control (punch-list B1, Kumar 2026-06-18; relabelled 2026-07-19).
   911 stays red, top-right. */
```

Label casing is **`End call`** (sentence case), matching spec D11 and video. Kumar typed "End Call" casually; sentence case is the house convention and keeps both surfaces identical.

---

## 1. Resolved placeholder names

The plan tells the implementer to "substitute the real name" in eight places. **Six of those helpers do not exist in any form.** Resolved:

| Plan placeholder | Reality |
|---|---|
| `renderRingingCard({ onAnswer })` (Task 4) | **Does not exist.** No helper in `property-card.test.tsx`, and `PropertyCard` has **no `onAnswer` prop**. Props are only `property`, `canAnswer`, `connectSlot`, `footerSlot`. Tests inline `render(<CallSurfaceProvider><Publisher /><PropertyCard property={p1}/></CallSurfaceProvider>)`, register a module-level spy (`acceptVideoSpy`/`acceptAudioSpy`) via a `Publisher` probe, and ring the card by clicking `'publish video ring for p1'`. **Follow that idiom.** |
| `renderSoftphone({ role: "AGENT" })` (Task 9) | Real signature is **positional**: `renderSoftphone(role: "AGENT" \| "ADMIN" = "AGENT")` — `softphone.test.tsx:235`. The object form is a typecheck failure. |
| `dutyMock` / `Object.assign(dutyMock, …)` (Task 9) | **Does not exist.** See §2 — this one is hazardous. |
| `renderVideoCall({ tileClosedByUser, openTileForCall })` (Task 13) | **Does not exist**, and neither is a prop. `video-call.tsx:118-119` reads them off context: `surface?.tileClosedByUser ?? false` and `surface?.openTileForCall`. All 13 tests render `<VideoCall …/>` inline. Drive via a real `<CallSurfaceProvider>` + a probe, following the existing `EnableCaptions` probe at `video-call.test.tsx:70-73`. **Note:** the AUDIO overlay *does* take props — `showReopenTile` / `onReopenTile` (`audio-call-overlay.tsx:56-57,82-83`). The plan conflated the two surfaces. |
| `createSession(...)` (Task 15) | Real export is **`joinLiveKitCall(opts)`** — a single object arg (`lib/video/livekit-session.ts:68`). |
| `roomHandlers.get("disconnected")` (Task 15) | **Does not exist.** The handler map is a private `handlers` const inside the `vi.hoisted` block; the only exposed firing mechanism is **`lk.emit(ev, ...args)`**. |
| `DutyState` type import | **Not exported** — it is a local alias at `duty-provider.tsx:28`. Only the hooks are exported. Do not `import type { DutyState }`. |
| `CallSurfaceValue` type | **Not exported.** Do not annotate with it. |

---

## 2. ⚠ Task 9 — do NOT mock the duty provider in `softphone.test.tsx`

The plan says to "reuse the existing render helper and duty mock." **There is no duty mock.** `softphone.test.tsx` deliberately imports the **real** `DutyProvider` and `useDuty` (line 177) and renders the real provider (line 237). `grep 'vi.mock("@/components/dashboard/duty-provider'` returns nothing.

**The hazard:** an implementer told there is a duty mock will *add* one. That would stub out the real provider the two accept-gate tests at `:878-909` rely on to prove `softphone.tsx:587` (`if (!canWorkRef.current) return;`) blocks an off-duty answer. That is the **authoritative client-side gate for AUDIO answering** — the exact thing spec §3.4 and §11 say must stay load-bearing when the guard replaces `disabled`. Mocking it makes those tests vacuous **while still green**.

**Rule: never add `vi.mock` of `duty-provider` to `softphone.test.tsx`.**

Drive duty through the file's real levers instead:
- Set `hydration = { onDuty: false, accepting: true }` **before** `renderSoftphone("AGENT")`. `hydration` is the mutable object served by the `GET /api/presence` fetch mock, declared at `:687` and **only in scope inside `describe("Softphone — D13 duty hydration + gated beats")` (lines 685-846)** — new tests must live in that block.
- Assert go-on-duty via `fetchMock.mock.calls.some((args) => args[0] === "/api/presence/go-on-duty")`, copying `:765-776`. Do **not** inject a `goOnDuty` spy.
- Use **`userEvent`** — `fireEvent` is not imported (RTL import at `:23` is `{ render, screen, act, waitFor, cleanup }`).
- **Every test must be async.** Nothing in the idle block renders synchronously: the softphone mounts in phase `"connecting"` and settles only after a token fetch + `await import("@twilio/voice-sdk")` + `device.register()`, and `DutyProvider` hydrates asynchronously. Open with the existing ready-wait, then `await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"))`.

**Also (Task 9 Step 3):** the proposed button className drops `relative`. The ring's two children are **both absolutely positioned** (`softphone.tsx:819-827`) and need the wrapper as their positioning context. Use `relative mx-auto mt-1 h-16 w-16` — `grid place-items-center` is redundant when the children are absolute.

---

## 3. ⚠ Three safety rules the plan would silently delete

### 3a. `pushBlocked` gets orphaned (Task 8 / Task 10)

`duty-control.tsx` is the **only consumer of `pushBlocked` in the repo** (verified by grep: produced at `duty-provider.tsx:55,76,209`; consumed only at `duty-control.tsx:111,128`). It renders `NotificationsBlockedHint` (`:94-108`) — a `BellOff` chip labelled *"Notifications blocked — rings still work in this tab"*.

Task 10 deletes that file. The plan's `ShiftCard` destructures only `{ onDuty, onBreak, shiftStartedAt, endShift, takeBreak, resume }`. **After Task 10 `pushBlocked` is computed and rendered nowhere.** On a product whose alerting contract is "she can always hear it ring", a silently denied Web Push means the agent believes she is covered while OS-level alerting is off.

**Required:** add `pushBlocked` to `ShiftCard`'s `useDuty()` destructure and render the hint in **all three states** — a blocked push matters most *off duty*, right before a shift starts. Port the coverage from `duty-control.test.tsx:199-207`.

### 3b. The unmatched-ring fallback loses its gate (Task 4)

The plan says delete `answerGated` and "`pod-card-grid.tsx:42` has a duplicate — delete that too." But `UnmatchedRingCards` has **five** references (`pod-card-grid.tsx:55,63,64,65,67`) forming a complete second copy of the gated Answer treatment, and the plan never says to rewrite that JSX.

Two outcomes, both bad: delete the constant only → five undefined identifiers → build fails; or strip the references to compile → **the fallback's Answer becomes entirely ungated**, with no interception and no prompt. That fallback exists precisely for *"a ring must never be audible but unanswerable"* — it is a live answer path.

**Required:** rewrite `UnmatchedRingCards`' Answer explicitly —

```tsx
const { guard } = useDutyGuard();   // inside UnmatchedRingCards
…
<Button
  size="sm"
  className="h-8 whitespace-nowrap animate-pulse"
  onClick={() => guard(() =>
    ring.channel === "AUDIO"
      ? actions.acceptAudio?.()
      : ring.callId && actions.acceptVideo?.(ring.callId))}
>
  Answer
</Button>
```

Label always `Answer`, never `disabled`.

**Also delete the now-unused `const duty = useDutyOptional()` and its import from BOTH files** (`property-card.tsx:11,51` and `pod-card-grid.tsx:9,33`) — each is used *only* by its `answerGated` line, and leaving them fails `pnpm lint`, which is part of the task's own gate.

**Add `tests/components/pod-card-grid.test.tsx` to Task 4's file list and `git add`.** Its test at `:178-205` does `getByRole("button", { name: "Go on duty" })` and asserts `.disabled === true` against this fallback. **Repoint it at the guard — do not delete it.**

*Context worth keeping:* `answerGated` is deliberately **VIDEO-only** (`property-card.tsx:54-58`) because there is a server 403 backing `answer-video` and none backing audio-answer. After this change both channels route through the guard, which is spec §3.6's intent; the server-side 403 remains the real gate for video.

### 3c. `duty-control.test.tsx` is never deleted (Task 10)

Task 10 runs `git rm` on the component only. `tests/components/duty-control.test.tsx:25` imports it → module resolution failure → **the entire jsdom project fails**, so the gate cannot pass.

**Required:** `git rm` both files, and **port its coverage first**: the mid-call End-shift disable + title into `shift-card.test.tsx` (as a native `disabled`, **not** Radix `aria-disabled` — see §4), and the `pushBlocked` hint tests per §3a.

---

## 4. Task 8 — the mid-call rule is reproducible (good news)

The plan hedges: *"If `useDuty()` does not expose an on-call flag, source it the same way `duty-control.tsx` did."* It does not, but the state **is** available:

```ts
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
const onCall = useCallSurfaceOptional()?.active != null;   // duty-control.tsx:116
```

`useCallSurfaceOptional` (not the throwing variant) so `ShiftCard` still renders outside a `CallSurfaceProvider`.

Both halves of the rule, verified:
- **End shift** — `disabled={endShiftDisabled}` + `title={endShiftDisabled ? "Finish the call first" : undefined}` (`duty-control.tsx:83-84`), passed as `endShiftDisabled={onCall}` on **both** the on-duty and on-break branches (`:146-147`, `:175`) — deliberate symmetry.
- **Take a break** — wrapped in `{!onCall && ( … )}` (`:167-174`), i.e. **removed from the tree** mid-call, not disabled.

Reproduce both. Note the old control was a Radix `DropdownMenuItem` (asserted via `aria-disabled`); the new one is a real `<Button>`, so assert the **native `disabled` attribute**.

---

## 5. Task 4 / 5 — corrected line references and the `connectSlot` trap

**The plan's `property-card.tsx:129-137` straddles two different buttons.** Verified real structure:

```
122   <div className="mt-3 flex items-center gap-2">     ← the action row wrapper
123-132   Answer button          (line 129 is its closing `>`, 130 the label, 131 </Button>)
133-143   Silence button
144       {connectSlot}                                  ← ALREADY INSIDE this wrapper
145   </div>
146   {footerSlot && …}
```

- Cite **123-132** for the Answer replacement, not 129-137.
- `answerGated` is at **`property-card.tsx:58`** (correct in the plan); `duty` at `:51`.

**⚠ The `connectSlot` trap (Task 5).** The plan presents Answer/Silence as the sole contents of that wrapper and introduces a *new* `<div className="mt-2 …">{connectSlot}</div>` row — but never says to **lift `connectSlot` out of the existing row**. An implementer editing only the two button blocks leaves `connectSlot` inside the new always-`h-8` reserved wrapper, where the fixed height **crops the Connect/Kiosk buttons and their error `<p role="alert">`**.

**Required order:** move `{connectSlot}` out into its own `mt-2` row **first**, then apply the `h-8` reservation to the ringing row.

**Note on `h-8` + reservation:** the plan's Task 5 snippet uses `className="mt-auto flex h-8 items-center gap-2"` with conditional children, while spec §3.6b argues for rendering the row and hiding it with `visibility: hidden` (which keeps the layout box but removes the buttons from tab order and the a11y tree). The plan's always-rendered-empty-wrapper achieves the same reservation more simply and needs no `aria-hidden`/`tabIndex` juggling. **Follow the plan's snippet**; spec §3.6b's `visibility: hidden` paragraph is describing an alternative it then argues against.

---

## 6. Task 11 — `<CallShell>` cannot be a pure move as specified

### 6a. The `split` prop semantics are inverted

The plan documents `split` as **"Left-panel width. Audio 70/30, video 60/40."** That is backwards. Verified:

| Surface | Left panel | Right panel |
|---|---|---|
| Video | guest stage `basis-2/5` = **40%** (`video-call.tsx:496`) | `basis-3/5` = **60%** (`:548`) |
| Audio | call card `basis-[37%]` (`audio-call-overlay.tsx:204`) | playbook `basis-[63%]` (`:239`) |

Under "left-panel width", `split="70/30"` for audio would give the **call card** 70% — the exact opposite of Task 12 Step 5's own rationale (*"its call card genuinely needs less room"*) and of the Task 17 smoke check (*"Playbook has visibly more room than on video"*).

**Required:** name the prop unambiguously — e.g. `playbookBasis: "60%" | "63%" | "70%"` — or document it as *right-panel/playbook width*. Targets: video playbook 60% (unchanged), audio playbook 63% today → **70%** in Task 12.

### 6b. One `banners` slot cannot express two positions

Banners occupy **two structurally distinct** slots today:

| Position | Audio | Video |
|---|---|---|
| **Above** the body | emergency-active + emergency-failed (`:186-197`) | `audioBlocked` (`:463-477`), `mediaWarning` (`:479-487`) |
| **Between** body and control bar | `CaptionBand` (`:245-249`) | `saveFailed` Retry/Discard (`:585-607`) |

Collapsing them into one slot silently relocates either the **911-active/failed banners** (which carry the operational instruction to relay the property address) or the **notes-retry affordance**, or both.

**Required:** two slots — `bannersAboveBody` and `bannersBelowBody`.

### 6c. The `playbook` slot is asymmetric

Audio passes its basis **into** `<PlaybookPanel basis=…/>`; video wraps a Playbook/Chat **tab panel** in a `basis-3/5` div and **replaces it wholesale when collapsed**. One slot cannot own the basis for both.

**Required:** each overlay passes its **fully rendered right-hand panel**, not a bare playbook.

### 6d. The DOM tolerance is tighter than "no visual change"

Two existing assertions pin exact structure:
- `audio-call-overlay.test.tsx:148-157` resolves the caption band via `getByText(...).closest("div")` and asserts **that element's** className contains `hidden`. **Any extra wrapper div around `CaptionBand` breaks it** with no behaviour change.
- `:134-145` requires `data-testid="audio-call-card"` and the `cn(..., collapsed && "hidden")` to stay on the **same element**.

### 6e. Three untracked test files render the real components

Named nowhere in the plan or the spec. Add all three to Task 11's verification and to Tasks 13/4/5 as applicable:

- `tests/components/video-call-chat.test.tsx:30` — imports the real `VideoCall`.
- `tests/components/video-call-outbound.test.tsx:34,190` — imports the real `VideoCall`; queries `getByRole("button", {name:/cancel/i})`. **That outbound Cancel lives inside the guest stage `<CallShell>` relocates** — a pure move must keep it in whatever slot the stage becomes.
- `tests/components/call-tile-manager.test.tsx:9-10` — imports the real `PropertyCard` **and** `VideoCallHost`, driving eight `getByRole("button",{name:"Answer"})` flows through Task 4/5's restructured card. It mounts **no `DutyProvider` and no `OffDutyPromptProvider`**, so `useDutyOptional()` → `null` → `gated=false` → `guard` must pass straight through and `ctx?.prompt()` must be a safe no-op. **If `useDutyGuard` is ever changed to require its provider, these eight tests break.**

---

## 7. Task 12 — scope per surface

Per §0. Corrected scope:

| Step | Video | Audio |
|---|---|---|
| §5.1 remove Hold + Swap | **Yes** (`video-call.tsx:667-681`) | N/A — neither exists |
| §5.2 normalize the terminating control | `End` → **`End call`**, navy, off its `text-[1.1875rem]` hack | `Hang up` → **`End call`**, **stays blaze**, onto h-8 |
| §5.3 no reflow | Mute + Camera fixed-width | Mute fixed-width (`:310`) — no camera control exists |
| §5.4 grouping + divider | **Yes** | Divider between Connect and End call |
| Convert hand-rolled `<button>` → `<Button>` h-8 | Yes | **Yes** (Kumar, option 2) |

⚠ 911 stays **red, top-right, untouched** on audio. Smoke must confirm 911 and `End call` remain visually unmistakable.

---

## 8. Task 13 — reopen control

- No `renderVideoCall` helper; `tileClosedByUser`/`openTileForCall` are **context, not props** (§1). Audio's `showReopenTile`/`onReopenTile` **are** props.
- **`video-call.tsx` does not import `cn`** (import block `:1-26`; the file uses template-literal conditionals throughout, e.g. `:496,553,560`). The plan's Task 13 Step 4 snippet calls `cn(...)` → compile error. Either add `import { cn } from "@/lib/utils";` or write a template string.
- `CaptionBand` placement at `:508` and its `className` support must be confirmed before passing one.

---

## 9. Task 14 — one snippet cannot serve three surfaces

The three in-call Connects obtain their property **three different ways**:

| Surface | How it resolves the property | Current disabled reason |
|---|---|---|
| Video (`video-call.tsx:683-692`) | `propertyId` + `surface` from context | `!propertyId \|\| !surface` |
| Tile (`call-tile.tsx:324-333`) | `active.propertyId` off the surface | `propertyId == null` |
| **Audio** (`audio-call-overlay.tsx:296-303`) | **neither** — takes an `onConnect?: () => void` **prop**; the parent softphone resolves it (`softphone.tsx:769-771,880-884`) | `!onConnect` |

Applying the plan's single snippet to audio requires net-new props and breaks `audio-call-overlay.test.tsx:113-116` (which asserts Connect is disabled when `onConnect` is absent).

**`connectError` does not exist anywhere.** All three call `connectToProperty` as a bare `void` with no catch. Surfacing the error (spec §7's "behavioural gap to close") is therefore **net-new state in three files plus a new prop on `AudioCallOverlay`**. `connectToProperty` returns **`{ launched, notConfigured }`** — the new state must await it and map the result, exactly as `ConnectButton` already does.

**Tile specifics:**
- `call-tile.test.tsx:440-449` asserts `connectBtn.className` contains **`bg-accent`**. `PropertyActionButton`'s default `tone="navy"` → `variant="neutral"` → `bg-primary` would **silently revert the deliberate 2026-07-10 batch-1 polish this test was written to pin.** All three in-call Connects must pass **`tone="teal"`**.
- `call-tile.test.tsx:388-397,400-416` do `getByText("Connect").closest("button")` and assert `.disabled`. Those only survive if **`unavailableReason` keeps setting the native `disabled` attribute** — only the *duty* gate becomes an intercept.
- The tile Connect is deliberately **smaller** (`text-xs px-2 py-1`, `Monitor size={13}`) for the PiP window, vs `PropertyActionButton`'s `size="sm"` h-8. **Keep the tile's scale via `className`** — do not accept a larger button in a tiny window.
- Add `tests/components/call-tile.test.tsx` to Task 14's file list and `git add`.

---

## 10. Task 15 — six defects

1. `createSession(...)` → **`joinLiveKitCall({ url, token, ...callbacks })`** (`livekit-session.ts:68`).
2. `roomHandlers.get("disconnected")` → **`lk.emit("disconnected", …)`**.
3. The existing `lk.RoomEvent` mock defines only `TrackSubscribed` / `ParticipantDisconnected` / `AudioPlaybackStatusChanged`. **Add `Disconnected: "disconnected"`** — otherwise `RoomEvent.Disconnected` is `undefined` and the handler registers under key `undefined`, failing the new test for an unrelated reason.
4. **Add a `DisconnectReason` object to the mock AND return it from the `vi.mock` factory** (it currently returns six exports).
5. `DisconnectReason` must be added to the **dynamic destructure at `livekit-session.ts:71`** (`const { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } = await import("livekit-client")`). The only static import is **type-only** (`:3`), so `DisconnectReason[reason]` at runtime is otherwise a `ReferenceError`.
6. **`livekit-session.ts` has no Sentry import at all** — add `import * as Sentry from "@sentry/nextjs";`.

**Plus a hoisting bug in the plan's test snippet.** `const captureMessage = vi.fn();` referenced inside `vi.mock("@sentry/nextjs", () => ({ captureMessage }))` throws a TDZ error — `vi.mock` factories hoist above top-level consts. Every one of the five existing Sentry mocks in the suite uses `vi.hoisted`, and this very file already builds its livekit mock that way:

```ts
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
```

Note `leave` is an **arrow property** on the returned session object (`:123-133`), so set the `leaving` flag inside it.

---

## 11. ⚠ Task 16 / 17 — the 911 verification checks the wrong artifact

Task 16 Step 3 says to grep the audio-overlay diff and *"confirm the two-tap arm/confirm logic and the emergency-control calls are byte-identical."* Task 17 Step 4 makes *"911 arms on the first tap and fires on the second"* on an AUDIO call **"the single most important check in this list."**

**Neither exists in `audio-call-overlay.tsx`.**

| Artifact | Where it actually lives | Touched by this plan? |
|---|---|---|
| Two-tap arm/confirm (`EMERGENCY_ARM_WINDOW_MS`, `armed`, `armTimerRef`, `handle911Tap`) | `call-tile.tsx:16,96-115,172-202` | **No** |
| `emergency/control` POSTs | `softphone.tsx:634-646,682-700` | **No** |
| Audio's actual 911 | `audio-call-overlay.tsx:151-197` — a Radix **`AlertDialog`**, no arm state | **Yes — this is what moves** |

A reviewer following the plan greps, finds no two-tap, concludes "clean" — and **the dialog that actually moved gets no line-by-line review**. The smoke then exercises the untouched tile and declares 911 verified.

The overlay dialog is a **live path even while the tile is up**: `collapsed` hides only the call card (`:203-206`) and the caption band (`:248`); the header carrying the 911 trigger stays rendered. When DocPiP is unsupported or the agent closed the tile, **the overlay dialog is the only 911**.

**Corrected Task 16 Step 3:** diff `audio-call-overlay.tsx:150-197` and confirm byte-identical: the `AlertDialog` trigger (including `disabled={emergencyActive}` and the `911 active` label swap), the confirm copy, the `FORWARD-COMPAT SEAM` comment, `AlertDialogAction onClick={onTriggerEmergency}`, and **both** emergency banners. Also confirm `softphone.tsx` and `call-tile.tsx` are untouched.

**Corrected Task 17 Step 4:** on an AUDIO call **with the tile closed**, open the header 911 dialog, read the confirm copy, press **Cancel**, and confirm **no POST fires**. Then separately verify the tile's two-tap still arms and fires (regression on the untouched surface). Fire a real **933** test only per the existing procedure.

---

## 12. Task 1 / app-shell — one invariant to respect

`app-shell.tsx:41-45` carries a written invariant: **do not insert a `React.memo` or `Suspense` boundary between `DutyProvider` and the softphone** — the "no stray beat after End shift" gate depends on the softphone re-rendering synchronously with the provider's `onDuty` flip.

`OffDutyPromptProvider` is a plain context provider and does not violate this, **but it must not be memoized or suspended.**

Nesting is `LineStatusProvider > CallSurfaceProvider > DutyProvider > SidebarProvider > …`. The plan's instruction is viable exactly as written: insert between `:46` (`<DutyProvider>`) and `:48` (`<SidebarProvider>`), closing before `:68`.

---

## 13. Verified-good (no correction needed)

- `Button` variants: `neutral` = navy `bg-primary`, **`accent` = teal** — both exist (`button.tsx:15,26`). Sizes `default: h-9`, `sm: h-8` as the plan assumes.
- `DutyState` field names — all 16 exist and are spelled correctly; only declaration order differs.
- `useDuty()` throws `"useDuty must be used within DutyProvider"`; `useDutyOptional()` returns null. Both pinned by `duty-provider.test.tsx:241-256`.
- `canWork = onDuty && !onBreak` (`duty-provider.tsx:189`).
- `dashboard-workspace.tsx` — `DutyControl` at `:83`, aside at `:90-97`, grid `lg:grid-cols-[minmax(0,1fr)_340px]` at `:88`, range `79-101`. All as the plan states. Leave `{role === "AGENT" ? <CallBackShortcut /> : null}` at `:99` in place.
- Off-home hiding is a `hidden` **class**, not unmounting — the softphone's Twilio Device must never deregister.
- Only one production import of `duty-control.tsx` (`dashboard-workspace.tsx:9`) and one test import. `DutyMenu` is module-private with two in-file call sites, so it retires cleanly.
- Stale **comments** referencing `DutyControl` will remain at `softphone.tsx:133,761,810`, `app-shell.tsx:37`, `softphone.test.tsx:209,562-563,601`, `pod-card-grid.test.tsx:9`, `property-card.test.tsx:9`. Update them as encountered.
