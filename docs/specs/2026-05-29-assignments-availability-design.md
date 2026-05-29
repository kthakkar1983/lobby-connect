# Plan 4c — Assignments + Call-Availability Design

- **Status**: Approved (brainstorm complete)
- **Date**: 2026-05-29
- **Spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (§5.4, §5.5, §6, §9.3)
- **Builds on**: Plan 4b (Properties CRUD) — tag `plan-04b-properties-crud-complete`

---

## 1. Purpose

Let an admin decide **who answers the phone for each property**, in two layers:

1. **Assignment** — designate the single current primary agent for a property. Phone routing (Plan 5) dials this person.
2. **Call availability** — a per-property, per-admin `accepting_calls` switch. An admin can be on-call for Property A but not Property B; the routing webhook adds accepting admins to the parallel dial.

This plan delivers the admin-facing CRUD + toggle UI and the tested write logic. It does not touch the routing webhook (Plan 5).

---

## 2. Scope

**In:**

- Migration `0005`: partial unique index guaranteeing at most one active assignment per property.
- `seed.sql`: add two AGENTs and one OWNER so assignment/availability/owner UIs have real data after `db reset`.
- `lib/assignments/`: pure, unit-tested assignment-change planner + validators.
- Server Actions: set/unassign primary agent (audited), set call availability (not audited).
- UI: an assignment card on the property detail page; a "Your call availability" section on the `/admin` overview.

**Out (forward-compat preserved):**

- `backup_agent_id` — column stays, absent from the v1 UI.
- Agent-facing "my assignments" view — Plan 5.
- The routing webhook and parallel-dial dedup — Plan 5.
- No new sidebar nav entry.

---

## 3. Locked Decisions

### 3.1 One active assignment per property, DB-enforced

An assignment row with `effective_until IS NULL` is "active." The invariant is **at most one active row per property**. Routing (Plan 5) depends on it: two active rows means the webhook cannot tell who to ring.

Enforcement: a **partial unique index** makes a second active row physically impossible. The app guarantees correctness with **close-then-insert** ordering — end the prior active row before inserting the new one. A mid-operation failure therefore leaves the property *unassigned* (safe, obvious, recoverable), never double-assigned.

The spec previously deferred a DB constraint "because of complexity" — that concern was about time-overlap range constraints. "At most one open row" is a one-line partial unique index, not a range constraint, so we add it.

### 3.2 Assignment UI lives on the property detail page

Assignment is inherently per-property, so the card sits on `/admin/properties/[id]` below the existing `PropertyForm`. No dedicated `/admin/assignments` page in v1.

### 3.3 Availability toggle lives on the `/admin` overview

Per spec §9.3 ("surfaced on each property card in the admin dashboard, not a global header toggle"), the `/admin` overview gains a "Your call availability" section: one row per property with a `Switch` reflecting *this admin's* `accepting_calls` for that property. One screen flips availability across all properties.

### 3.4 Assignable agents = active AGENTs and ADMINs

The primary-agent dropdown lists active profiles with role AGENT **or** ADMIN in the actor's operator. Admins are selectable as a property's primary agent (in addition to opting into parallel dial via the availability toggle). `assertValidAgent` validates both roles server-side.

### 3.5 Reads and writes use the user-scoped client (RLS, not service role)

Consistent with 4b. `property_assignments` RLS already grants admin full write; `admin_call_availability` RLS already restricts each admin to their own rows. No service-role usage in this plan.

### 3.6 Audit assignments; do not audit the toggle

- `assignment.created` — first assignment for a property.
- `assignment.changed` — reassign (prior closed, new opened).
- `assignment.removed` — unassign (prior closed, none opened).

`entity_type = 'property_assignment'`, `entity_id = property_id`, `details` carries `primary_agent_id` and `previous_agent_id` where applicable.

The `accepting_calls` toggle is **not** audited (spec §6: high-frequency, low-value).

### 3.7 Friendly handling of the unique-index race

Two active rows are impossible, but a concurrent insert can hit the partial unique index (`23505`). Surface a friendly "This assignment just changed — please refresh and try again" message, mirroring 4b's `23505` → friendly-error pattern. No audit row on failure.

### 3.8 Optimistic toggle

The availability `Switch` updates optimistically, rolls back + toasts on failure (spec §9.4).

---

## 4. File Layout

**New:**

