# UI/UX Polish Batch 5a — Housekeeping & Dead Code · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the three confirmed-dead code paths (the write-only `LineStatus` beacon feature, the never-rendered `GreetingLine`, the unused `CallControlTray`) and clear the 16 untracked `" 2"` duplicate files, with every existing test, typecheck, build, and lint staying green.

**Architecture:** Pure removals — no new behavior, nothing user-facing changes. Because nothing here is visible, the verification is the *existing* suite + typecheck + build + lint + check:routes staying green (there is no new red→green test to write; a deletion's "test" is that everything else still passes). Each task is independently revertable. This is the first, lowest-risk slice of Batch 5; it lands first because it also clears the `" 2.tsx"` → `.next/types/* 2.ts` gotcha that otherwise bites every later typecheck/build in 5b/5c.

**Tech Stack:** Next.js App Router (portal), Tailwind v4, Vitest + Testing Library (jsdom).

**Grounding:** the 2026-07-24 dead-code sweep (evidence cross-checked, read-only); audit `docs/audits/2026-07-20-whole-app-uiux-audit.md` (Theme H — "Dead code to remove"); parent plan `docs/plans/2026-07-21-uiux-polish.md` (Batch 5).

---

## Constraints (inherited from the parent plan — all batches)

- **Zero migrations / API routes / RLS.**
- **Do not touch the regression guards** — the 911 machinery, the notes handlers, `handleConnect`, and the `softphone.tsx:587` accept-gate stay byte-identical. Task 3 edits `softphone.tsx` but ONLY removes the dead `useLineStatus` import (line 14) and the phase-report effect (lines 277–281), none of which is a guard.
- **Gate (run green before each commit):** `pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes`.
- **`.next/types` gotcha:** until Task 1 runs, stale `.next/types/* 2.ts` artifacts can fail typecheck/build. If you hit it before Task 1, run `find apps/portal/.next/types -name "* 2.ts" -delete` first. (`pnpm lint` at the repo root can also trip on a stray `.claude/worktrees/` checkout — if so, verify with `pnpm exec eslint . --ignore-pattern '.claude/**'` or per-package lint; CI on a clean checkout is unaffected.)

---

### Task 1 — Clear the 16 untracked `" 2"` duplicate files (local hygiene; **no commit**)

The 16 `" 2.tsx"/" 2.ts"` files are accidental Finder copies. **All are untracked**, so removing them produces NO git diff and NO commit — this step exists to (a) kill the `call-shell 2.tsx` "edit-the-wrong-file / trust-the-stale-docstring" hazard and (b) stop the stale `.next/types/* 2.ts` artifacts that break typecheck/build in the later slices.

> ⚠️ **Do NOT run a blanket `git clean -f`.** Other untracked files must be preserved — the handoff docs under `docs/handoffs/`, `docs/plans/2026-07-23-uiux-polish-batch4-copy.md`, `polish-mock.png`, and `analysis-and-audit-2026_07_11/`. Scope the removal strictly to the `" 2"` source/test dupes under `apps/portal`, as below.

**Files (all untracked; removed, not committed):** 7 source + 9 test under `apps/portal` —
`components/call/call-shell 2.tsx`, `components/dashboard/off-duty-prompt 2.tsx`, `components/dashboard/property-action-button 2.tsx`, `components/dashboard/shift-card 2.tsx`, `components/dashboard/zone-clocks-card 2.tsx`, `lib/clocks/zone-time 2.ts`, `lib/remote-access/connect-error 2.ts`, `tests/components/call-controls.test 2.tsx`, `tests/components/call-shell.test 2.tsx`, `tests/components/dashboard-workspace.test 2.tsx`, `tests/components/off-duty-prompt.test 2.tsx`, `tests/components/property-action-button.test 2.tsx`, `tests/components/shift-card.test 2.tsx`, `tests/components/zone-clocks-card.test 2.tsx`, `tests/lib/clocks/zone-time.test 2.ts`, `tests/lib/remote-access/connect-error.test 2.ts`.

- [ ] **Step 1 — Dry run: list the dupes and confirm the count is exactly 16** (build output excluded):

```bash
find apps/portal -type f \( -name '* 2.tsx' -o -name '* 2.ts' \) -not -path '*/.next/*' -print | sort
find apps/portal -type f \( -name '* 2.tsx' -o -name '* 2.ts' \) -not -path '*/.next/*' | wc -l   # must print 16
```

Expected: the 16 paths above, count `16`. **If the count is not 16, STOP** and reconcile before deleting anything.

- [ ] **Step 2 — Remove the dupes + any stale Next type artifacts:**

```bash
find apps/portal -type f \( -name '* 2.tsx' -o -name '* 2.ts' \) -not -path '*/.next/*' -delete
find apps/portal/.next/types -name '* 2.ts' -delete 2>/dev/null || true
```

- [ ] **Step 3 — Verify the tree is clean and the gate is green:**

```bash
git status --porcelain | grep ' 2\.' || echo "no ' 2' dupes remain"
pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm -F @lc/portal test
```

Expected: no `" 2"` files remain (the `grep` prints the fallback line); typecheck/build/test all green. **No commit** — the removed files were never tracked.

---

### Task 2 — Remove the dead `CallControlTray`

`CallControlTray` (`call-controls.tsx:75–84`, docblock `44–74`) is unused — both overlays dropped it in the bar reorder and its own docblock flags the deletion as deferred (the three grep "hits" in the overlays are comments). The file's other three exports (`CallControlDivider`, `CallToggleButton`, `EndCallButton`) are LIVE — keep them. Its only exercise is `call-controls.test.tsx`, whose block also covers the **still-live** `CallControlDivider` + `CallToggleButton`, so the test is rewritten (not deleted) to preserve that coverage.

**Files:**
- Modify: `apps/portal/components/call/call-controls.tsx` (delete the `CallControlTray` docblock + function, lines 44–84)
- Modify: `apps/portal/tests/components/call-controls.test.tsx` (drop the `CallControlTray` import; rewrite its describe block to cover only the live `CallControlDivider` + toggle)

- [ ] **Step 1 — Delete the component.** In `call-controls.tsx`, remove the entire `CallControlTray` docblock **and** function — the block that begins with the comment `/**\n * NO LONGER USED BY EITHER OVERLAY (Tasks 3+4, ...` and ends with the closing `}` of `export function CallControlTray({ children }: ...)`. Leave the blank line before the next docblock (`/** Sits before End call ...`) so `CallControlDivider` and everything below is untouched. **Do NOT remove** the `import type { ReactNode } from "react";` at line 40 — `CallToggleButton` still uses `ReactNode` (line 171).

- [ ] **Step 2 — Update the test import.** In `call-controls.test.tsx`, remove `CallControlTray,` from the import block (lines 22–27) so it reads:

```tsx
import {
  CallControlDivider,
  CallToggleButton,
  EndCallButton,
} from "@/components/call/call-controls";
```

- [ ] **Step 3 — Rewrite the tray describe block to cover the live divider + toggle.** Replace the comment + `describe("CallControlTray / CallControlDivider (spec §5.4 grouping)", ...)` block (the comment at lines 212–217 through the block's closing `});` at line 280) with:

```tsx
// Spec §5.4: End call / Connect read isolated from the mic toggle via a real
// divider — Connect hands off to RustDesk and End call terminates a guest's
// call, neither of which belongs beside a mute button. A reviewer showed that
// replacing the divider body with `return null` left the whole suite green, so
// the one part of §5 with a stated safety purpose needs its own coverage. (The
// old CallControlTray wrapper this block also exercised was removed in Batch 5a
// — both overlays sequence the controls as flat siblings now.)
describe("CallControlDivider (spec §5.4 isolation)", () => {
  it("renders a real divider between the toggle and Connect", () => {
    render(
      <div>
        <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={vi.fn()} />
        <CallControlDivider />
        <button type="button">Connect</button>
      </div>,
    );

    const divider = screen.getByTestId("call-control-divider");
    // A `return null` divider would leave DOM order intact and every other
    // assertion green — pin that it renders something with a visible fill.
    expect(divider.className).toContain("bg-border");
    expect(divider.getAttribute("aria-hidden")).toBe("true");

    // Node.DOCUMENT_POSITION_FOLLOWING === 4: divider sits after the toggle and
    // before Connect (the control the isolation exists to hold apart).
    const mute = screen.getByRole("button", { name: /^mute$/i });
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(mute.compareDocumentPosition(divider) & 4).toBeTruthy();
    expect(divider.compareDocumentPosition(connect) & 4).toBeTruthy();
  });

  it("fires onToggle when the toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <CallToggleButton label="Mute" icon={null} pressed={false} title="off" onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4 — Verify no dangling references + gate green:**

```bash
grep -rn "CallControlTray\|call-control-tray" apps/portal || echo "no CallControlTray references remain"
pnpm -F @lc/portal test call-controls && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes
```

Expected: the only surviving matches (if any) are unrelated comments in the overlays that already said the tray "is gone"; the `call-controls.test.tsx` suite is green.

- [ ] **Step 5 — Commit.** `refactor(call): remove the unused CallControlTray`

---

### Task 3 — Remove the write-only `LineStatus` beacon feature

The softphone pushes its phase into `LineStatusContext`, but the sole reader was `LineBeacon`, which is never rendered. So the whole chain (context module + provider + beacon + the softphone report effect) is write-only/dead. Remove it entirely. `lineStatusFromPhase` has no other importer, so its module + unit test go with it.

**Files:**
- Delete: `apps/portal/components/dashboard/line-beacon.tsx`
- Delete: `apps/portal/components/dashboard/line-status-provider.tsx`
- Delete: `apps/portal/lib/dashboard/line-status.ts`
- Delete: `apps/portal/tests/dashboard/line-status.test.ts`
- Modify: `apps/portal/components/app-shell.tsx` (drop the import + unwrap the provider)
- Modify: `apps/portal/components/softphone/softphone.tsx` (drop the import + the report effect)

- [ ] **Step 1 — Delete the four dead files:**

```bash
rm "apps/portal/components/dashboard/line-beacon.tsx" \
   "apps/portal/components/dashboard/line-status-provider.tsx" \
   "apps/portal/lib/dashboard/line-status.ts" \
   "apps/portal/tests/dashboard/line-status.test.ts"
```

- [ ] **Step 2 — Unwrap the provider in `app-shell.tsx`.** Remove the import line (line 4):

```tsx
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";
```

Then make `CallSurfaceProvider` the outermost wrapper — remove the opening `<LineStatusProvider>` (line 36) and the closing `</LineStatusProvider>` (line 80). The `return (` now opens directly onto `<CallSurfaceProvider>`, which closes at the end. (Net: the JSX tree loses one outer level; indentation of the inner block may shift — keep it valid, the executing agent's formatter/lint will settle it.)

- [ ] **Step 3 — Drop the report effect in `softphone.tsx`.** Remove the import (line 14):

```tsx
import { useLineStatus } from "@/lib/dashboard/line-status";
```

and delete the beacon comment + hook + effect (lines 277–281):

```tsx
  // Beacon: report line phase to the LineStatusContext so the greeting widget
  // can reflect live status. The default context is a no-op, so this is safe
  // in layouts that don't mount a provider (admin layout).
  const { report } = useLineStatus();
  useEffect(() => { report(phase); }, [phase, report]);
```

Leave everything else in `softphone.tsx` byte-identical (the accept-gate at `:587`, notes handlers, 911, `handleConnect` are all untouched).

- [ ] **Step 4 — Verify nothing still references the removed feature + gate green:**

```bash
grep -rn "useLineStatus\|LineStatusContext\|LineStatusProvider\|lineStatusFromPhase\|line-status\|LineBeacon\|line-beacon" apps/portal --include='*.ts' --include='*.tsx' || echo "no LineStatus references remain"
pnpm -F @lc/portal test softphone && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes
```

Expected: **zero** matches from the grep; the softphone suite + full gate green. (If the grep matches anything, it is a missed reference — resolve before committing.)

- [ ] **Step 5 — Commit.** `refactor(dashboard): remove the write-only LineStatus beacon feature`

---

### Task 4 — Remove the dead `GreetingLine` component

`GreetingLine` is never imported/rendered; `DashboardHeader` already inlines the identical time-aware greeting. Delete it and fix the one stale comment that names it.

**Files:**
- Delete: `apps/portal/components/dashboard/greeting-line.tsx`
- Modify: `apps/portal/components/dashboard/dashboard-header.tsx:57` (comment no longer references the deleted component)

- [ ] **Step 1 — Delete the file:**

```bash
rm "apps/portal/components/dashboard/greeting-line.tsx"
```

- [ ] **Step 2 — De-reference it in the header comment.** In `dashboard-header.tsx`, replace:

```tsx
  // Time-aware, mirroring GreetingLine: render a neutral default on the server and
  // resolve the greeting on the client so the local hour never mismatches hydration.
```

with:

```tsx
  // Time-aware: render a neutral default on the server and resolve the greeting on
  // the client so the local hour never mismatches hydration.
```

- [ ] **Step 3 — Verify + gate green:**

```bash
grep -rn "GreetingLine\|greeting-line" apps/portal || echo "no GreetingLine references remain"
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes
```

Expected: zero matches; full gate green.

- [ ] **Step 4 — Commit.** `refactor(dashboard): remove the dead GreetingLine component`

---

## Live-verify gate (before 5b)

Deploy the branch and confirm on the real build that **nothing changed** (these are pure removals): the agent + admin dashboards render, the softphone idle face + line pill still show state, and a live in-call control bar (Mute · [Camera] · Captions · divider · End call) is intact. The only files with runtime edits are `app-shell.tsx` (one fewer provider) and `softphone.tsx` (one fewer dead effect) — smoke that the shell mounts and the softphone still connects/answers. Then start 5b.

---

## Self-review

- **Spec coverage:** covers the audit's entire "Dead code to remove" line (line-beacon, greeting-line, `LineStatusProvider` + `softphone.tsx:273` report, `CallControlTray`) + the 16 `" 2"` dupes. The other Batch-5 items (primitives, CRUD/layout unify) are 5b/5c.
- **No placeholders:** every deletion names exact files/lines; the one non-trivial edit (the test rewrite in Task 2) is given in full; `app-shell.tsx`'s unwrap is described structurally because the surrounding provider stack must stay in order.
- **Type/name consistency:** the grep verification steps (Tasks 2–4) are the safety net that no import/JSX reference to a removed symbol survives — the exact failure mode a deletion batch risks. `ReactNode` is explicitly retained in `call-controls.tsx` (still used by `CallToggleButton`).
- **Ordering:** Task 1 first (clears the `.next/types` gotcha for the rest); Tasks 2–4 are independent and could be committed in any order.
