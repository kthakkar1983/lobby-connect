# UI/UX Polish — Batch 3 (Dashboard layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the dashboard-layout tranche of the whole-app UI/UX audit — the sticky operator rail (the locked resolution to the twice-failed right-column), a visible "Covering" label on the fleet toggle, and removal of the Phone-health tile + page + lib.

**Architecture:** Small, mostly-mechanical changes. The sticky rail is a **layout** change in an area that has failed two blind attempts, so it is minimal-by-design (3 utility classes, moves no content, cannot overshoot) and its real proof is Kumar's live smoke. Zero migrations / API routes / RLS / call-logic. Batch 3 of the five-batch plan (`docs/plans/2026-07-21-uiux-polish.md`); spec = audit "The dashboard right column" section + Themes A/H (Covering label; Phone-health removal) in `docs/audits/2026-07-20-whole-app-uiux-audit.md`.

**Tech Stack:** Next.js App Router (portal), Tailwind v4 tokens, Vitest + Testing Library (jsdom).

---

## Locked decisions (do NOT relitigate — approved by Kumar in the Batch-1 director review 2026-07-21)

1. **Dashboard right column → sticky operator rail** (`lg:self-start lg:sticky lg:top-6` on the aside). This is categorically different from the two failed attempts (`mt-auto` stretch → clocks shoved to page bottom; natural stack → clocks trail wrong): sticky depends on NOTHING in the left column's height, so it cannot overshoot. The rail follows the scroll (softphone / shift clock stay on screen as the admin scrolls the fleet board); the residual top whitespace reads as intentional (GitHub/Gmail right-rail). It does NOT pixel-align tiles to the left column — that framing is retired.
2. **Phone-health tile + `/admin/phone-health` page removed** — it fires only on FAILED calls (already visible under Calls › Failed), and its "orange" overclaims. The three remaining admin pulse tiles expand to fill the row.
3. Visible **"Covering"** label on the fleet-board toggle.

## Constraints (ALL tasks)

- **Zero migrations / API routes / RLS / call-logic.**
- **Do NOT touch the regression guards** (911 machinery, notes handlers, `handleConnect`, softphone accept-gate). None are in this batch's files, but the sticky-rail edit lives in `dashboard-workspace.tsx` which mounts the softphone — touch ONLY the aside's className + its comment.
- **The right-column layout has failed twice on blind guesses.** Task 3 is deliberately the minimal locked change and MUST be verified live by Kumar before the batch is called done. Do NOT get creative: do NOT re-add `items-stretch` / `h-full` / `mt-auto`, do NOT restructure the aside, do NOT move the clocks. The existing "no overshoot" guard test must stay green.
- **Edit the REAL files, never a `" 2.tsx"` byte-copy.**
- **jsdom has no layout engine** — a test can prove the sticky classes are applied, never that the scroll behavior looks right. The live smoke is the real gate.
- **Per-task gates (all green before commit):** `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>` (component tests) or `pnpm --filter @lc/portal exec vitest run <substr>` (lib tests) · `pnpm -F @lc/portal typecheck` · `pnpm -F @lc/portal exec eslint <changed files>` · `pnpm check:routes` (ROOT — Task 1 deletes a route, so this MUST pass). The controller runs the full `pnpm -F @lc/portal build` once before the PR.
- **Tooling facts (from Batch 2):** `@testing-library/jest-dom` is NOT installed — use `getByText(...)`/`getByRole(...)` + `.toBeTruthy()`, never `.toBeInTheDocument()`.

---

## Task 1: Remove the Phone-health tile, page, and lib

`lib/dashboard/phone-health.ts` (`phoneHealthRollup` + `failureSummaryToday`) is consumed ONLY by the admin overview tile (`admin/page.tsx`) and the `/admin/phone-health` route — both being removed — plus its own test. `lib/dashboard/calls.ts` only *mentions* it in a comment (no code dependency).

**Files:**
- Delete: `apps/portal/app/(admin)/admin/phone-health/page.tsx` and `apps/portal/app/(admin)/admin/phone-health/loading.tsx` (the whole directory)
- Delete: `apps/portal/lib/dashboard/phone-health.ts`
- Delete: `apps/portal/tests/dashboard/phone-health.test.ts`
- Modify: `apps/portal/app/(admin)/admin/page.tsx` (drop the import, the health computation, the tile; expand the pulse row)
- Modify (optional, stale comment): `apps/portal/lib/dashboard/calls.ts:133` (the phrase "surfaced on phone-health" — reword to "surfaced under Calls › Failed" or drop the clause)