```
supabase/migrations/0005_assignment_one_active.sql
apps/portal/lib/assignments/plan.ts            # pure planAssignmentChange
apps/portal/lib/assignments/plan.test.ts       # Vitest, all four branches
apps/portal/lib/assignments/validate.ts        # input guards (uuid / present)
apps/portal/lib/assignments/validate.test.ts
apps/portal/app/(admin)/admin/properties/[id]/assignment-card.tsx   # "use client"
apps/portal/app/(admin)/admin/availability-cards.tsx                # "use client"
```

**Modified:**

```
supabase/seed.sql                                            # +2 AGENTs, +1 OWNER
apps/portal/app/(admin)/admin/properties/actions.ts          # +3 server actions
apps/portal/app/(admin)/admin/properties/[id]/page.tsx       # fetch + render assignment card
apps/portal/app/(admin)/admin/page.tsx                       # Server Component + availability section
```

---

## 5. Server Action Surface

All in `properties/actions.ts`, each `requireRole("ADMIN")` first.

```ts
setPrimaryAgentAction(propertyId: string, agentId: string): Promise<ActionResult>
// validate → assertValidAgent → getCurrentAssignment → planAssignmentChange
// → close-then-insert (user-scoped) → audit created|changed → revalidatePath

unassignPrimaryAgentAction(propertyId: string): Promise<ActionResult>
// close open row → audit removed → revalidatePath

setCallAvailabilityAction(propertyId: string, accepting: boolean): Promise<ActionResult>
// upsert admin_call_availability for auth.uid() → revalidatePath("/admin"). No audit.
```

`planAssignmentChange(current, desiredAgentId)` returns one of:

- `noop` — desired agent already active.
- `assign` — no active row; insert new.
- `reassign` — different agent active; close prior (`closeId`) + insert new.
- `unassign` — desired is null; close prior only.

The action executes the plan; the planner stays pure and DB-free.

---

## 6. RLS Considerations

No policy changes. Verified against existing migrations:

- `property_assignments`: `assignments_admin_write` grants admins full write within their operator; `assignments_select` lets admins read all rows in-operator. The `0004` `SECURITY DEFINER` helpers already broke the properties↔assignments recursion cycle.
- `admin_call_availability`: `aca_admin_select_own` / `aca_admin_write_own` restrict each admin to `profile_id = auth.uid()`. The upsert sets `profile_id` to the caller, so the `WITH CHECK` passes.

The new partial unique index is independent of RLS.

---

## 7. Testing Strategy

**Unit (Vitest, no DB):**

- `planAssignmentChange`: noop, assign, reassign, unassign branches.
- `validate`: rejects empty / non-uuid agent ids; accepts valid.

**Manual smoke (Playwright, signed in as seeded admin):**

1. Property with no agent → assign agent → card shows agent, `assignment.created` audited.
2. Reassign to a second agent → prior row closed (`effective_until` set), new row open, `assignment.changed` audited.
3. Unassign (confirm dialog) → open row closed, `assignment.removed` audited, card shows empty state.
4. Select an ADMIN as primary agent → succeeds (3.4).
5. Toggle availability on a property on `/admin` → `admin_call_availability` row upserted, switch persists across reload, **no** audit row.
6. Toggle off → row updated to `accepting_calls = false`.
7. Direct DB check: a second `effective_until IS NULL` insert for the same property is rejected by the index.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Close succeeds, insert fails → property unassigned | Acceptable, recoverable; surface error so admin retries. Close-first ordering makes this the *only* failure mode (never double-assigned). |
| Concurrent reassign hits unique index | `23505` → friendly retry message (3.7). |
| Migration 0005 not applied to prod before push | Added to the existing "apply migrations 0001–0005 before pushing" checklist in project-status. Local-only for now. |
| Admin is both primary agent and accepting_calls=true → double dial | Out of scope here; flagged for Plan 5 routing dedup. |
| `seed.sql` auth.users rows drift from real GoTrue shape | Copy the existing admin block exactly; local-dev only. |

---

## 9. Non-Goals

- Backup-agent assignment UI.
- Assignment history viewer (rows accumulate with `effective_from`/`effective_until`; no UI to browse them in v1).
- Agent-facing assignment view.
- Any change to routing or the parallel-dial webhook.

---

## 10. Definition of Done

- Migration 0005 written, committed, applied to local Supabase.
- `seed.sql` reseeds two AGENTs + one OWNER; `db reset` yields a working assignment dropdown.
- `lib/assignments` unit tests green; `npm run lint` + typecheck clean.
- Assignment card: assign / reassign / unassign all work, audited correctly.
- Availability section: per-property optimistic toggle persists, not audited.
- Manual smoke (§7) complete in-browser, audit trail verified.
- Committed and tagged `plan-04c-assignments-availability-complete` on local `main` (not pushed, per the standing deploy/prod-DB policy).
