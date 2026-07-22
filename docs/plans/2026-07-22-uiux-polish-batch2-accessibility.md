# UI/UX Polish — Batch 2 (Accessibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the accessibility tranche of the whole-app UI/UX audit — visible focus rings on every hand-rolled control (incl. both 911 buttons), non-color labels on color-only status signals, owner bottom-nav touch-target + safe-area, and full-length reduced-motion connection lines — each live-verified on the deployed build.

**Architecture:** Mechanical, low-risk, additive className/label changes plus one pure-helper extraction. Zero migrations / API routes / RLS / call-logic. This is Batch 2 of the five-batch plan in [`docs/plans/2026-07-21-uiux-polish.md`](2026-07-21-uiux-polish.md); the spec is the audit's Themes **D** (color-alone status), **E** (focus rings), the owner touch-target/safe-area finding, and the reduced-motion FloatingPaths finding ([`docs/audits/2026-07-20-whole-app-uiux-audit.md`](../audits/2026-07-20-whole-app-uiux-audit.md)).

**Tech Stack:** Next.js App Router (portal) + Vite (kiosk), Tailwind v4 tokens, shadcn/Radix primitives, Vitest + Testing Library (jsdom).

---

## Scope (the spec, from the parent plan's Batch 2 line + audit Themes D/E)

