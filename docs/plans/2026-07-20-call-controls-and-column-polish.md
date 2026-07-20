# Call-control consistency + dashboard-column polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three in-call control bars read as one system, unify the terminating control, fix the dashboard right-column rhythm, and clear three small inconsistencies — all UI-only.

**Architecture:** Pure presentational edits to existing components. Reorder/restyle the control bars (Connect left / End call right bookends), flip one fill token, move the audio reopen control to a corner, add a min-height and a stretch to the dashboard aside, make one status pill duty-aware, swallow one async rejection, and nudge one kiosk padding value. No call/duty/911/routing logic is touched.

**Tech Stack:** Next.js (portal) + Vite (kiosk), React, Tailwind + CSS custom properties, Vitest (jsdom for components, node for lib), lucide-react icons.

**Spec:** [`docs/specs/2026-07-20-call-controls-and-column-polish-design.md`](../specs/2026-07-20-call-controls-and-column-polish-design.md)

---

## Cross-cutting constraints (read before ANY task)

These come from the 2026-07-19 batch's CORRECTIONS doc + handoff and are still live. Violating one produces a green-passing but wrong result:

1. **NEVER add `vi.mock("@/components/dashboard/duty-provider")` to `softphone.test.tsx`.** It renders the real provider on purpose; mocking it makes the `softphone.tsx:587` accept-gate tests vacuous while green. Drive duty through the file's real levers (the `hydration` object + `GET /api/presence` fetch mock, only in scope inside the `describe("Softphone — D13 duty hydration + gated beats")` block). See CORRECTIONS §2.
2. **`PropertyCard` is slot-based**; the admin `FleetBoard` renders the same `PodCardGrid`, so a card change hits admin too. Buttons arrive via `connectSlot`/`footerSlot`.
3. **Do not touch `lib/remote-access/connect.ts` or any 911 machinery.** No task here needs them. Never navigate the top window during a live call.
4. **Zero migrations** — do NOT run `gen:types`. The `supabase/` and `apps/kiosk/` (except Task 10) diffs stay empty of schema changes.
5. **Root `eslint .` lints `tests/`** (per-package lint does not). A leftover worktree inside `.claude/worktrees/` breaks root eslint — don't create one there. `check:routes` does a naive `line.includes("as never")` scan — don't write that string in a comment.
6. **Match each test file's existing render/mock idiom — verify by reading it before writing a test.** The representative assertions below show INTENT and the real idiom to slot into; they are not drop-in unless they cite an exact existing helper. This is the single lesson that produced the last CORRECTIONS doc.
7. **Visual outcomes are smoke-only.** jsdom has no layout engine: exact height parity, corner rounding, the Video/Chat teal fill, the column alignment, and the kiosk pill spacing are verified by LOOKING on real hardware, never by a jsdom assertion (`[[kiosk-css-animation-reverted]]`). jsdom tests assert structure/label/order/class-presence; the rest is the final smoke.
8. **21 untracked `"… 2.tsx"` duplicate files** exist under `apps/portal` (byte-identical sync artifacts). Ignore them; do not edit them. Optionally `git clean` them at the end (Task 11).

## Running tests

```bash
# portal component tests (jsdom project)
pnpm -F @lc/portal test -- run <path-or-name>
# portal lib tests (node project)
pnpm -F @lc/portal test -- run <path>
# whole gate before the final commit
pnpm -F @lc/portal test -- run && pnpm -F @lc/kiosk test -- run && pnpm typecheck && pnpm lint && pnpm check:routes && pnpm -F @lc/portal build
```
Baseline before any change (independently verified at `dfc8700`): **node 879 / jsdom 420 green.**

## File map

