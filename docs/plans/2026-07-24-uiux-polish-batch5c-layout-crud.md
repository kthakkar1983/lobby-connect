# UI/UX Polish Batch 5c — Layout & CRUD unification · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Align the remaining layout/CRUD outliers to patterns the app already uses — unify the users edit surface to a Dialog, flatten the white-on-white nested call cards, put the admin table frames on the brand card radius, and give the users table the zebra + status-pill treatment its siblings already have. Each change matches existing precedent; no new visual language.

**Architecture:** Five focused, mostly-independent changes. The one shared new helper is `presenceBadgeVariant` (a pure status→variant map, TDD'd) that renders the users-table presence column on the `StatusBadge` primitive built in 5b. No new primitives; no call-surface guards involved.

**Tech Stack:** Next.js App Router (portal), Tailwind v4 tokens, shadcn `Dialog`, `StatusBadge` (from 5b), Vitest + Testing Library (jsdom).

**Grounding:** audit `docs/audits/2026-07-20-whole-app-uiux-audit.md` Theme H + factual defect #4; the 2026-07-24 CRUD/layout sweep. Depends on 5a + 5b (merged). This is the final Batch-5 slice.

---

## Constraints (inherited — all batches)

- **Zero migrations / API routes / RLS.** These are presentation/composition changes only.
- **No call-surface guards involved** (this batch touches admin CRUD + owner read views + tables, not the softphone/overlays/tile).
- **Widths/sizes in Tailwind scale (rem), never px.**
- **jsdom has no layout engine** — tests assert classes/attributes/roles; the real check is the live prod smoke. The nested-card flatten + the CRUD-shape change are the two most visual items → call them out at the smoke.
- **Gate (green before each commit):** `pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes`. (`.next/types/* 2.ts` gotcha → `find apps/portal/.next/types -name "* 2.ts" -delete` first; root `pnpm lint` false-positives on a stray `.claude/worktrees/` checkout → re-verify with `pnpm -F @lc/portal lint`.)

## Scope decisions (deliberate)

- **Radius: table frames only.** Change the admin table frames `rounded-lg` (8px) → `rounded-card` (12px) so they match the empty-states beside them. **Leave** the vendored shadcn `rounded-md` inside primitives (tooltip/dialog/select — retokenizing is invasive, low value) and **leave** the auth card's `rounded-2xl` (a deliberate elevated-login choice from the brand redesign, not drift).
- **Container: fix the shifts double-padding only.** The shifts page adds its own `p-6` on top of the workspace's `p-6`. Remove the redundant one + align its gap. The broader "one max-width for all zones" is a bigger call, deferred (noted).
- **Flatten only the CallRow-list cards.** Owner Home + property-detail wrap a `CallRow` list (each row already a card) in a `Card`/`SectionCard`. Drop that one wrapper, keep the section header. Sibling cards that hold non-card content (the Incidents card, coverage strip) stay. The deeper `CallRow`-expanded `SectionCard`×3 nesting is a separate concern, out of scope.

---

### Task 1: Users edit — side `Sheet` → centered `Dialog`

`EditSheet` (`users-table.tsx:178–277`) is the lone CRUD outlier: one entity whose *create* is a `Dialog` (`CreateUserDialog`, `:91–176`) but whose *edit* is a `Sheet`. Convert it to a `Dialog` matching the create surface + the shifts-table edit dialog. Mechanical swap; the controlled `open`/`onOpenChange` + the external trigger (row dropdown) + `onSave` logic stay identical.

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx` (rename `EditSheet`→`EditDialog`; swap `Sheet*`→`Dialog*`; update the render site + the now-unused `Sheet*` import)
- Test: `apps/portal/tests/components/users-table.test.tsx` (if it asserts the edit surface; read first — update any `Sheet`-specific query to the dialog)

- [ ] **Step 1 — Read** the current `EditSheet` (`:178–277`), the `CreateUserDialog` reference (`:91–176`), the render site (`grep "EditSheet"` — it's rendered from `RowActions`, ~`:410`), and the users-table test.
- [ ] **Step 2 — Convert the component.** Rename `EditSheet`→`EditDialog` and swap the wrapper (the body div loses the Sheet's `px-4 py-4` — `DialogContent` already pads, matching `CreateUserDialog`'s form which has none):

```tsx
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {props.user.full_name}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? "You can edit your name. Role and active status are locked for your own account."
              : "Update the user's name, role, or active status."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* …the three fields (Full name / Role / Active) + the error <p> UNCHANGED… */}
        </div>

        <DialogFooter>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