1. **Focus rings** — add the brand `focus-visible` ring to every hand-rolled `<button>`/`<Link>` that lacks one: both 911 buttons, the call-tile controls (Mute/Camera/Chat/Captions/End call), `CaptionToggle`, softphone **Go on duty** + **Accepting**, the three hand-rolled auth submit buttons, owner/dashboard row + card links (`CallRow`, `RecentCallRow` expand, `IncidentRow`), and the password show/hide toggle. Flip Dialog/Sheet close buttons from `focus:` to `focus-visible:`.
2. **Color-alone status → add a non-color cue** — team-on-now presence (add the text label), the admin status page card (add the ok/warn/down word), owner bottom-nav active tab (add the desktop's `bg-accent/10` region fill).
3. **Owner bottom-nav** — ≥44px touch targets + `env(safe-area-inset-bottom)`.
4. **Reduced-motion FloatingPaths** — render full static lines (`pathLength: 1`), not 30% stubs, in **both** apps.

**Out of scope (leave for later batches, do NOT expand into them):** the kiosk-liveness dot + chart bars (Theme D tail — not in Batch 2's line; the dot already carries a `title`), the side-stripe status edges (Theme G — a director decision handled in Batch 3), any copy/em-dash work (Batch 4), and any primitive extraction / `StatusBadge` (Batch 5). Terminology stays as-is this batch.

## Constraints (ALL tasks)

- **Zero migrations / API routes / RLS / call-logic.** Every change is a className, an added label/`sr-only`, or a pure helper.
- **Do not touch the regression guards.** The 911 machinery (the `onTriggerEmergency`/`triggerEmergency` wiring, the two-tap arm logic, the conference dialog *actions*), the notes handlers (`saveNotes`/`pendingNotes`/`onSaveNotes`), `handleConnect`, and the `softphone.tsx:587` accept-gate stay byte-identical. Adding a `className` focus ring to a button is fine; changing any handler is not. If a diff would touch a handler, stop and flag.
- **Edit the REAL files, never the untracked `" 2.tsx"/" 2.ts"` byte-copies.** The working tree has 16 stray duplicates (e.g. `components/call/call-shell 2.tsx`, `tests/components/call-controls.test 2.tsx`). They are not imported and not built. Only ever edit the un-suffixed file.
- **jsdom has NO layout engine.** Tests assert class names, attributes, and rendered text — they can prove a ring class or a label is applied, never that it is visible or lines up. The REAL verification is the live prod smoke (the gate at the end). Never call a visual fix "verified" from jsdom alone. This is the standing house lesson.
- **Widths/sizes in Tailwind scale (rem), never px** (the portal root font scales to 112.5% at `lg`). `min-h-[44px]` is the one deliberate px exception in this batch — 44px is a fixed WCAG touch-target floor (a physical-pixel minimum), not a value that should track the type scale, so it is written in px on purpose.
- **Gate commands (run per task, all green before commit):** `pnpm -F @lc/portal test`, `pnpm -F @lc/portal typecheck`, `pnpm lint`, `pnpm -F @lc/portal build`, `pnpm check:routes`. Kiosk tasks (Task 9) also `pnpm -F @lc/kiosk test` + `pnpm -F @lc/kiosk build`. Component tests run under `vitest.jsdom.config.ts` (the default vitest config EXCLUDES `tests/components/**`) — run them with `pnpm -F @lc/portal test --config vitest.jsdom.config.ts <file>`. Per-package `lint` skips `tests/`; lint a changed test file explicitly with `pnpm -F @lc/portal exec eslint tests/...`. If root `pnpm lint` trips on a stray `.claude/worktrees/` checkout, that is the known environment snag — the branch code is what must be clean; use the per-package lints to confirm.

## The three ring recipes (use verbatim — the class string must be identical in the test and the implementation)

- **LIGHT** (controls on `bg-card` / `bg-background` surfaces — auth, overlays' light header, password field):

  ```
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
  ```

  This is the exact recipe the shared `Button` uses (`components/ui/button.tsx:8`).

- **DARK** (controls on the navy call-tile face, `bg-primary`):

  ```
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary
  ```

  A cream ring + navy offset gap reads crisply on navy; `ring-ring` (navy) would be near-invisible there. (The overlay's existing reopen-tile button already establishes the dark-surface pattern with `ring-live ring-offset-call`; this is the same idea for the tile's own `bg-primary` root.)

- **INSET** (full-bleed row buttons where an offset ring would overflow the row — `CallRow`/`RecentCallRow` expanders):

  ```
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
  ```

Append these as plain trailing classes. None of the target hand-rolled buttons currently carry any `ring-*` utility, so there is no twMerge conflict — the classes survive verbatim (that is what the tests assert).

---

## Task 1: Focus rings on the call-tile hand-rolled controls (DARK)

The tile face is `bg-primary` (navy). Four hand-rolled controls there have no focus ring: the 911 button (`call-tile.tsx:287`), the shared `TileIconButton` (`:132` — covers Mute/Camera/Chat/Captions), and the End-call button (`:482`).

**Files:**
- Modify: `apps/portal/components/call-tile/call-tile.tsx` (the `TileIconButton` className `:138`, the 911 button className `:290`, the End-call button className `:487`)
- Test: `apps/portal/tests/components/call-tile.test.tsx` (extend — reuse its existing render harness; do NOT rebuild the CallSurfaceProvider setup)

- [ ] **Step 1 — Write the failing test.** In `call-tile.test.tsx`, using the file's existing helper that renders `<CallTile />` with an active VIDEO call + registered controls, add a test that the tile's Mute button, its 911 button, and its End-call button each carry the DARK ring. Query by accessible name (`getByRole("button", { name: /mute/i })`, `/911/i`, `/end call/i`) and assert:

```ts
expect(btn.className).toContain("focus-visible:ring-primary-foreground");
expect(btn.className).toContain("focus-visible:ring-offset-primary");
```

- [ ] **Step 2 — Run it, verify it fails.** `pnpm -F @lc/portal test --config vitest.jsdom.config.ts call-tile` → FAIL (no ring classes).
- [ ] **Step 3 — Implement.** Append the DARK recipe to all three className strings:
  - `TileIconButton` (`:138-143`): add the DARK recipe to the `cn("relative grid size-7 shrink-0 place-items-center rounded-full border transition-transform active:scale-95", …)` base (as a trailing string arg to `cn`, before the `pressed ? … : …` branch or after it — order is irrelevant, no conflict).
  - 911 button (`:290`): append the DARK recipe to `"absolute right-2 top-2 z-10 flex items-center gap-1 rounded-button bg-destructive px-2 py-1 text-xs font-semibold text-destructive-foreground shadow-md"`.
  - End-call button (`:487`): append the DARK recipe to `"ml-auto grid size-7 shrink-0 place-items-center rounded-full bg-attention text-attention-foreground transition-transform active:scale-95"`.
- [ ] **Step 4 — Run it, verify it passes.** → PASS.
- [ ] **Step 5 — Full gate + commit.** Gate commands above. Commit: `fix(a11y): focus rings on the call-tile controls`.

> The 911 two-tap arm logic, `controls.*` dispatch, and chat/camera gating are untouched — only className strings change.

## Task 2: Focus rings on the audio-overlay 911 button + CaptionToggle

The audio 911 button (`audio-call-overlay.tsx:186`) sits in the CallShell header, which is `bg-card` (`call-shell.tsx:115`) — LIGHT. `CaptionToggle` (`caption-toggle.tsx:47`) renders labelled on the light overlay bar and (compact) on the navy tile if ever used, so its ring is per-branch.

**Files:**
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx:186-189` (the 911 `<button>`)
- Modify: `apps/portal/components/call/caption-toggle.tsx:59-66` (the button's `cn(...)`)
- Test: `apps/portal/tests/components/audio-call-overlay.test.tsx` (extend) + `apps/portal/tests/components/caption-toggle.test.tsx` (extend)

- [ ] **Step 1 — Write the failing tests.**
  - In `audio-call-overlay.test.tsx`, render `<AudioCallOverlay …>` with the file's existing minimal props and assert the 911 trigger button (`getByRole("button", { name: /call 911/i })`) carries the LIGHT ring:

    ```ts
    expect(btn.className).toContain("focus-visible:ring-ring");
    expect(btn.className).toContain("focus-visible:ring-offset-background");
    ```
  - In `caption-toggle.test.tsx`, render `<CaptionToggle enabled={false} onToggle={() => {}} />` (labelled) and assert LIGHT ring; render `<CaptionToggle enabled={false} onToggle={() => {}} compact />` and assert the DARK ring (`focus-visible:ring-primary-foreground`).
- [ ] **Step 2 — Run them, verify they fail.**
- [ ] **Step 3 — Implement.**
  - `audio-call-overlay.tsx:189`: append the LIGHT recipe to `"flex items-center gap-1.5 rounded-button bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50"`.
  - `caption-toggle.tsx`: in the `cn(...)`, add the ring per-branch on `compact`. Add a line to the `cn` args: `"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2", compact ? "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary" : "focus-visible:ring-ring focus-visible:ring-offset-background"`. (Splitting the color/offset off the shared `ring-2`/`offset-2` keeps the branch to just the two surface-specific tokens.)
- [ ] **Step 4 — Run them, verify they pass.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): focus rings on the audio 911 button and captions toggle`.

> `onTriggerEmergency`, the AlertDialog wiring, and the caption `onToggle` are untouched.

## Task 3: Focus rings on shared primitives (PasswordInput toggle; Dialog/Sheet close)

**Files:**
- Modify: `apps/portal/components/ui/password-input.tsx:23-28` (the show/hide `<button>`)
- Modify: `apps/portal/components/ui/dialog.tsx:73` (`focus:` → `focus-visible:`)
- Modify: `apps/portal/components/ui/sheet.tsx:78` (`focus:` → `focus-visible:`)
- Test: `apps/portal/tests/components/password-input.test.tsx` (new)

- [ ] **Step 1 — Write the failing test.** New file `tests/components/password-input.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PasswordInput } from "@/components/ui/password-input";

afterEach(() => cleanup());

describe("PasswordInput show/hide toggle", () => {
  it("carries a visible focus ring", () => {
    render(<PasswordInput name="password" />);
    const toggle = screen.getByRole("button", { name: /show password/i });
    expect(toggle.className).toContain("focus-visible:ring-2");
    expect(toggle.className).toContain("focus-visible:ring-ring");
  });
});
```

- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.**
  - `password-input.tsx:28`: append `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md` to `"absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-foreground"`. (INSET so the ring does not overflow the input's right edge; `rounded-md` gives it a shape.)
  - `dialog.tsx:73`: replace `focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden` (leave the static `ring-offset-background` and everything else exactly as-is).
  - `sheet.tsx:78`: the same `focus:` → `focus-visible:` replacement on its close button.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): keyboard focus rings on password toggle and dialog/sheet close`.

## Task 4: Focus rings on the softphone duty controls (Go on duty; Accepting)

Both are hand-rolled `<button>`s on the light softphone card: Go on duty (`softphone.tsx:896`), Accepting toggle (`softphone.tsx:947`). Add the LIGHT ring. **Nothing else in softphone changes** — leave the notes Retry/Discard buttons (near the notes machinery), the accept-gate at `:587`, and every handler byte-identical.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx:896-900` (Go on duty `<button>`) and `:947-970` (Accepting `<button>`)
- Test: `apps/portal/tests/components/softphone.test.tsx` (extend — reuse `renderSoftphone`, the real `DutyProvider`; per the house gotcha, do NOT mock the duty provider)

- [ ] **Step 1 — Write the failing test(s).** In `softphone.test.tsx`, using the existing on-duty flow (`renderSoftphone("AGENT")` then `await waitFor(() => screen.getByText(/Accepting calls/i))`), add a test that the Accepting toggle carries the LIGHT ring:

```ts
const toggle = screen.getByRole("button", { name: /accepting calls|not accepting calls/i });
expect(toggle.className).toContain("focus-visible:ring-ring");
expect(toggle.className).toContain("focus-visible:ring-offset-background");
```

  If the file already has (or can cheaply reach) an OFF-duty render — inspect how it stubs `GET /api/presence`, and make that stub resolve off-duty for one test so the `Go on duty` button renders — add the same assertion on `getByRole("button", { name: /go on duty/i })`. If an off-duty render is not cleanly reachable with the existing harness, add the ring in the implementation anyway and note that the Go-on-duty ring is verified at the live smoke (the jsdom-limits constraint). Do not rebuild the softphone harness to force it.
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.**
  - Go on duty (`:896-900`): the `<button className="mt-1 flex flex-col items-center">` → append `rounded-lg` + the LIGHT recipe: `"mt-1 flex flex-col items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"`.
  - Accepting (`:951-967`): append the LIGHT recipe to the `cn(...)` base string (which already starts `"mt-3 w-full rounded-button border px-3 py-2 font-medium transition-colors"`), as a trailing string arg. Leave the `acceptingNow ? … : …` and `gated && "bg-muted"` branches untouched.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): focus rings on the softphone duty controls`.

## Task 5: Focus rings on the row + card links (CallRow, RecentCallRow, IncidentRow)

**Files:**
- Modify: `apps/portal/components/call/call-row.tsx:25-30` (expand `<button>` — INSET)
- Modify: `apps/portal/components/dashboard/recent-call-row.tsx:54-59` (expand `<button>` — INSET)
- Modify: `apps/portal/components/owner/incident-row.tsx:21-26` (the whole-row `<Link>` — LIGHT)
- Test: `apps/portal/tests/components/call-row.test.tsx` (extend) + `apps/portal/tests/components/recent-call-row.test.tsx` (extend) + `apps/portal/tests/components/incident-row.test.tsx` (new)

- [ ] **Step 1 — Write the failing tests.**
  - `call-row.test.tsx` (reuse its existing sample `CallRowData`): the expand button (`getByRole("button")`) contains `focus-visible:ring-inset` and `focus-visible:ring-ring`.
  - `recent-call-row.test.tsx` (reuse its existing sample `RecentCall`): the expand button contains `focus-visible:ring-inset` and `focus-visible:ring-ring`.
  - `incident-row.test.tsx` (new):

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IncidentRow } from "@/components/owner/incident-row";

afterEach(() => cleanup());

describe("IncidentRow", () => {
  const incident = {
    id: "i1", status: "OPEN" as const, dispatched_to: "PSAP",
    created_at: "2026-07-01T04:00:00Z", propertyName: "The Sample Hotel", timeZone: "America/New_York",
  };
  it("the row link carries a focus ring", () => {
    render(<IncidentRow incident={incident} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("focus-visible:ring-ring");
    expect(link.className).toContain("focus-visible:ring-offset-2");
  });
});
```

- [ ] **Step 2 — Run them, verify they fail.**
- [ ] **Step 3 — Implement.**
  - `call-row.tsx:30`: append the INSET recipe to `"flex w-full items-center gap-3 p-3 text-left"`.
  - `recent-call-row.tsx:59`: append the INSET recipe to `"flex w-full items-center gap-3 py-2 text-left text-sm transition-colors hover:text-accent-text"`.
  - `incident-row.tsx:23-26`: append the LIGHT recipe to the `cn(...)` base string `"flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40"` (as a trailing string arg; leave the `open && "border-l-2 border-l-attention"` branch — the side-stripe is a Batch-3 decision, not this batch's concern).
- [ ] **Step 4 — Run them, verify they pass.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): focus rings on call/incident row links`.

## Task 6: Focus rings on the hand-rolled auth submit buttons

Three auth pages render a hand-rolled `<button type="submit">` (identical className) with no ring; `onboarding-form.tsx` already uses the shared `<Button>` and is fine.

**Files:**
- Modify: `apps/portal/app/(auth)/sign-in/page.tsx:74-78`
- Modify: `apps/portal/app/(auth)/forgot-password/page.tsx:59-63`
- Modify: `apps/portal/app/auth/update-password/page.tsx:54-58`
- Test: `apps/portal/tests/components/auth-submit-ring.test.tsx` (new — render the sign-in page as the representative; mock its action module)

- [ ] **Step 1 — Write the failing test.** New file `tests/components/auth-submit-ring.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(auth)/sign-in/actions", () => ({ signInAction: async () => ({ error: null }) }));

import SignInPage from "@/app/(auth)/sign-in/page";

afterEach(() => cleanup());

describe("auth submit button", () => {
  it("carries a visible focus ring", () => {
    render(<SignInPage />);
    const submit = screen.getByRole("button", { name: /sign in/i });
    expect(submit.className).toContain("focus-visible:ring-2");
    expect(submit.className).toContain("focus-visible:ring-ring");
  });
});
```

  (If the `@/app/(auth)/…` alias does not resolve the parenthesized route group in the test import, use a relative import from the test file instead — the subagent should confirm the alias against an existing test that imports an app-route component, or fall back to `../../app/(auth)/sign-in/page`.)
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.** In all three pages, append the LIGHT recipe to the submit button's className `"rounded-md bg-live px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"`. (Same string in all three; the test proves the recipe on sign-in, the other two are the identical edit and are confirmed at the live smoke.)
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): focus rings on the auth submit buttons`.

## Task 7: Color-alone status labels (status page word; team-on-now presence label)

Two color-only signals get a text cue. `StatusCard` is a pure component (unit-testable); the team-on-now list lives inline in the admin server page (verified at smoke).

**Files:**
- Modify: `apps/portal/app/(admin)/admin/status/status-card.tsx` (add a status word beside the dot)
- Modify: `apps/portal/app/(admin)/admin/page.tsx:27` (import `presenceLabel`) and `:351-360` (render the label)
- Test: `apps/portal/tests/components/status-card.test.tsx` (new)

- [ ] **Step 1 — Write the failing test.** New file `tests/components/status-card.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusCard } from "@/app/(admin)/admin/status/status-card";

afterEach(() => cleanup());

describe("StatusCard", () => {
  it.each([
    ["ok", "OK"],
    ["warn", "Degraded"],
    ["down", "Down"],
    ["unknown", "Unknown"],
  ] as const)("status=%s renders the word %s (not color alone)", (status, word) => {
    render(<StatusCard label="Twilio" status={status} value="last beat 2m ago" />);
    expect(screen.getByText(word)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.**
  - `status-card.tsx`: add a label map beside `DOT`:

    ```ts
    const WORD: Record<SignalStatus, string> = { ok: "OK", warn: "Degraded", down: "Down", unknown: "Unknown" };
    ```

    Then render the word after the label in the dot row (`:23-29`), e.g. change that row's inner markup to keep the dot + `label`, and append a right-aligned status word:

    ```tsx
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="ml-auto font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {WORD[status]}
      </span>
    </div>
    ```

    (Neutral `text-text-muted` — the word itself is the non-color cue; the colored dot still carries the at-a-glance signal.)
  - `admin/page.tsx`: add `presenceLabel` to the existing import from `@/lib/owner/format` (`:27`, currently `presenceDotClass, formatDuration`). In the team-on-now row (`:351-360`), add the presence text after the name so AWAY/BREAK/OFFLINE (which share dot colors) are distinguishable. Mirror the fleet-board's treatment (`fleet-board.tsx:73-75`): a small muted label. Concretely, inside the `<span className="inline-flex items-center gap-2 text-foreground">…{agent.full_name}</span>`, append a sibling after the name:

    ```tsx
    <span className="text-xs font-normal text-text-muted">· {presenceLabel(effective)}</span>
    ```
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): label color-only status signals (status page + team-on-now)`.

> Team-on-now lives in an async server component with no unit harness, so its verification is the live smoke (per the jsdom-limits constraint). `presenceLabel` itself is already unit-tested (pure helper).

## Task 8: Owner bottom-nav — active region fill + 44px targets + safe-area

`OwnerBottomNav` (`owner-nav.tsx:41-64`): the active tab is teal text only (color-alone — the desktop nav uses a `bg-accent/10` fill), and the fixed bar has no notch safe-area and no explicit touch-target floor.

**Files:**
- Modify: `apps/portal/components/owner/owner-nav.tsx:41-64`
- Test: `apps/portal/tests/components/owner-nav.test.tsx` (new — mock `usePathname`)

- [ ] **Step 1 — Write the failing test.** New file `tests/components/owner-nav.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OwnerBottomNav } from "@/components/owner/owner-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/owner" }));

afterEach(() => cleanup());

describe("OwnerBottomNav", () => {
  it("gives the active tab a non-color region fill, and each tab a 44px target", () => {
    render(<OwnerBottomNav />);
    const home = screen.getByRole("link", { name: /home/i });
    const calls = screen.getByRole("link", { name: /calls/i });
    expect(home.className).toContain("bg-accent/10"); // active fill (Home is active)
    expect(calls.className).not.toContain("bg-accent/10"); // inactive: no fill
    expect(home.className).toContain("min-h-[44px]");
  });

  it("the bar reserves the bottom safe-area inset", () => {
    render(<OwnerBottomNav />);
    expect(screen.getByRole("navigation").className).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
```

- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.** In `OwnerBottomNav`:
  - Add `pb-[env(safe-area-inset-bottom)]` to the `<nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card md:hidden">`.
  - On each tab `<Link>`, add `min-h-[44px] justify-center` and give the active state the region fill: change the active branch from `"text-accent-text"` to `"bg-accent/10 text-accent-text"` (leave the inactive branch `"text-text-muted hover:text-foreground"`). `aria-current="page"` is already set — keep it.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** Commit: `fix(a11y): owner bottom-nav active fill, 44px targets, safe-area`.

> The bottom nav is `fixed`; the safe-area padding only grows it on notched devices. Confirm at the smoke that no owner page content hides behind the taller bar (the pages already pad for the fixed nav; the extra inset is small).

## Task 9: Reduced-motion FloatingPaths render full static lines (portal + kiosk)

Both `FloatingPaths` copies, under `prefers-reduced-motion`, set `animate`/`transition` to `undefined` and leave the path at its `initial` `pathLength: 0.3` — a 30%-drawn stub. Extract a pure `pathMotion` helper (per app — the kiosk is a separate build graph) that returns full-length (`pathLength: 1`) static props when reduced, and unit-test it.

**Files:**
- Create: `apps/portal/lib/brand/path-motion.ts`
- Create: `apps/portal/tests/lib/brand/path-motion.test.ts`
- Modify: `apps/portal/components/brand/floating-paths.tsx` (use the helper)
- Create: `apps/kiosk/src/lib/path-motion.ts`
- Create: `apps/kiosk/src/lib/path-motion.test.ts` (kiosk tests are co-located `*.test.ts` — mirror an existing one under `apps/kiosk/src/`)
- Modify: `apps/kiosk/src/components/floating-paths.tsx` (use the helper)

- [ ] **Step 1 — Write the failing test.** `apps/portal/tests/lib/brand/path-motion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pathMotion } from "@/lib/brand/path-motion";

describe("pathMotion", () => {
  it("reduced motion → a full static line, no animation", () => {
    const m = pathMotion(true, 25);
    expect(m.initial).toEqual({ pathLength: 1, opacity: 0.6 });
    expect(m.animate).toBeUndefined();
    expect(m.transition).toBeUndefined();
  });

  it("full motion → the drifting animation with the given duration", () => {
    const m = pathMotion(false, 25);
    expect(m.initial).toEqual({ pathLength: 0.3, opacity: 0.6 });
    expect(m.animate).toEqual({ pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] });
    expect(m.transition).toEqual({ duration: 25, repeat: Number.POSITIVE_INFINITY, ease: "linear" });
  });
});
```

  Mirror the same test in `apps/kiosk/src/lib/path-motion.test.ts` (relative import `./path-motion`).
- [ ] **Step 2 — Run them, verify they fail.** `pnpm -F @lc/portal test path-motion` and `pnpm -F @lc/kiosk test path-motion` → FAIL (module missing).
- [ ] **Step 3 — Implement.** Create both helpers (identical body):

```ts
// The motion props for one connection-line stroke. Reduced motion draws the
// FULL static line (pathLength 1) rather than the animated seed's 30% stub, so
// prefers-reduced-motion still shows complete lines, not fragments.
export function pathMotion(reduceMotion: boolean, animatedDuration: number) {
  if (reduceMotion) {
    return { initial: { pathLength: 1, opacity: 0.6 }, animate: undefined, transition: undefined } as const;
  }
  return {
    initial: { pathLength: 0.3, opacity: 0.6 },
    animate: { pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] },
    transition: { duration: animatedDuration, repeat: Number.POSITIVE_INFINITY, ease: "linear" as const },
  };
}
```

  Then in each `floating-paths.tsx`, inside `paths.map`, replace the inline `initial`/`animate`/`transition` props with the helper. Portal keeps its duration `20 + (path.id % 10)`; kiosk keeps `40 + (path.id % 16)`:

```tsx
// portal
const anim = pathMotion(!!reduceMotion, 20 + (path.id % 10));
// kiosk
const anim = pathMotion(!!reduceMotion, 40 + (path.id % 16));
// both:
<motion.path
  key={path.id}
  d={path.d}
  stroke="currentColor"
  strokeWidth={path.width}
  strokeOpacity={0.1 + path.id * 0.03}
  initial={anim.initial}
  animate={anim.animate}
  transition={anim.transition}
/>
```

  The non-reduced branch returns byte-equivalent objects to today's inline literals, so animated behavior is unchanged; only the reduced branch changes (0.3 → 1).
- [ ] **Step 4 — Run them, verify they pass.**
- [ ] **Step 5 — Full gate + commit.** Portal + kiosk gates (`pnpm -F @lc/kiosk test build` too). Commit: `fix(a11y): reduced-motion connection lines render full static (portal + kiosk)`.

---

## Live-verify gate (before calling Batch 2 done)

Deploy the branch and confirm on the real build (jsdom cannot):

1. **Keyboard focus** — Tab through: sign-in submit, a dialog/sheet close, the password show/hide, an owner CallRow/IncidentRow, a dashboard recent-call expand, the softphone Go-on-duty ring + Accepting toggle, and — in a live call — the audio 911 button and the tile's Mute/Camera/Chat/Captions/End/911. Every one shows a visible ring only on keyboard focus (not on mouse click). The tile ring is cream-on-navy; the light ones are the brand navy ring.
2. **Color-alone** — the admin **Status** page shows OK/Degraded/Down words; **Team on now** shows Available/Away/On break/Offline text (AWAY vs BREAK now distinguishable); the owner bottom-nav active tab shows a filled pill, not just teal text.
3. **Touch/safe-area** — on a notched phone (or emulated), the owner bottom nav sits above the home indicator and each tab is a comfortable target; no page content is hidden behind it.
4. **Reduced motion** — with OS "reduce motion" on, the sign-in and kiosk connection lines render as full, still lines (not short fragments), and do not animate.

Only after this smoke passes is Batch 2 complete. Ship via branch → PR → wait CI green → hand to Kumar to smoke (do not self-merge to `main` — merging auto-deploys prod).

## Self-review

- **Spec coverage:** Focus rings — Task 1 (tile 911/Mute/Camera/Chat/Captions/End), Task 2 (audio 911 + CaptionToggle), Task 3 (password toggle + dialog/sheet close), Task 4 (softphone Go-on-duty + Accepting), Task 5 (CallRow/RecentCallRow/IncidentRow), Task 6 (auth submits) — covers every control the audit Theme E names. Controls already on the shared `Button` (`CallToggleButton`, `EndCallButton`, `PropertyActionButton`, `StatTile`/`DashTile` links, onboarding submit) already have the ring and are correctly excluded. Color-alone (Theme D, Batch-2 subset) — Task 7 (status page + team-on-now) + Task 8 (owner bottom-nav). Touch targets/safe-area — Task 8. Reduced-motion FloatingPaths — Task 9. All four scope items covered.
- **Type/string consistency:** the three ring recipes are defined once above and pasted verbatim into both the tests and the implementations (LIGHT `ring-ring`/`ring-offset-background`, DARK `ring-primary-foreground`/`ring-offset-primary`, INSET `ring-inset`/`ring-ring`). `pathMotion(reduceMotion, animatedDuration)` has the same signature in the portal and kiosk helpers and both call-sites.
- **No placeholders:** every task names exact files + line anchors and the exact current className string being appended to; tests reusing a heavy existing harness (call-tile, softphone) say so explicitly and give the precise assertion rather than rebuilding the harness.
- **Regression guards:** no task touches the 911 handlers, notes handlers, `handleConnect`, or `softphone.tsx:587` — only className strings and one added label/helper. Task 4 explicitly leaves the notes Retry/Discard buttons alone.