| File | Task | Responsibility of the change |
|---|---|---|
| `components/call/caption-toggle.tsx` | 1 | Compact branch: match the tile's compact button scale |
| `components/call/call-controls.tsx` | 2 | `EndCallButton` blaze on both; docblock reconcile |
| `components/softphone/audio-call-overlay.tsx` | 3 | Reorder bar (Connect first); reopen → call-card corner |
| `components/video-call/video-call.tsx` | 4 | Reorder bar (Connect first); End call `tone="blaze"` |
| `components/call-tile/call-tile.tsx` | 5 | Reorder + relabel + normalize bar; Video/Chat fill |
| `components/dashboard/property-card.tsx` | 6 | `Answer` gains a `Phone` icon |
| `components/dashboard-workspace.tsx` + `components/dashboard/shift-card.tsx` | 7 | Aside stretch + clocks bottom; shift-card min-height |
| `components/softphone/softphone.tsx` | 8 | `LinePill` duty-aware |
| `lib/captions/provider.ts` | 9 | Swallow async `stopRecognition` rejection |
| `apps/kiosk/src/screens/CallControls.tsx` | 10 | Even the pill corner spacing |

Tasks 1→6 are the in-call surfaces (do in order: shared components 1–2 before their consumers 3–5). 7–10 are independent and may be done in any order.

---

### Task 1: Normalize the compact caption toggle

**Why:** on the call tile the caption button is visibly taller than its neighbours — `CaptionToggle compact` uses `px-2 py-2 text-sm` with a 16px icon, while the tile's other bar buttons are `px-2 py-1 text-xs` with 13px icons (spec §3.2, D4).

**Files:**
- Modify: `apps/portal/components/call/caption-toggle.tsx`
- Test: `apps/portal/tests/components/caption-toggle.test.tsx`

- [ ] **Step 1: Write the failing test.** Read the existing file first to match its render idiom. Assert the compact toggle no longer carries the oversized padding:

```tsx
it("compact renders at the tile's compact scale (py-1, not py-2)", () => {
  render(<CaptionToggle enabled={false} onToggle={() => {}} compact />);
  const btn = screen.getByRole("button", { name: "Captions" });
  expect(btn.className).toContain("py-1");
  expect(btn.className).not.toContain("py-2");
});
```

- [ ] **Step 2: Run it — expect FAIL** (current class is `px-2 py-2`).