```

- [ ] **Step 3 — Update the render site** (`RowActions`): `<EditSheet …/>` → `<EditDialog …/>` (props unchanged).
- [ ] **Step 4 — Remove the now-unused `Sheet` import block** (`:47–54`). Confirm nothing else in the file uses `Sheet*` (`grep "Sheet"`).
- [ ] **Step 5 — Gate + commit.** `pnpm -F @lc/portal test users-table && [full gate]`. Commit: `refactor(admin): unify the users edit surface to a Dialog`.

> Smoke: opening Edit on a user row now centers a Dialog (like Add user + shifts edit) instead of sliding a panel from the right.

---

### Task 2: Flatten the nested `Recent calls` cards (owner Home + property detail)

Both wrap a `CallRow` list — each row already a card — in an outer card, producing white-on-white. Drop the outer card, keep the section header, so the `CallRow`s are the only cards (matching the owner/admin Calls **list** pages, which render `CallRow` bare in a `flex flex-col gap-2`).

**Files:**
- Modify: `apps/portal/components/owner/property-overview.tsx` (the `Recent calls` `<Card className="gap-2 p-5">`, `:84–94`)
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/page.tsx` (the `Recent calls` `<SectionCard>`, `:147–191`)
- Test: none new (visual); the existing owner tests must stay green.

- [ ] **Step 1 — Owner Home.** In `property-overview.tsx`, replace the `Recent calls` `<Card className="gap-2 p-5">…</Card>` with a plain section that keeps the header + list and drops the card chrome:

```tsx
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className={LABEL}>Recent calls</h2>
            <Link href="/owner/calls" className="text-sm text-accent-text hover:underline">View all</Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">No calls yet.</p>
          ) : (
            <div className="flex flex-col gap-2">{recent.map((c) => <CallRow key={c.detail.id} call={c} />)}</div>
          )}
        </div>
```

(The sibling `Incidents` `<Card>` at `:97` is untouched — it holds a link, not cards.)

- [ ] **Step 2 — Owner property detail.** In `[id]/page.tsx`, replace `<SectionCard title="Recent calls" action={…}>…</SectionCard>` (`:147–191`) with a plain section that reproduces the SectionCard's title+action header and keeps the `EmptyState`/`CallRow` list body:

```tsx
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Recent calls</h2>
          <Link href="/owner/calls" className="text-sm font-medium text-accent-text hover:underline">View all</Link>
        </div>
        {/* the recentRows.length === 0 ? <EmptyState/> : <div className="flex flex-col gap-2">…CallRow…</div> body UNCHANGED */}
      </div>
```

Read `components/owner/section-card.tsx` first to copy its exact title/action markup (the label class + spacing) so the header reads identically minus the card chrome. If `SectionCard` becomes unused in this file, drop its import.

- [ ] **Step 3 — Gate + commit.** `refactor(owner): flatten the nested Recent-calls cards`.

> Smoke (owner portal): the "Recent calls" sections on the property overview + property detail no longer show a card-inside-a-card edge; the call rows sit directly under the header. Confirm the section still reads as a grouped unit.

---

### Task 3: Admin table frames — `rounded-lg` → `rounded-card`

The admin tables frame themselves in raw `rounded-lg` (8px) while the empty-states beside them use `rounded-card` (12px) — a visible corner mismatch between siblings. Move the frames to the token.

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx:527` (`rounded-lg` → `rounded-card`)
- Modify: `apps/portal/app/(admin)/admin/properties/properties-table.tsx:75` (`rounded-lg` → `rounded-card`)
- Modify: any other admin table frame using `rounded-lg` (grep `rounded-lg` under `app/(admin)` — e.g. shifts-table, audit-table frames — and change the table-**frame** ones; leave unrelated `rounded-lg` on non-frame elements)
- Test: extend a table test to assert the frame class if trivial; else keep green.

- [ ] **Step 1 — Grep** `rounded-lg` under `apps/portal/app/(admin)` and identify the table-frame wrappers (the `<div className="rounded-lg border border-border bg-card">` around a `<Table>`).
- [ ] **Step 2 — Change** each table-frame `rounded-lg` → `rounded-card`. Do NOT touch `rounded-lg` on non-frame elements (buttons, chips, etc.) if any.
- [ ] **Step 3 — Gate + commit.** `fix(admin): put table frames on the brand card radius`.

---

### Task 4: Users table — zebra + presence pill

The users table has no zebra (properties + shifts tables use `even:bg-muted/40`) and renders Presence as raw muted text while the neighboring Status column uses pills. Add the zebra + render Presence via `StatusBadge`.

**Files:**
- Modify: `apps/portal/lib/owner/format.ts` (add a pure `presenceBadgeVariant` next to `presenceLabel`/`presenceDotClass`)
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx` (zebra on the row `:541`; presence cell `:560–561` → `StatusBadge`)
- Test: `apps/portal/tests/lib/owner/format.test.ts` (or the file testing `presenceDotClass` — add `presenceBadgeVariant` cases) + `apps/portal/tests/components/users-table.test.tsx` (assert zebra class + a presence pill)

