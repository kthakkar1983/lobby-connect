# UI/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the whole-app UI/UX audit fixes as five sequenced batches, starting with button consistency, each live-verified on the deployed build before the next begins.

**Architecture:** Batch-by-batch, each an independent testable unit. The spec is [`docs/audits/2026-07-20-whole-app-uiux-audit.md`](../audits/2026-07-20-whole-app-uiux-audit.md) + [`docs/brand/ui-copy-guide.md`](../brand/ui-copy-guide.md) + the locked decisions below. This plan details **Batch 1** in full; Batches 2–5 are scoped here and get their own plans just-in-time (each depends on the prior, so writing their exact code now would only be reworked).

**Tech Stack:** Next.js App Router (portal) + Vite (kiosk), Tailwind v4 tokens, shadcn primitives, Vitest + Testing Library (jsdom).

---

## Locked decisions (the spec)

**Six director decisions (approved 2026-07-21):**
1. Em dashes in user-facing copy → purge to periods/colons (the null-`—` cell placeholder is exempt).
2. Side-stripe status borders → lift the absolute ban for that one status-edge pattern only; keep it banned elsewhere.
3. Raleway headings → enforce `font-display` + weight ≥500 on title slots.
4. Dashboard right column → sticky operator-status rail.
5. Incident color → one tint, keep the red 911 chip, drop the duplicate blaze siren.
6. In-call End-call isolation → standardize on the 1px divider.