- [ ] **Step 3: Implement.** In `caption-toggle.tsx`, change the compact padding and icon size. The colour/contrast branches are UNCHANGED (they are measured against the navy tile surface — see the file's docblock; do not touch them).

```tsx
// was: compact ? "px-2 py-2" : "px-3 py-2",
compact ? "px-2 py-1 text-xs" : "px-3 py-2",
// and the icon: compact gets size 13, labelled stays 16
{enabled ? <Captions size={compact ? 13 : 16} /> : <CaptionsOff size={compact ? 13 : 16} />}
```
Keep `text-sm` on the labelled branch (the `text-xs` above only applies in compact via the added token; verify the merged class list gives compact `text-xs` and labelled `text-sm`).

- [ ] **Step 4: Run the caption-toggle test file — expect PASS**, and confirm no existing assertion in that file broke.

- [ ] **Step 5: Commit.** `git add` the two files; `git commit -m "fix(call): normalize compact caption toggle to the tile bar scale"`

---

### Task 2: `End call` — blaze on both surfaces

**Why:** spec §3.3 / D2. Video's `EndCallButton` is navy; unify to blaze. The audio overlay + tile already use blaze, so this is the video flip plus the shared docblock reconcile.

**Files:**
- Modify: `apps/portal/components/call/call-controls.tsx` (docblock only — the component already supports `tone`)
- Modify: `apps/portal/components/video-call/video-call.tsx:802` (`<EndCallButton tone="navy" …>` → `tone="blaze"`)
- Test: `apps/portal/tests/components/video-call.test.tsx` (verify the render idiom first — it uses a real `CallSurfaceProvider` + a probe, per CORRECTIONS §1)

- [ ] **Step 1: Write the failing test.** Assert the video overlay's End call carries the blaze fill:

```tsx
it("End call is blaze on video (unified with audio, spec D2)", async () => {
  // render VideoCall through the existing CallSurfaceProvider + probe idiom in this file
  const end = await screen.findByRole("button", { name: /end call/i });
  expect(end.className).toContain("bg-attention");
});
```

- [ ] **Step 2: Run it — expect FAIL** (currently navy `bg-primary`, no `bg-attention`).

- [ ] **Step 3: Implement.**
  - `video-call.tsx`: change the one prop `tone="navy"` → `tone="blaze"` at the `<EndCallButton>` (the reorder in Task 4 will move this line; doing the tone flip here keeps the test focused — or fold this into Task 4 if executing them together).
  - `call-controls.tsx` `EndCallButton` docblock: replace the "navy on video, blaze on audio … Do NOT unify it to navy" paragraph with: blaze on both (2026-07-20, spec D2); the audio-only 911-disambiguation reason no longer forces a per-surface difference; `tone` stays a prop so the fill is still a recorded decision, not drift.

- [ ] **Step 4: Run the video-call test file — expect PASS.**

- [ ] **Step 5: Commit.** `git commit -m "fix(call): End call is blaze on video too (spec D2)"`

---

### Task 3: Audio overlay — reorder bar, reopen to the call-card corner

**Why:** spec §3.1 (order `Connect · Mute · Captions · End call`) + §3.4 (reopen becomes a round mint corner icon on the call-card, off the bar).

**Files:**
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx`
- Test: `apps/portal/tests/components/audio-call-overlay.test.tsx` (real render; pins `data-testid="audio-call-card"` and the caption-band `hidden` test — don't break those; CORRECTIONS §6d)

**The change, precisely:**
- In the `controls={ … }` block (currently ~`:292-442`): the order is `[inputs] · CallControlTray(Mute, Captions) · Divider · {reopen} · Connect · EndCallButton`. New order: `[inputs] · Connect · Mute · Captions · Divider · EndCallButton`. Remove `showReopenTile` from here. Remove the `ml-auto` push from the tray (see spec §3.1 note) — the input group's `flex-1` right-packs the cluster; default to sequencing the toggles flat without the tray container, keeping their existing fixed widths.
- Move the reopen control OUT to the `stage` (the call-card panel rendered by `CallShell`'s `stage` prop, ~`:255-267`): render, only when `showReopenTile`, a round mint-outlined icon button in the bottom-right corner of that panel. Reuse video's treatment (read `video-call.tsx`'s reopen button for the exact classes — `~38px`, `rounded-full`, mint outline, scrim, `PictureInPicture2`, `aria-label="Reopen tile"`, `title`). The panel already has content; add `relative` to it if needed and position the button `absolute bottom-2 right-2`.
- Update the long reopen-control comment (currently "audio has no stage, so the control bar is the only sane placement"): rewrite to the call-card-corner placement (spec §3.4 / reconciliation §9).

- [ ] **Step 1: Write the failing tests.**

```tsx
it("audio bar order is Connect, Mute, Captions, End call", () => {
  // render the overlay via the file's existing idiom, in-call, showReopenTile=false
  const names = screen.getAllByRole("button").map((b) => b.textContent);
  const connect = names.findIndex((n) => /connect/i.test(n ?? ""));
  const mute = names.findIndex((n) => /mute/i.test(n ?? ""));
  const end = names.findIndex((n) => /end call/i.test(n ?? ""));
  expect(connect).toBeLessThan(mute);
  expect(mute).toBeLessThan(end);
});

it("reopen control is a corner icon on the call card, not in the control bar", () => {
  // render with showReopenTile=true
  const reopen = screen.getByRole("button", { name: "Reopen tile" });
  // it is NOT inside the control-bar container; assert it is not a sibling of End call.
  // (match the file's actual container query; assert reopen exists + is icon-only.)
  expect(reopen).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the reorder + relocation above.
- [ ] **Step 4: Run the audio-call-overlay test file — expect PASS**, including the pre-existing caption-band `hidden` and `audio-call-card` tests.
- [ ] **Step 5: Commit.** `git commit -m "fix(call): audio bar order + reopen to call-card corner (spec §3.1/§3.4)"`

---

### Task 4: Video overlay — reorder bar (+ End call blaze, if not already in Task 2)

**Why:** spec §3.1 (order `Connect · Mute · Camera · Captions · End call`).

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx` (`controls={ … }` ~`:694-803`)
- Test: `apps/portal/tests/components/video-call.test.tsx`

**The change:** current order is `[inputs] · CallControlTray(Mute, Camera, Captions) · Divider · Connect · EndCallButton`. New: `[inputs] · Connect · Mute · Camera · Captions · Divider · EndCallButton`. Remove the tray `ml-auto` (spec §3.1); default flat sequence, keep the toggles' fixed widths. There is NO Video/Chat toggle on the video *overlay* (chat is a panel tab) — do not add one.

- [ ] **Step 1: Write the failing test** (DOM order `Connect < Mute < Camera < Captions < End call`, same pattern as Task 3).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the reorder (and confirm `tone="blaze"` from Task 2 is on the `EndCallButton`).
- [ ] **Step 4: Run the video-call test file(s) — expect PASS** (`video-call.test.tsx`, `video-call-chat.test.tsx`, `video-call-outbound.test.tsx` — the outbound Cancel lives in the guest stage, not the bar; confirm it still resolves).
- [ ] **Step 5: Commit.** `git commit -m "fix(call): video bar order — Connect leads, End call bookends (spec §3.1)"`

---

### Task 5: Call tile — reorder, relabel, normalize, Video/Chat fill

**Why:** spec §3.1/§3.2/§3.3/§3.5 + D4/D5. The tile is the most-flagged surface (images 2 & 5): "Hang up" → "End call"; End call far right; caption oversized; rounding inconsistent; Video/Chat teal doesn't fill.

**Files:**
- Modify: `apps/portal/components/call-tile/call-tile.tsx` (the `controls && ( … )` bar, ~`:298-403`)
- Test: `apps/portal/tests/components/call-tile.test.tsx` (pins Connect `bg-accent` + disabled-by-`unavailableReason`; CORRECTIONS §9 — keep those green)

**The changes:**
1. **Reorder** to `Connect · Mute · [Video/Chat] · Captions · End call`. Today the order is `Mute · End(Hang up) · [Video/Chat] · Captions · Connect(ml-auto)`. Move the `PropertyActionButton` Connect to FIRST and drop its `wrapperClassName="ml-auto"`; move the End button LAST and give IT `ml-auto` (via a wrapping `<div className="ml-auto">` or the button's own class) so it's the right bookend with a gap.
2. **Relabel** the End button `Hang up` → `End call`; keep `bg-attention` (blaze) + `PhoneOff`. Add `whitespace-nowrap shrink-0` so it can't wrap in the 380px window (this is the img-5 "expanding" fix).
3. **Normalize** every bar control to one compact scale: `text-xs`, `py-1`, 13px icons, `rounded-button`, `whitespace-nowrap shrink-0`. Mute + End are hand-rolled `<button>` — align them. Caption compact is handled by Task 1. Connect is `size="xs"` (h-6) — leave it (it's the tile scale).
4. **Video/Chat fill (§3.5):** the segmented container is `p-0.5 … rounded-button` with `rounded-[3px] px-1.5 py-0.5` segments, so the teal active segment doesn't reach the container edge. Make the active segment fill its half flush — remove the inner gap (`p-0` on the container or match the segment radius/padding to the container so no border shows around the teal). Keep both segments equal width.

- [ ] **Step 1: Write the failing tests.**

```tsx
it("tile bar order is Connect, Mute, [Video/Chat], Captions, End call", () => {
  // render a VIDEO call tile via the file's CallSurfaceProvider + publisher idiom
  const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  expect(names.findIndex((n) => /connect/i.test(n))).toBeLessThan(names.findIndex((n) => /mute/i.test(n)));
  expect(names.findIndex((n) => /mute/i.test(n))).toBeLessThan(names.findIndex((n) => /end call/i.test(n)));
});

it('the terminating control reads "End call", not "Hang up"', () => {
  expect(screen.queryByRole("button", { name: /hang up/i })).toBeNull();
  expect(screen.getByRole("button", { name: /end call/i })).toBeInTheDocument();
});
```
Do NOT try to assert the visual fill / rounding / height parity in jsdom — those are smoke checks (constraint 7). You MAY assert the caption compact class from Task 1 and that End call has `whitespace-nowrap`.

- [ ] **Step 2: Run — expect FAIL** (order + "Hang up" label).
- [ ] **Step 3: Implement** 1–4 above. Preserve `call-tile.test.tsx`'s existing pins: Connect keeps `tone="teal"` (`bg-accent`), `surface="dark"`, `size="xs"`, `gate="none"`, and stays natively `disabled` via `unavailableReason` when there's no property.
- [ ] **Step 4: Run the call-tile test file — expect PASS** (new + all existing pins).
- [ ] **Step 5: Commit.** `git commit -m "fix(call-tile): unified order, End call label, normalized bar, Video/Chat fill"`

---

### Task 6: Property card — `Answer` gains an icon

**Why:** spec §4 / D6. `Answer` is label-only while `Silence`/`Connect`/`Kiosk` lead with an icon, throwing off the row alignment (image 3).

**Files:**
- Modify: `apps/portal/components/dashboard/property-card.tsx` (the `Answer` `<Button>` ~`:197-199`; add the icon import)
- Test: `apps/portal/tests/components/property-card.test.tsx` (uses the module-level spy + `Publisher` probe idiom, per CORRECTIONS §1 — verify before writing)

- [ ] **Step 1: Write the failing test.** Ring the card (the file's `'publish … ring for p1'` idiom) and assert the Answer button contains an svg icon:

```tsx
it("Answer renders with a leading icon (alignment with Silence/Connect/Kiosk)", () => {
  // ring p1 via the existing publisher probe, then:
  const answer = screen.getByRole("button", { name: "Answer" });
  expect(answer.querySelector("svg")).not.toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL** (no svg today).
- [ ] **Step 3: Implement.** Import `Phone` from lucide-react (add to the existing lucide import line — `BellOff` is already imported) and render it in the Answer button:

```tsx
<Button onClick={() => guard(answer)} size="sm" className="animate-pulse">
  <Phone aria-hidden="true" />
  Answer
</Button>
```
Leave the comment block above it intact (it explains why Answer stays enabled off duty).

- [ ] **Step 4: Run the property-card test file — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "fix(dashboard): Answer button gets a Phone icon for row alignment (spec D6)"`

---

### Task 7: Dashboard right column — rhythm + off-duty stability

**Why:** spec §5 / D7. Fill the column's vertical rhythm (softphone+shift as the top block, clocks pinned to the bottom, aligned with the properties tile) and stop the cards collapsing off duty (image 6).

**Files:**
- Modify: `apps/portal/components/dashboard-workspace.tsx` (the home grid `:88` and the `<aside>` `:90-108`)
- Modify: `apps/portal/components/dashboard/shift-card.tsx` (a min-height so the off-duty "Not on duty" state occupies the on-duty box)
- Test: `apps/portal/tests/components/dashboard-workspace.test.tsx`, `apps/portal/tests/components/shift-card.test.tsx`

**The change (robust approach, spec §5):**
- Home grid: `grid items-start …` → `grid items-stretch …` (so the aside stretches to the main column's height). Verify the off-home branch (`""`) is untouched and the `hidden` class still hides the aside off-home.
- Aside: it is already `flex flex-col`; add `h-full` (or rely on the stretch) and put the `<ZoneClocksCard />` at the bottom with `mt-auto` on it (or wrap Softphone+Shift in a top group and the clocks in a bottom group). Do NOT reorder the mounted `<VideoCallHost />` — keep it last (headless).
- Shift card: add a `min-h-[…rem]` (a rem value, not px — root font scales to 112.5% at `lg`) sized to the on-duty content, so the off-duty branch renders at the same height. Tune the value at smoke.

- [ ] **Step 1: Write the failing tests** (class-presence proxies; geometry is smoke — constraint 7):

```tsx
// dashboard-workspace.test.tsx — render on the home route
it("home grid stretches the aside so the column can align", () => {
  // find the grid wrapper the file already renders; assert it carries items-stretch
});
it("clocks card is pinned to the bottom of the aside", () => {
  // assert the ZoneClocksCard wrapper carries mt-auto (or the bottom group does)
});
// shift-card.test.tsx
it("shift card holds a stable min-height in every duty state", () => {
  // render off duty; assert the Card carries the min-h-* class; repeat on duty
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the grid/aside/min-height changes.
- [ ] **Step 4: Run both test files — expect PASS** (and the rest of each file).
- [ ] **Step 5: Commit.** `git commit -m "fix(dashboard): stretch aside, pin clocks to bottom, stabilize card height off duty (spec §5)"`

> The real proof is the smoke (toggle duty live and watch the column) — the jsdom tests only guard the classes. If the min-height value needs tuning, that is expected and belongs in the smoke pass.

---

### Task 8: `LinePill` — duty-aware

**Why:** spec §6 / D8. Off duty the pill shows green "Line ready" beside the card's "Your line is offline." — contradictory.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx` (`LinePill` `:1030-1059`, and its call site — pass duty in)
- Test: `apps/portal/tests/components/softphone.test.tsx` — **use the real duty levers, NEVER mock `duty-provider` (constraint 1 / CORRECTIONS §2).** New tests live in the `describe("Softphone — D13 duty hydration + gated beats")` block; set `hydration = { onDuty: false, accepting: true }` before `renderSoftphone("AGENT")`; every test is async (open with the existing ready-wait). Verify all of this against the file before writing.

**The change:** give `LinePill` an `offDuty` (or `onDuty`) prop. When off duty, render the muted (non-`ok`) style with label **"Off duty"**, regardless of `phase`. On duty, the existing phase logic stands. Source the flag from the softphone's existing `onDuty`/`canWork` (already in scope — see `:118`, `:139`).

```tsx
function LinePill({ phase, offDuty }: { readonly phase: Phase; readonly offDuty: boolean }) {
  const ok = !offDuty && (phase === "ready" || phase === "incoming" || phase === "in-call");
  const label = offDuty
    ? "Off duty"
    : phase === "in-call" ? "On call"
    : phase === "incoming" ? "Incoming"
    : phase === "ready" ? "Line ready"
    : phase === "error" ? "Offline"
    : "Connecting";
  // …existing markup, driven by `ok` and `label`…
}
```
At the call site, pass `offDuty={!onDuty}` (use the same duty value the card copy uses so they cannot disagree).

- [ ] **Step 1: Write the failing tests** (in the duty-hydration describe block):

```tsx
it('pill reads "Off duty", muted, when off duty', async () => {
  hydration = { onDuty: false, accepting: true };
  renderSoftphone("AGENT");
  await waitFor(() => expect(screen.getByTestId("duty-onduty").textContent).toBe("false"));
  expect(screen.getByText("Off duty")).toBeInTheDocument();
  expect(screen.queryByText("Line ready")).toBeNull();
});
```
(Verify `getByTestId("duty-onduty")` exists in the file's harness; if the harness exposes duty differently, match it.)

- [ ] **Step 2: Run — expect FAIL** (pill shows "Line ready" today).
- [ ] **Step 3: Implement** the prop + call site.
- [ ] **Step 4: Run the softphone test file — expect PASS** (and confirm the `:587` accept-gate tests still pass — they must, since you did not mock the provider).
- [ ] **Step 5: Commit.** `git commit -m "fix(softphone): LinePill reads Off duty when off duty (spec §6)"`

---

### Task 9: Captions — swallow the async teardown rejection

**Why:** spec §7 / D9. `stopRecognition()` on a still-`CONNECTING` WebSocket rejects asynchronously; the sync `try/catch` misses it → unhandled rejection → Sentry.

**Files:**
- Modify: `apps/portal/lib/captions/provider.ts:78`
- Test: `apps/portal/tests/lib/captions/…` (node project — mock `@speechmatics/real-time-client`; verify the existing captions test layout first)

- [ ] **Step 1: Write the failing test.** Make `stopRecognition` return a rejecting promise; assert calling the stream's `stop()` does not surface an unhandled rejection (e.g., spy on `process`/window `unhandledrejection`, or assert `stop()` resolves without throwing and no rejection escapes a `flushPromises()`):

```ts
it("stop() swallows a rejecting stopRecognition (WS still CONNECTING)", async () => {
  // arrange a mock RealtimeClient whose stopRecognition returns Promise.reject(new Error("CONNECTING"))
  const stream = createCaptionStream("jwt");
  // …start() far enough to install `client`… then:
  expect(() => stream.stop()).not.toThrow();
  await Promise.resolve(); // microtask flush — no unhandled rejection
});
```

- [ ] **Step 2: Run — expect FAIL** (the rejection escapes today).
- [ ] **Step 3: Implement** — attach a catch to the async call in `cleanup()`:

```ts
// was: try { client?.stopRecognition?.({ noTimeout: true }); } catch { /* ignore */ }
try {
  void Promise.resolve(client?.stopRecognition?.({ noTimeout: true })).catch(() => {
    /* expected during connect-then-abort; the WS was still CONNECTING */
  });
} catch { /* ignore a synchronous throw too */ }
```

- [ ] **Step 4: Run the captions test — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "fix(captions): swallow async stopRecognition rejection on connect-then-abort (spec §7)"`

---

### Task 10: Kiosk — even the control-pill corner spacing

**Why:** spec §8 / D10. The pill's rounded ends crowd the first/last circular button (image 4). **Separate app; verify on the real tablet, not in jsdom.**

**Files:**
- Modify: `apps/kiosk/src/screens/CallControls.tsx:55` (the pill container padding)
- Test: `apps/kiosk/tests/…` if a `CallControls` test exists — padding-only, so keep any existing test green; do not add a jsdom assertion for the visual spacing (constraint 7).

- [ ] **Step 1:** Read the container: `absolute bottom-6 … gap-3 rounded-pill … px-3 py-2.5`. The circular buttons are `size-14` (56px). Because `rounded-pill` fully rounds the ends, the first/last circle sits inside a large curve. Increase the horizontal padding so the whitespace at the rounded ends matches the `gap-3` between buttons — e.g. `px-3` → `px-4` (or `px-5`), verify against `gap-3`. This is a judgment tweak; land a candidate value.
- [ ] **Step 2:** `pnpm -F @lc/kiosk test -- run` (green — no behaviour change) + `pnpm -F @lc/kiosk build`.
- [ ] **Step 3: Commit.** `git commit -m "fix(kiosk): even the call-control pill corner spacing (spec §8)"`
- [ ] **Step 4 (smoke, later):** confirm on the real tablet; iterate the padding value there if needed. Safe to land last or split out.

---

### Task 11: Whole-gate + cleanup

- [ ] **Step 1:** Run the full gate:
```bash
pnpm -F @lc/portal test -- run && pnpm -F @lc/kiosk test -- run && pnpm typecheck && pnpm lint && pnpm check:routes && pnpm -F @lc/portal build
```
Expected: all green; portal test count ≥ baseline + the new tests; **zero** regressions.
- [ ] **Step 2:** Confirm `git status` shows only intended files; the `supabase/` diff is empty; `lib/remote-access/connect.ts` is untouched; the 911 blocks in `audio-call-overlay.tsx` / `call-tile.tsx` are byte-identical (whitespace-normalized diff empty).
- [ ] **Step 3 (optional):** `git clean -n` to preview, then remove the 21 untracked `"… 2.tsx"` duplicates if desired (`git clean -f -- 'apps/portal/**/* 2.tsx' 'apps/portal/**/* 2.ts'` — preview first).
- [ ] **Step 4:** Request the whole-branch review (superpowers:requesting-code-review), then hand back to Kumar for the prod smoke (the visual items in constraint 7).

---

## Self-review (done at authoring)

**Spec coverage:** A→§3.1/3.2 (T3,T4,T5) · B→§3.3 (T2) · C→§3.4 (T3) · D→§3.5 (T5) · E→§4 (T6) · F→§5 (T7) · G→§6 (T8) · H→§7 (T9) · I→§8 (T10) · reconciliation §9 folded into T2/T3. All covered.

**Type/name consistency:** `LinePill` gains `offDuty: boolean`; `CaptionToggle` keeps its `compact` prop; `EndCallButton` `tone: "navy" | "blaze"` unchanged (only the video caller's value flips). `Phone` added to the existing lucide import in `property-card.tsx`.

**Known-brittle, flagged in-plan:** the shift-card min-height value (T7) and the kiosk padding value (T10) are smoke-tuned, not asserted — called out at both sites.