- [ ] **Step 1 — Write the failing helper test.** `presenceBadgeVariant` maps presence → `StatusBadge` variant, mirroring `presenceDotClass`'s status coverage: `AVAILABLE`→`"live"`, `ON_CALL`→`"accent"`, `AWAY`/`BREAK`/`OFFLINE`→`"muted"`.

```ts
import { presenceBadgeVariant } from "@/lib/owner/format";
// AVAILABLE→live, ON_CALL→accent, AWAY/BREAK/OFFLINE→muted
expect(presenceBadgeVariant("AVAILABLE")).toBe("live");
expect(presenceBadgeVariant("ON_CALL")).toBe("accent");
expect(presenceBadgeVariant("OFFLINE")).toBe("muted");
```

- [ ] **Step 2 — Implement** `presenceBadgeVariant` (read `presenceDotClass` first for the exact `PresenceStatus` union + its status handling; return the `StatusBadge` variant union `"live"|"accent"|"muted"`). Run → green.
- [ ] **Step 3 — Apply in the table.** Row `:541`: `<TableRow key={u.id}>` → `<TableRow key={u.id} className="even:bg-muted/40">`. Presence cell `:560–561`:

```tsx
                  <TableCell>
                    {roleHasPresence(u.role) ? (
                      <StatusBadge variant={presenceBadgeVariant(u.status)}>{presenceLabel(u.status)}</StatusBadge>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </TableCell>
```

Import `presenceBadgeVariant` (StatusBadge is already imported from 5b Task 4).

- [ ] **Step 4 — Pin it** in `users-table.test.tsx`: a row renders `even:bg-muted/40`, and an `AVAILABLE` agent renders a live-variant presence pill (not raw text). Run → green.
- [ ] **Step 5 — Gate + commit.** `fix(admin): users table zebra + presence pill`.

---

### Task 5: Fix the shifts page double-padding

The shifts page wraps its content in its own `p-6` on top of the workspace's `p-6` (48px total), plus a `gap-4` where the other admin pages use `gap-6`. Remove the redundant padding + align the gap.

**Files:**
- Modify: `apps/portal/app/(admin)/admin/shifts/page.tsx` (the page wrapper, ~`:44` — read first to confirm the exact className)
- Test: none (layout); keep green.

- [ ] **Step 1 — Read** the shifts `page.tsx` wrapper. Confirm it is `flex w-full max-w-6xl flex-col gap-4 p-6` (the workspace at `dashboard-workspace.tsx:100` already supplies `p-6`).
- [ ] **Step 2 — Change** `flex w-full max-w-6xl flex-col gap-4 p-6` → `flex w-full max-w-6xl flex-col gap-6` (drop the redundant `p-6`, `gap-4`→`gap-6` to match users/properties). Keep `max-w-6xl` (its deliberate width cap; the broader full-bleed-vs-capped "pick one" is deferred).
- [ ] **Step 3 — Gate + commit.** `fix(admin): remove the shifts page double-padding`.

> Smoke: the shifts page content no longer sits with a doubled outer margin; its top/side spacing matches the users + properties pages.

---

## Live-verify gate (Batch 5 complete)

Deploy + confirm on the real build: the users **Edit** opens as a centered Dialog; the owner **Recent calls** sections (home + property detail) are flat (no card-in-card); the admin table corners match their empty-states; the users table has zebra rows + a presence **pill**; the shifts page spacing matches its siblings. With this, Batch 5 (a+b+c) and the whole 5-batch UI/UX polish are done — then close out (tag + handoff + CLAUDE.md/MEMORY build-status).

---

## Self-review

- **Spec coverage:** audit Theme H's CRUD-shape (users Sheet→Dialog), nested cards (both CallRow sites), radius (table frames), container (shifts double-pad); factual defect #4 (users zebra + presence pill). The `rounded-[var(--radius-card)]`→`rounded-card` code-normalization + the broader max-width "pick one" + the table-header-label promotion are deliberately deferred (noted) — not visible or higher-churn than 5c's remit.
- **Type consistency:** `presenceBadgeVariant` returns the exact `StatusBadge` `variant` union (`"live"|"accent"|"muted"`) used in Task 4's cell. `EditDialog` keeps `EditSheet`'s prop shape (`user`/`actorId`/`open`/`onOpenChange`), so the render site changes only the component name.
- **No placeholders:** the Sheet→Dialog conversion + the two flattened sections + the presence cell are given as concrete code; the radius/zebra/container edits name exact files+lines. Each "read first" note is where the executing agent must copy an existing shape (SectionCard header, presenceDotClass union) rather than have it reproduced and risk drift.
- **Guard safety:** none of these files are call-surface guards; the riskiest is the users-table (three tasks touch it) — each names the exact lines and keeps the CRUD actions (`updateUserAction` etc.) untouched.