**Two copy decisions:**
- Terminology → **"Property"** everywhere (guest still sees the property's real name).
- **Phone-health tile + `/admin/phone-health` page removed** (fires only on FAILED calls, already visible under Calls › Failed); the three remaining admin pulse tiles expand to fill the row.

## The five-batch sequence

1. **Button consistency (THIS PLAN)** — icon-to-label size, equal-width pairs, in-call toggle widths, the kiosk control bar. *Fixes both of Kumar's stated complaints at the source.*
2. **Accessibility** — focus rings on every hand-rolled control (incl. both 911 buttons), color-alone status → labels (team-on-now, status page, owner bottom-nav), owner sub-44px touch targets + notch safe-area, reduced-motion FloatingPaths stubs.
3. **Dashboard layout** — the sticky operator rail, the visible Covering label, the Phone-health removal (3 tiles expand), optional header-band strip.
4. **Copy** — the `impeccable clarify` pass against the new guide (kill the manual-speak / state-narration class first) + the 4 factual fixes (Capped 12h→10h, forgot-password, kiosk recording note, users-table enums).
5. **Consolidation + housekeeping** — Toggle/Tabs/StatusBadge primitives + migration, CRUD-shape/container/radius unification, nested cards, dead code (line-beacon/greeting-line/CallControlTray), the 16 `" 2.tsx"` dupes.

## Constraints (ALL batches)

- **Zero migrations / API routes / RLS** unless a batch explicitly says otherwise. Batch 1 touches none.
- **jsdom has NO layout engine.** Tests assert class names and attributes; they can prove a class is applied, never that pixels line up. The REAL verification is the live prod smoke (the gate at the end of each visual batch). Never call a visual fix "verified" from jsdom alone — this is the standing house lesson.
- **Do not touch the regression guards.** The 911 machinery, the notes handlers, `handleConnect`, and the `softphone.tsx:587` accept-gate stay byte-identical. If a task's diff would touch them, stop and flag.
- **Widths and icon sizes in Tailwind scale (rem), never px** — the portal root font scales to 112.5% at `lg`, so a px value silently stops matching `text-sm` at the breakpoint where agents work.
- **Gate commands (run per task):** `pnpm -F @lc/portal test`, `pnpm -F @lc/portal typecheck`, `pnpm lint`, `pnpm -F @lc/portal build`, `pnpm check:routes`; kiosk tasks also `pnpm -F @lc/kiosk test` + `build`. All green before commit.
- **Scope note (flagged deviation from the audit's "Batch 1"):** Batch 1 applies equal-width **directly** at the two flagged call-sites rather than building a `ButtonGroup` primitive (YAGNI — the primitive is a consolidation nicety deferred to Batch 5 if the pattern recurs). The `Toggle`/`Tabs`/`StatusBadge` primitives the audit bundled into "spine completion" also move to Batch 5; Batch 1 is scoped to what fixes the reported complaints and is live-verifiable in one pass.

---

## Batch 1 — Button consistency

Root causes (from the audit, code-confirmed): the base `Button` renders an 18px icon (`size-4` at the 112.5% root) beside a ~15.75px `text-sm` label, and the `sm`/`default` sizes don't correct it ([button.tsx:8,30,32](../../apps/portal/components/ui/button.tsx)); adjacent buttons size to their own text; the in-call toggles are fixed but to *different* widths (`w-28` vs `w-36`); and the kiosk bar is `items-end` with labels that change width on toggle.

### Task 1: Match the button icon size to its label

**Files:**
- Modify: `apps/portal/components/ui/button.tsx:30,32` (the `default` and `sm` size variants)
- Test: `apps/portal/tests/components/button-icon-size.test.tsx` (new)

- [ ] **Step 1 — Write the failing test.** A rendered `sm`/`default` button with an icon carries the label-matched icon size (`size-3.5` = 0.875rem = text-sm), and `cn`'s twMerge has dropped the base `size-4` override.

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "@/components/ui/button";

afterEach(() => cleanup());

describe("Button icon size matches its text label", () => {
  it.each(["sm", "default"] as const)("size=%s renders a 14px (size-3.5) icon, not the 18px base", (size) => {
    render(<Button size={size}><svg data-testid="i" />Label</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("[&_svg:not([class*='size-'])]:size-3.5");
    // twMerge (applied by cn() in Button) must keep only the variant size, dropping the base.
    expect(cls).not.toContain("[&_svg:not([class*='size-'])]:size-4");
  });
});
```

- [ ] **Step 2 — Run it, verify it fails.** `pnpm -F @lc/portal test button-icon-size` → FAIL (size-4 still present).

- [ ] **Step 3 — Implement.** Append the icon-size override to both size variants in `button.tsx`:
  - `sm`: `"h-8 gap-1.5 px-3 has-[>svg]:px-2.5"` → add ` [&_svg:not([class*='size-'])]:size-3.5`
  - `default`: `"h-9 px-4 py-2 has-[>svg]:px-3"` → add ` [&_svg:not([class*='size-'])]:size-3.5`

  Leave the base `size-4` (it still serves the icon-only `icon*` sizes and `lg`), leave `xs` at `size-3`. The base `size-4` and the variant `size-3.5` share the same arbitrary-variant modifier + `size` group, so twMerge in `cn()` keeps the later (variant) one — that's what Step 1 asserts.

- [ ] **Step 4 — Run it, verify it passes.** `pnpm -F @lc/portal test button-icon-size` → PASS.
- [ ] **Step 5 — Full gate + commit.** `pnpm -F @lc/portal test typecheck build && pnpm lint`. Commit: `fix(ui): size button icons to match the text label (sm/default)`.

> **Live-smoke note:** this changes the leading icon on **every** `sm`/`default` button app-wide (Answer, Connect, Kiosk, Break, End shift, New property, in-call Mute/Camera/End). Confirm at the gate that no icon now reads too small; `lg` is deliberately left at the 16px base.

### Task 2: Equal-width the property-card Connect / Kiosk pair

The default `connectSlot` renders `<ConnectButton>` + `<KioskCallButton>` in a plain `flex … gap-2` row ([pod-card-grid.tsx:134-141](../../apps/portal/components/dashboard/pod-card-grid.tsx)), so each sizes to its own text (Connect 106px, Kiosk 85px). Make the pair share a two-column track and fill it.

**Files:**
- Modify: `apps/portal/components/dashboard/pod-card-grid.tsx:134-141` (the pair container)
- Modify: `apps/portal/components/dashboard/connect-button.tsx` + `apps/portal/components/dashboard/kiosk-call-button.tsx` (forward `className` to the underlying `PropertyActionButton` if they don't already — read them first)
- Modify: `apps/portal/components/dashboard/fleet-board.tsx` (if its `connectFor` renders the same pair, apply the identical change — read it first)
- Test: `apps/portal/tests/components/pod-card-grid.test.tsx` (extend, or add if absent)

- [ ] **Step 1 — Write the failing test.** In a rendered pod grid, the Connect and Kiosk buttons both carry `w-full`, and their shared container is a 2-col grid (so they render equal width). Query by accessible name; assert `className` contains `w-full` on both and the container is `grid-cols-2`.
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.** Container `<div className="flex items-center gap-2">` → `<div className="grid grid-cols-2 gap-2">`. Pass `className="w-full justify-center"` to both `<ConnectButton>` and `<KioskCallButton>`, plumbing a `className` prop through to their `PropertyActionButton` (`className` merges last onto the Button; the existing `whitespace-nowrap`/gated-fill logic is preserved). Apply the same to `fleet-board.tsx`'s pair if present.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** `fix(dashboard): equal-width Connect/Kiosk on property cards`.

> The reserved ringing-row height and bottom-anchoring in `property-card.tsx` are untouched — this only changes the action row's internal track.

### Task 3: Unify the in-call toggle widths and the captions icon

`CallToggleButton` hardcodes `w-28` (112px) ([call-controls.tsx:198](../../apps/portal/components/call/call-controls.tsx)); the labelled `CaptionToggle` is passed `w-36` (144px) at the overlay call-sites; and its labelled icon is a fixed `size={16}` ([caption-toggle.tsx:68](../../apps/portal/components/call/caption-toggle.tsx)) which will now be larger than the 14px Task-1 icons beside it. Make the three side-by-side toggles one width and one icon size.

**Files:**
- Modify: `apps/portal/components/call/call-controls.tsx:198` (`w-28` → `w-36`)
- Modify: `apps/portal/components/call/caption-toggle.tsx:68` (labelled icon `size={16}` → `size={14}`; compact stays `13`)
- Modify: the overlay Captions call-sites so the width matches (read `apps/portal/components/softphone/audio-call-overlay.tsx` + `apps/portal/components/video-call/video-call.tsx`; if they pass `w-36` it already matches the new `CallToggleButton` width — confirm, don't duplicate a different value)
- Test: `apps/portal/tests/components/call-controls.test.tsx` (extend) + `apps/portal/tests/components/caption-toggle.test.tsx` (extend/add)

- [ ] **Step 1 — Write the failing test.** `CallToggleButton` renders with the unified width class (`w-36`); `CaptionToggle` (labelled) renders its icon at 14px.
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement** the three edits above. Keep the width in Tailwind scale (`w-36`), never px, per the file's own rem rule.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** `fix(call): unify in-call toggle widths and captions icon size`.

> Do not touch `EndCallButton` (content-width, constant label — intentional) or the 911 button. `call-controls.test.tsx`'s reflow/`aria-pressed` assertions must stay green.

### Task 4: Stop the kiosk control bar from reflowing and bottom-aligning

The kiosk bar is `items-end` and each `Ctrl`'s label is free-width, so `Mute`→`Unmute` / `Camera off`→`Camera on` change the label width and shove the row mid-call ([CallControls.tsx:30,55](../../apps/kiosk/src/screens/CallControls.tsx)).

**Files:**
- Modify: `apps/kiosk/src/screens/CallControls.tsx:30,55`
- Test: `apps/kiosk/src/screens/CallControls.test.tsx` (add/extend — check `apps/kiosk` test setup and mirror it)

- [ ] **Step 1 — Write the failing test.** Toggling `muted`/`cameraOff` does not change the control's label-column width (assert a fixed-width class on the label span), and the bar is center-aligned (`items-center`, not `items-end`).
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Implement.** Bar `items-end` → `items-center` (line 55). Give the label span a fixed centered column so a label swap can't reflow: `text-[11px] font-medium text-white/80` → add `w-16 text-center` (line 30). Verify "Camera off"/"Camera on" fit at `w-16`; widen to `w-20` if the test/preview shows truncation.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** `pnpm -F @lc/kiosk test build`. Commit: `fix(kiosk): fix control-bar reflow and vertical alignment`.

### Live-verify gate (before Batch 2)

Deploy the branch and confirm on the real build (jsdom can't): icons no longer out-size their labels; Connect/Kiosk are equal width on the property cards; the three in-call toggles are one width with matching icons; the kiosk bar doesn't jump when muting/cutting camera. This is the moment to confirm Kumar's original two complaints are resolved and to eyeball `lg` buttons + `default`-size icons. Only then start Batch 2.

---

## Batches 2–5 (scope only — detailed into their own plans just-in-time)

- **Batch 2 — Accessibility.** Add `focus-visible:ring-2 ring-ring` to hand-rolled controls incl. both 911 buttons (`audio-call-overlay.tsx:189`, `call-tile.tsx:229`), tile controls, `CaptionToggle`, softphone Accepting/Go-on-duty, auth submit buttons, owner row/card links, recent-call expand, password toggle; `focus:`→`focus-visible:` on dialog/sheet close. Add text/`sr-only` state to color-only signals (team-on-now presence, status page, owner bottom-nav active). Owner: min-44px touch targets + `env(safe-area-inset-bottom)` on the bottom nav. Fix the reduced-motion FloatingPaths (render full static lines, not 30% stubs) in both apps.
- **Batch 3 — Dashboard layout.** `lg:self-start lg:sticky lg:top-6` on the workspace aside; visible "Covering" label on the fleet cards; remove the Phone-health tile + `/admin/phone-health` page + `lib/dashboard/phone-health.ts` (+ tests) and expand the three remaining pulse tiles; optional compact status strip in the header band.
- **Batch 4 — Copy.** Run `impeccable clarify` against `ui-copy-guide.md`, leading with the manual-speak/state-narration class (softphone idle, the Covering line, "Your line is offline", empty-state narration), centralizing strings into `lib/copy.ts` + the kiosk mirror; purge em dashes; unify terminology to "Property"; factual fixes (Capped 12h→10h, forgot-password reword, kiosk recording note, users-table enum humanization).
- **Batch 5 — Consolidation + housekeeping.** `Toggle`/`Tabs`/`StatusBadge` primitives + migrate the hand-rolled toggles/tabs/pills; unify CRUD shapes + container/radius conventions; flatten nested cards; delete dead code (line-beacon, greeting-line, CallControlTray); `git clean` the 16 `" 2.tsx"` dupes; `ButtonGroup` primitive if the equal-width pattern has recurred.

---

## Self-review (Batch 1)

- **Spec coverage:** Batch 1 covers audit Themes A (equal-width, partial) + B (icon size, in-call/kiosk alignment) — the two reported complaints. Themes C–H are Batches 2–5.
- **Type consistency:** the icon-size class string `[&_svg:not([class*='size-'])]:size-3.5` is identical in the test and the implementation; width `w-36` is the single unified value across `CallToggleButton` and the overlay call-sites.
- **No placeholders:** call-site tasks (2, 3) name the exact files and note the one adjacent read each needs (ConnectButton/KioskCallButton className forwarding; the overlay Captions width) rather than guessing internals the executing subagent will read.
