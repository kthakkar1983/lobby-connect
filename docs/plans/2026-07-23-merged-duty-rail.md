# Merged Duty rail (Proposal B) — implementation plan

> **For agentic workers:** implement task-by-task with `superpowers:subagent-driven-development` (fresh implementer + two-stage review per task, opus whole-branch at the end). Steps use `- [ ]`.

**Goal.** Kill the staggered right-rail on the agent/admin dashboard home. Merge the softphone-idle card + the shift card into one **Duty card**, and put the home layout on a **shared 2-row grid** so the rail's two tiles (Duty, Clocks) align edge-for-edge with the left column — by construction, no magic-number heights. Design was locked with the user against a live mockup (Proposal B), validated on admin + agent, off-duty + on-duty.

**Visual spec (the locked mockup).** Local file `…/scratchpad/dashboard-layout-mockup.html` (served at `localhost:8912` during the design session; ephemeral). The target:
- Right rail = **Duty card** (row 1) + **Clocks** (row 2). Rail runs the full height of the left column; no dead-end, no floating edges.
- **Duty card** = the softphone's idle face (SOFTPHONE label + line pill + the go-on-duty ring / "Line ready") **+ a 1px divider + the shift content** ("Your shift" → "Not on duty", or the running timer + "On duty since" + Break / End shift). Off duty it's airy; **on duty it fills** (that's the state agents sit in most of the night).
- **Split rule (one seam per page):** Duty aligns to the top block, Clocks to the rest.
  - **Admin:** Duty ‖ [Pulse row + Tonight card] · Clocks ‖ [Properties + Team/Recent].
  - **Agent:** Duty ‖ [Pod + Stats] · Clocks ‖ [Chart + Recent]. (Agent Duty stops **before** the chart so the Clocks region is tall enough for all four clock faces.)

## Architecture (why it's shaped this way)

The rail lives in `dashboard-workspace.tsx`, inside `<aside>`, under the provider stack from `app-shell.tsx`. The left content arrives as opaque `children` (the role page). To align two independent columns edge-for-edge, the tiles must share grid rows — achieved with **CSS subgrid**: the workspace is a 2-row grid; `<main>` and `<aside>` each span both rows as **subgrids**, so `<main>`'s two page sections and `<aside>`'s two tiles land on the *same* row lines. Semantics (`<main>`/`<aside>` + `#main` skip-link target) are preserved (no `display:contents` hack).

## SAFETY INVARIANTS (do not violate — sourced from the subsystem map)

1. **The Twilio `Device` is instance-local to `<Softphone>`** (`softphone.tsx:83` `deviceRef`, mount effect `:526-538` keyed on the empty-dep `connect`). It **survives** re-skinning the component in its **same tree slot**, but a **remount kills it** (destroy + re-register). Therefore:
   - `<Softphone>` must stay a child of the same `<aside>` subtree, wrapped by the new `DutyCard`, and **`DutyCard` must always be mounted** (hidden off-home via CSS, exactly like the aside is today — never conditionally rendered, never given a changing `key`).
   - The one structural swap (aside children `[Softphone, ShiftCard]` → `[DutyCard]`) happens once at deploy = a page load = a fresh mount. There is **no runtime remount** afterward because `DutyCard` is always present. Do not introduce `{onHome ? <DutyCard/> : null}`.
2. **No `React.memo`/`Suspense` between `DutyProvider` and the softphone** (`app-shell.tsx:42-48`, echoed `softphone.tsx:141-155`). `DutyCard` is a **plain wrapper** — no memo, no suspense, no lazy.
3. **Regression guards stay byte-identical.** Do not touch: accept-gate `softphone.tsx:612`; 911 machinery `softphone.tsx:73-80, 658-671, 704-760, 996-1000`; notes `softphone.tsx:175-211, 678-701, 812-837`; the ShiftCard mid-call rules (Break *removed* not disabled `shift-card.tsx:225`; End shift *disabled* + title-span `shift-card.tsx:97-134`; clock ticks through a call `:165-169`). The `chromeless`/`chromeless` work only toggles **outer wrapper chrome**, never inner logic/JSX.
4. **`ShiftCard` uses `useDuty()` non-optional** (`shift-card.tsx:153`) — it throws without a `DutyProvider` ancestor. It stays inside the provider tree (it will, inside `DutyCard` inside the workspace). Tests that render `<ShiftCard>` standalone already wrap/allow it — keep that.

## Constraints (all tasks)

- **Zero migrations / API routes / RLS / server actions.** Presentation + layout only.
- **jsdom has no layout engine.** Tests assert classes/attributes/DOM-order, never pixel alignment or subgrid resolution. The **real gate is the live prod smoke** (Task 6) — never call a visual result "verified" from jsdom.
- **Widths/heights in Tailwind rem scale, never px** (root font scales to 112.5% at `lg`).
- **Gate per task:** `pnpm -F @lc/portal test` (both configs — node + `vitest.jsdom.config.ts`), `pnpm -F @lc/portal typecheck`, `pnpm lint`, `pnpm -F @lc/portal build`, `pnpm check:routes` (root script). No kiosk changes in this plan.
- **`@testing-library/jest-dom` is NOT installed** — use `getByText`/`getByRole` + `.toBeTruthy()`/`.not.toBeNull()`, never `.toBeInTheDocument()`.
- **jsdom config invocation:** component tests need `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>` (a bare `-F @lc/portal test <substr>` mis-passes args to the compound script).

---

## Task 1 — `ShiftCard` gains a `chromeless` prop

Render the shift's inner content without the outer `<Card>`, so `DutyCard` can supply one shared card around softphone + shift.

**Files:** modify `apps/portal/components/dashboard/shift-card.tsx`; update `apps/portal/tests/components/shift-card.test.tsx`.

- [ ] **Step 1 — failing test.** Add cases: `render(<ShiftCard chromeless />)` (inside a DutyProvider mock, as the file already sets up) — the root element does **not** carry the `<Card>` chrome (no `rounded-[…]`/`shadow` card classes; assert `container.firstElementChild` lacks the Card's `data-slot="card"`), the "Your shift" label and body still render, and Break/End-shift/timer behaviors are unchanged. Keep a `render(<ShiftCard />)` (default) case asserting the Card chrome is still present.
- [ ] **Step 2 — run, verify red.**
- [ ] **Step 3 — implement.** Extract the current inner children (label + body + actions, identical for both duty states) into an inner render. Add `chromeless?: boolean` (default `false`). When `false`: keep today's `<Card className={CARD_CLASS}>…</Card>` **verbatim** (`CARD_CLASS = "min-h-[10rem] gap-3 p-4"`, `shift-card.tsx:150`). When `true`: render the same children inside a bare `<div className="flex flex-col gap-3">` (no border/shadow/min-h — the parent DutyCard owns chrome + height). **Do not** alter the on-duty/off-duty branching, the `useDuty()` reads, the mid-call rules, `EndShiftButton`, or the interval. The existing `min-h-[10rem]` only applies in the non-chromeless path.
- [ ] **Step 4 — update the layout-stability test** (`shift-card.test.tsx:288-306`): it asserts `container.firstElementChild.className` matches `/min-h-\[/` and off===on. That premise holds for the **default** (non-chromeless) render — keep it scoped to `<ShiftCard />` (no `chromeless`). Add the chromeless assertions as new cases; do not delete the default-path guard.
- [ ] **Step 5 — run green; full gate; commit** `feat(shift-card): add chromeless mode for the merged duty card`.

## Task 2 — `<Softphone>` gains a `chromeless` prop

Let the softphone render its idle/in-call tree **without** its hand-rolled outer chrome `div`, so it can sit inside the DutyCard.

**Files:** modify `apps/portal/components/softphone/softphone.tsx`; update `apps/portal/tests/components/softphone.test.tsx`.

- [ ] **Step 1 — failing test.** `render(<Softphone role="AGENT" chromeless />)` (matching the file's existing provider wrappers/mocks): the outermost element does **not** carry the chrome classes from `softphone.tsx:804` (`rounded-card border border-border bg-card p-4 … shadow-md`); the header ("Softphone" label + line pill), the go-on-duty ring, and the status text still render. Default `render(<Softphone role="AGENT" />)` still has the chrome div. **The accept-gate, 911, and notes tests in this file must remain untouched and green.**
- [ ] **Step 2 — run, verify red.**
- [ ] **Step 3 — implement.** At the single return wrapper (`softphone.tsx:804`), make the outer `div`'s chrome classes conditional on a new `chromeless?: boolean` prop (default `false`). Cleanest: keep one wrapper `<div>` but swap its `className` — `chromeless ? "text-sm" : "rounded-card border border-border bg-card p-4 text-sm shadow-md"` (preserve `text-sm`; DutyCard supplies padding). **Everything inside the wrapper (header, the four conditional blocks at `:812-1026`, the fixed in-call overlay, all handlers/refs/effects) is unchanged.** Verify `softphone.tsx:901-906`'s load-bearing `relative` wrapper and the `.lc-seam-drift` ring markup are untouched (pinned by `softphone.test.tsx:941-942, 658`).
- [ ] **Step 4 — run green.** Confirm the accept-gate/911/notes suites are byte-identical and passing.
- [ ] **Step 5 — full gate; commit** `feat(softphone): add chromeless mode (drop outer card chrome)`.

## Task 3 — `DutyCard` container

**Files:** new `apps/portal/components/dashboard/duty-card.tsx`; new `apps/portal/tests/components/duty-card.test.tsx`.

- [ ] **Step 1 — failing test.** `render(<DutyCard role="AGENT" />)` (inside the same Duty/CallSurface/LineStatus provider mocks the softphone + shift tests use): renders exactly one card wrapper containing, in DOM order, the softphone header, then a divider element, then the shift content ("Your shift"). `role` is forwarded to Softphone. Assert no second `<Card>` nested inside (softphone + shift are chromeless).
- [ ] **Step 2 — run, verify red.**
- [ ] **Step 3 — implement.** A plain (un-memoized) component:
  ```tsx
  export function DutyCard({ role }: { readonly role: "ADMIN" | "AGENT" }) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <Softphone role={role} chromeless />
        <div className="border-t border-border" aria-hidden="true" />
        <ShiftCard chromeless />
      </Card>
    );
  }
  ```
  No `React.memo`, no `Suspense`, no `key` on Softphone. Card provides padding/border/shadow once. (Internal flex to center the ring vs. pin the shift is **visual tuning deferred to Task 6** — jsdom can't judge it; keep the structure simple here.)
- [ ] **Step 4 — run green; full gate; commit** `feat(dashboard): DutyCard merging softphone + shift`.

## Task 4 — Split the two home pages into `top`/`bottom` section groups

Purely structural: wrap the existing left tiles in two `<section>`s so the subgrid (Task 5) can align to them. **No visual change on its own** (with the current single-column workspace the two sections just stack, same gaps).

**Files:** modify `apps/portal/app/(admin)/admin/page.tsx` and `apps/portal/app/(agent)/agent/page.tsx`; touch the page tests only if they pin the single-root `<div>` (check first).

- [ ] **Step 1.** Admin (`admin/page.tsx:220-364`): replace the single `<div className="flex flex-col gap-4">` wrapping [AutoRefresh + h1 + pulse-grid + Tonight card + Properties card + bottom 2-up grid] with a fragment of **two** groups sharing the same gap:
  - `<section className="flex flex-col gap-4">` **top** = pulse `grid` + Tonight `<Card>`.
  - `<section className="flex flex-col gap-4">` **bottom** = Properties `<Card>` + the `lg:grid-cols-2` Team/Recent row.
  - Keep `<AutoRefresh />` and the `sr-only` `<h1>` at the very top (put them in the top section, before the pulse grid). The outermost returned element becomes `<>…</>` (two sections) — no wrapping single `<div>` (so `<main>`'s subgrid sees exactly two row children in Task 5).
- [ ] **Step 2.** Agent (`agent/page.tsx:94-158`): same split — **top** = "Your pod" `<Card>` + the 4-stat `flex` row; **bottom** = "Hourly call volume" `<Card>` + "Recent calls" `<Card>`. AutoRefresh + `sr-only h1` in the top section.
- [ ] **Step 3 — verify no regression.** Both pages still render every tile in the same order; `pnpm -F @lc/portal build` + typecheck. On the *current* (pre-Task-5) workspace this is visually identical (sections stack). Commit `refactor(dashboard): split admin/agent home into top/bottom sections`.

## Task 5 — Workspace: merge the rail + the 2-row subgrid + drop sticky

The crux. **Files:** modify `apps/portal/components/dashboard-workspace.tsx`; rewrite the affected guards in `apps/portal/tests/components/dashboard-workspace.test.tsx`.

- [ ] **Step 1 — failing tests.** Update `dashboard-workspace.test.tsx`:
  - Aside now contains **`DutyCard`** (softphone testid + "Your shift" text both inside one card) then **Clocks** then **VideoCallHost** — update the DOM-order test (`:130-146`) to softphone → shift → clocks order preserved *within* the merged structure.
  - **Remove the sticky guard** (`:187-193`) and its expectations; **replace** with: on home, `<main>` and `<aside>` carry `lg:grid-rows-subgrid` (assert the class strings); off-home, aside carries `hidden` and is still mounted (keep `:271-284`).
  - Keep: cards in `<aside>` not `<main>` (`:155-167`), CallBackShortcut agent-only (`:202-213`), header carries no duty affordance (`:217-249`), End-shift inside aside not header (`:259-268`).
  - The overshoot guard (`:169-185`) forbids `items-stretch`/`h-full`/`mt-auto` — **keep it** (subgrid needs none of those); it still guards against a regression to the D7 hack.
- [ ] **Step 2 — run, verify red.**
- [ ] **Step 3 — implement.**
  - Aside children: replace `<Softphone role={role} />` + `<ShiftCard />` with a single `<DutyCard role={role} />`. Keep `<ZoneClocksCard />` and `<VideoCallHost operatorId={operatorId} />` after it (VideoCallHost renders null when idle / fixed overlay when active — it never occupies a grid row).
  - Home grid (`:88`): the wrapper becomes a 2-row grid at `lg`: `onHome ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-2" : ""`. (Drop `items-start`.)
  - `<main>` (`:89`): `onHome` → `id="main" className="flex flex-col gap-4 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:gap-6"`; off-home → `id="main"` only (plain). The two page sections become the two subgrid rows; below `lg` they stack with `gap-4`.
  - `<aside>` (`:90`): `onHome ? "flex flex-col gap-3 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:gap-6" : "hidden"`. **Remove `lg:sticky lg:top-6 lg:self-start`** — the rail now fills the full height, so sticky is both impossible and unnecessary (documented tradeoff: the rail no longer follows-scroll; it scrolls with the page). Update the docblock (`:92-121`) to describe the subgrid + the sticky removal, and delete the stale "do NOT re-add items-stretch/h-full/mt-auto" note's sticky rationale (keep the anti-overshoot warning).
  - **Row-count contract:** `<main>` subgrid expects exactly two section children (Task 4 guarantees this on home). `<aside>` subgrid expects two row-occupying children (DutyCard, Clocks); VideoCallHost must render null/fixed so it adds no third row — verify.
- [ ] **Step 4 — run green.** Full portal suite (both configs) + typecheck + lint + build + `pnpm check:routes`.
- [ ] **Step 5 — commit** `feat(dashboard): merged duty rail on a shared 2-row grid`.

## Task 6 — Live-verify + visual tuning (the real gate)

jsdom proved structure; only a browser proves alignment. Deploy the branch; the user live-verifies on the real deploy.

- [ ] Verify on the real **admin** and **agent** home, **off duty and on duty**, at desktop `lg` and narrow: Duty/Clocks edges meet the left seams; rail fills full height; no floating edges; on-duty Duty card fills; four clock faces fit their region; mobile stacks cleanly.
- [ ] Tune (visual-only, re-verify): DutyCard internal flex (center the ring vs. pin the shift below the divider to match the mockup), ZoneClocksCard filling a taller cell if it reads empty (e.g., `align-content`/face size), and the `lg:gap-6` row gap vs the left `gap-4` so the seam lines match. Keep every change class-level and re-run the gate.
- [ ] Regression walk: go on duty / take break / resume / end shift; answer an audio call (accept-gate, notes, 911 dialog still correct); confirm the line does **not** drop when navigating admin routes (Device persists).

---

## Self-review

- **Safety:** softphone stays in-slot inside an always-mounted DutyCard (no runtime remount → Device persists); no memo/suspense added; regression anchors untouched (chromeless/chromeless toggle only outer chrome). Matches the map's two separate safety properties (Device-local vs provider-held state).
- **Alignment mechanism:** subgrid gives edge alignment by construction with zero magic numbers and preserves `<main>`/`<aside>` semantics + the `#main` skip target — no `display:contents`, no measured heights (the failure modes of the two prior attempts).
- **Sticky:** removing it is intrinsic to a full-height rail (B); flagged for the user at live-verify.
- **Test debt:** the sticky guard is replaced (not silently dropped); the overshoot guard is retained; the shift root-class guard stays scoped to the non-chromeless default path.
- **Zero** migrations/routes/RLS. Kiosk untouched.