- [ ] **Step 1 — Confirm no other importers.** Run:
  `grep -rn "phone-health\|phoneHealth\|failureSummaryToday\|/admin/phone-health" apps/portal/app apps/portal/components apps/portal/lib apps/portal/tests`
  Expect hits ONLY in: `admin/page.tsx` (import + `phoneHealthRollup` + tile href), `admin/phone-health/*` (the route being deleted), `lib/dashboard/phone-health.ts` (itself), `lib/dashboard/calls.ts` (comment only), `tests/dashboard/phone-health.test.ts` (being deleted). If any OTHER file imports it, STOP and report.
- [ ] **Step 2 — Delete the files.** Remove the `phone-health/` route dir, `lib/dashboard/phone-health.ts`, and `tests/dashboard/phone-health.test.ts` (`git rm`).
- [ ] **Step 3 — Edit `admin/page.tsx`:**
  - Remove the import `import { phoneHealthRollup } from "@/lib/dashboard/phone-health";` (line ~25).
  - Remove the health block (lines ~175-194): the `// Phone health:` comment, `const health = phoneHealthRollup(...)`, and `const healthTile = ...`.
  - Remove the Phone-health `<DashTile>` (lines ~263-269, the one with `label="Phone health"` / `href="/admin/phone-health"`).
  - Change the pulse-row grid (line ~249) from `grid grid-cols-2 gap-3 lg:grid-cols-4` to `grid grid-cols-2 gap-3 lg:grid-cols-3` so the three remaining tiles (Live calls · Agents online · Open incidents) fill the row.
  - Reword the stale comment in `lib/dashboard/calls.ts:133` if trivially clear (optional; skip if unsure).
- [ ] **Step 4 — Verify.** No new test to write (this is a removal; the deleted `phone-health.test.ts` is expected to be gone). Confirm:
  - `pnpm -F @lc/portal typecheck` clean (no dangling import/type).
  - `pnpm check:routes` → "Route casts OK." (the `/admin/phone-health` href is gone with the tile, so no dead link).
  - `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts admin` and `pnpm --filter @lc/portal exec vitest run dashboard` stay green (nothing references the deleted module).
  - `grep -rn "phone-health\|phoneHealth" apps/portal/app apps/portal/components apps/portal/lib apps/portal/tests` → only the (optional) `calls.ts` comment remains, if you left it.
- [ ] **Step 5 — eslint + commit.** `pnpm -F @lc/portal exec eslint "app/(admin)/admin/page.tsx" lib/dashboard/calls.ts`. Commit: `refactor(admin): remove the Phone-health tile, page, and rollup`.

## Task 2: Visible "Covering" label on the fleet-board toggle

`AvailabilityToggle` (`app/(admin)/admin/availability-cards.tsx`) renders a bare `<Switch>` — an admin sees an unlabeled toggle in each fleet card's footer. It is used ONLY by `fleet-board.tsx`'s `footerFor` (the Covering toggle). Add a visible "Covering" label and make the accessible name lead with it (WCAG 2.5.3).

**Files:**
- Modify: `apps/portal/app/(admin)/admin/availability-cards.tsx`
- Test: `apps/portal/tests/components/availability-toggle.test.tsx` (new)

- [ ] **Step 1 — Write the failing test.** New file `tests/components/availability-toggle.test.tsx`. Mock the server-action module so importing the client component doesn't pull server-only code (mirror how `tests/components/auth-submit-ring.test.tsx` mocks its action, and how `fleet-board`/other tests mock `sonner`):
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(admin)/admin/properties/actions", () => ({
  setCallAvailabilityAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AvailabilityToggle } from "@/app/(admin)/admin/availability-cards";

afterEach(() => cleanup());

describe("AvailabilityToggle", () => {
  it("shows a visible Covering label and an accessible switch", () => {
    render(<AvailabilityToggle propertyId="p1" propertyName="The Sample Hotel" initial={false} />);
    expect(screen.getByText("Covering")).toBeTruthy();
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-label") ?? "").toMatch(/covering/i);
  });
});
```
  (Confirm the action import path in `availability-cards.tsx` — it imports `setCallAvailabilityAction` from `./properties/actions`; the mock target must resolve to that same module, i.e. `@/app/(admin)/admin/properties/actions`. If the alias doesn't resolve the route group in a mock, use the path the file itself imports.)
- [ ] **Step 2 — Run it, verify it FAILS.**
- [ ] **Step 3 — Implement.** Change the returned JSX from a bare `<Switch>` to a labeled row. Keep all the toggle logic (`on`/`toggle`/`startTransition`) byte-identical:
```tsx
return (
  <div className="flex items-center justify-between gap-2">
    <span className="text-sm font-medium text-foreground">Covering</span>
    <Switch
      checked={on}
      onCheckedChange={toggle}
      aria-label={`Covering — ${propertyName}`}
    />
  </div>
);
```
  (Visible "Covering" is the label; the accessible name leads with it — WCAG 2.5.3 — while keeping the property context. The fleet-board footer already wraps this in a bordered `mt-3 … pt-3` container, so the row sits cleanly.)
- [ ] **Step 4 — Run it, verify it PASSES.**
- [ ] **Step 5 — Gate + commit.** `pnpm -F @lc/portal typecheck` · eslint the two files · `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts availability-toggle`. Commit: `feat(admin): label the fleet Covering toggle`.

> Do not change how `initial`/`toggle` work — only the surrounding markup + the aria-label wording.

## Task 3: Sticky operator rail (the locked column resolution) — LIVE-VERIFY REQUIRED

The dashboard aside is `Softphone → Shift → Clocks (+ headless VideoCallHost)` in `dashboard-workspace.tsx`, inside a grid `lg:grid-cols-[minmax(0,1fr)_340px]` that already sets `items-start`. Make the aside sticky so it follows the scroll. This is the minimal locked change — **do not** re-add `items-stretch`/`h-full`/`mt-auto` or restructure anything.

**Files:**
- Modify: `apps/portal/components/dashboard-workspace.tsx` (the `<aside>` className + its comment)
- Test: `apps/portal/tests/components/dashboard-workspace.test.tsx` (extend — a sticky-class assertion; the existing "no overshoot" guard stays as-is and must remain green)

- [ ] **Step 1 — Write the failing test.** In `dashboard-workspace.test.tsx`, add a test in the "the right column" describe block:
```tsx
it("makes the aside a sticky operator rail on lg (follows the scroll, cannot overshoot)", () => {
  const { container } = renderWorkspace();
  const aside = asideOf(container);
  expect(aside.className).toContain("lg:sticky");
  expect(aside.className).toContain("lg:top-6");
  expect(aside.className).toContain("lg:self-start");
});
```
- [ ] **Step 2 — Run it, verify it FAILS.**
- [ ] **Step 3 — Implement.** In `dashboard-workspace.tsx`, change the aside className:
  `className={onHome ? "flex flex-col gap-3" : "hidden"}`
  →
  `className={onHome ? "flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start" : "hidden"}`
  Update the adjacent comment: replace the "Clocks trail directly under the shift card (natural stack)… Do NOT re-add items-stretch / h-full / mt-auto" note so it reads that the aside is now a **sticky operator rail** — the internal stack is still natural (clocks trail the shift card), and the sticky/`self-start` makes the whole rail follow the scroll on `lg` (softphone + live shift clock stay on screen as the fleet board scrolls), with the top whitespace intentional. Keep the "do NOT re-add items-stretch / h-full / mt-auto" warning — those remain wrong.
- [ ] **Step 4 — Run the whole file, verify PASS.** The new sticky test passes AND the existing "no overshoot" guard (asserts no `items-stretch`/`h-full`/`mt-auto`) stays green — sticky/`self-start`/`top-6` are none of those, so there's no conflict.
- [ ] **Step 5 — Gate + commit.** `pnpm -F @lc/portal typecheck` · eslint the two files · `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts dashboard-workspace`. Commit: `fix(dashboard): make the operator aside a sticky rail`.

> **LIVE-VERIFY (Kumar, at the smoke):** scroll the admin (and agent) dashboard home — the right rail (softphone / shift / clocks) should stay on screen as the fleet board scrolls past, and the top whitespace should read as an intentional right-rail, not dead space. This is the third approach to this column; if it still doesn't feel right, that's a separate column-redesign conversation (`[[dashboard-layout-rework-deferred]]`), not another blind tweak.

---

## Live-verify gate (before Batch 3 is done)
1. **Sticky rail:** admin + agent dashboard home — the operator rail follows the scroll; no overshoot; top whitespace reads intentional.
2. **Covering label:** each admin fleet card footer shows a "Covering" label beside its toggle.
3. **Phone-health gone:** the admin pulse row shows three evenly-filled tiles (Live calls · Agents online · Open incidents), no "Phone health" tile; navigating to `/admin/phone-health` 404s.

Ship via branch → PR → CI green → Kumar smokes (do NOT self-merge; merge auto-deploys prod).

## Self-review
- **Spec coverage:** sticky rail (Task 3), Covering label (Task 2), Phone-health removal + 3-tile expand (Task 1) — the three locked decisions. No scope bleed into other batches (no copy/em-dash, no primitive extraction, no side-stripe).
- **Regression guards:** Task 3 touches `dashboard-workspace.tsx` but only the aside className/comment — the softphone/video-host mounting and all call logic are untouched. Tasks 1–2 touch none.
- **No placeholders:** exact files, line anchors, the exact className change, and the removal's importer-check are all spelled out.
