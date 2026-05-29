# Plan 4c — Assignments + Call-Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin assign one primary agent per property and toggle their own per-property call availability, with the one-active-assignment invariant enforced by the database.

**Architecture:** Schema and RLS already exist (migrations 0001/0002/0004); this plan adds one partial unique index, tested pure logic in `lib/assignments/`, three Server Actions in the existing `properties/actions.ts`, an assignment card on the property detail page, and a "Your call availability" section on the `/admin` overview. Reads and writes use the user-scoped Supabase client (RLS), never the service role. Assignment changes are audited; the availability toggle is not.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase Postgres + RLS, TypeScript, Vitest, shadcn UI (`Select`, `Switch`, `AlertDialog`), `sonner` toasts, pnpm monorepo.

**Spec:** `docs/specs/2026-05-29-assignments-availability-design.md`

**Conventions reused from 4a/4b:**
- Server Actions return `ActionResult = { ok: true } | { ok: false; error: string }`.
- `requireRole("ADMIN")` first in every action.
- Defense-in-depth validators (`assertValidAgent`, mirroring 4b's `assertValidOwner`).
- `23505` → friendly message.
- Tests live in `tests/lib/...` (mirroring `lib/`), NOT colocated. Import the unit under test lazily: `const { fn } = await import("@/lib/...")`.
- All commands assume the repo root `/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect` unless a `cd` is shown.

---

## Task 1: Migration 0005 + seed non-admin users

**Files:**
- Create: `supabase/migrations/0005_assignment_one_active.sql`
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_assignment_one_active.sql`:

```sql
-- 0005_assignment_one_active.sql
-- Enforces the core assignment invariant: at most one ACTIVE primary-agent
-- assignment per property. An "active" row has effective_until IS NULL.
-- Plan 5 phone routing assumes exactly one active assignment per property;
-- two active rows would make the parallel-dial target ambiguous.
--
-- The v1 spec deferred a DB constraint "because of complexity" — that concern
-- was about time-overlap (range) constraints. "At most one open row" is a
-- simple partial unique index, so we add it. The Server Action uses
-- close-then-insert ordering, so this index only ever fires on a concurrent
-- double-assign race, which the action surfaces as a friendly retry message.
--
-- Idempotent: create index if not exists.

create unique index if not exists property_assignments_one_active
  on property_assignments(property_id)
  where effective_until is null;
```

- [ ] **Step 2: Add an OWNER and two AGENTs to the seed**

In `supabase/seed.sql`, insert the following block **between** the "3. Admin profile" block (ends at the `on conflict (id) do nothing;` after the admin profile, ~line 66) and the "4. Sample property" block (~line 68). Each auth.users insert copies the admin block's exact column list.

```sql
-- 3b. Owner + agent auth users (LOCAL DEV ONLY) -------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex.agent@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000b4',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bailey.agent@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', '')
on conflict (id) do nothing;

-- 3c. Owner + agent profiles --------------------------------------------------
insert into profiles (id, operator_id, role, full_name, email, status, active)
values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000a0', 'OWNER', 'Olivia Owner',
   'owner@lobbyconnect.local', 'OFFLINE', true),
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-0000000000a0', 'AGENT', 'Alex Agent',
   'alex.agent@lobbyconnect.local', 'OFFLINE', true),
  ('00000000-0000-0000-0000-0000000000b4',
   '00000000-0000-0000-0000-0000000000a0', 'AGENT', 'Bailey Agent',
   'bailey.agent@lobbyconnect.local', 'OFFLINE', true)
on conflict (id) do nothing;
```

- [ ] **Step 3: Point the sample property at the real owner**

In `supabase/seed.sql`, the "4. Sample property" insert currently sets `owner_user_id` to the admin (`...b1`). Change it to the new owner so the property has a valid OWNER:

```sql
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000a0',
  'The Sample Hotel',
  '00000000-0000-0000-0000-0000000000b2',
  'America/New_York',
  '+15555550100'
)
```

- [ ] **Step 4: Ensure the local Supabase stack is running**

Run: `pnpm supabase:start`
Expected: prints the local API URL / keys, or "supabase start is already running".

- [ ] **Step 5: Apply migrations + seed locally**

Run: `npx supabase db reset`
Expected: re-applies migrations 0001–0005 and `seed.sql`, ending with "Finished supabase db reset." No errors. (This wipes and rebuilds the LOCAL db only.)

- [ ] **Step 6: Verify the index and seed rows exist**

Open the local Supabase Studio SQL editor (default `http://127.0.0.1:54323` → SQL Editor; the exact URL is printed by `supabase start`). Run:

```sql
select indexname from pg_indexes where indexname = 'property_assignments_one_active';
```
Expected: one row, `property_assignments_one_active`.

```sql
select role, full_name from profiles order by role, full_name;
```
Expected: ADMIN Local Admin; AGENT Alex Agent; AGENT Bailey Agent; OWNER Olivia Owner.

> All SQL verification in this plan runs in the local Studio SQL editor — `psql` is not on PATH and the CLI has no `db execute` subcommand.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0005_assignment_one_active.sql supabase/seed.sql
git commit -m "feat(db): add one-active-assignment index (0005); seed owner + agents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lib/assignments/validate.ts` (TDD)

**Files:**
- Create: `apps/portal/lib/assignments/validate.ts`
- Test: `apps/portal/tests/lib/assignments/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/assignments/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("validateAgentId", () => {
  it("accepts a valid uuid", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("00000000-0000-0000-0000-0000000000b3")).toBeNull();
  });

  it("rejects an empty / whitespace-only string", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("   ")).toBe("Choose an agent.");
  });

  it("rejects a non-uuid string", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("not-a-uuid")).toBe("Choose a valid agent.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm exec vitest run tests/lib/assignments/validate.test.ts`
Expected: FAIL — cannot resolve `@/lib/assignments/validate`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/assignments/validate.ts`:

```ts
// Input guard for the primary-agent selection. The dropdown is RLS-scoped, so
// this is a cheap shape check; the action additionally calls assertValidAgent
// to confirm role + operator + active server-side.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAgentId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Choose an agent.";
  if (!UUID_RE.test(trimmed)) return "Choose a valid agent.";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm exec vitest run tests/lib/assignments/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/assignments/validate.ts apps/portal/tests/lib/assignments/validate.test.ts
git commit -m "feat(assignments): add validateAgentId

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `lib/assignments/plan.ts` — `planAssignmentChange` (TDD)

**Files:**
- Create: `apps/portal/lib/assignments/plan.ts`
- Test: `apps/portal/tests/lib/assignments/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/assignments/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("planAssignmentChange", () => {
  it("returns noop when no current assignment and desired is null", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(planAssignmentChange(null, null)).toEqual({ action: "noop" });
  });

  it("returns assign when no current assignment and an agent is desired", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(planAssignmentChange(null, "agent-1")).toEqual({
      action: "assign",
      newAgentId: "agent-1",
    });
  });

  it("returns noop when desired equals the current agent", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, "agent-1"),
    ).toEqual({ action: "noop" });
  });

  it("returns reassign (close current + insert new) when desired differs", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, "agent-2"),
    ).toEqual({ action: "reassign", closeId: "row-1", newAgentId: "agent-2" });
  });

  it("returns unassign when a current assignment exists and desired is null", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, null),
    ).toEqual({ action: "unassign", closeId: "row-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm exec vitest run tests/lib/assignments/plan.test.ts`
Expected: FAIL — cannot resolve `@/lib/assignments/plan`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/assignments/plan.ts`:

```ts
// Pure decision logic for changing a property's primary-agent assignment.
// The action executes the returned plan with close-then-insert ordering so a
// mid-failure leaves the property unassigned (safe) rather than double-assigned.

export type CurrentAssignment = {
  id: string;
  primary_agent_id: string;
} | null;

export type AssignmentPlan =
  | { action: "noop" }
  | { action: "assign"; newAgentId: string }
  | { action: "reassign"; closeId: string; newAgentId: string }
  | { action: "unassign"; closeId: string };

export function planAssignmentChange(
  current: CurrentAssignment,
  desiredAgentId: string | null,
): AssignmentPlan {
  if (desiredAgentId === null) {
    return current ? { action: "unassign", closeId: current.id } : { action: "noop" };
  }
  if (!current) {
    return { action: "assign", newAgentId: desiredAgentId };
  }
  if (current.primary_agent_id === desiredAgentId) {
    return { action: "noop" };
  }
  return { action: "reassign", closeId: current.id, newAgentId: desiredAgentId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm exec vitest run tests/lib/assignments/plan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/assignments/plan.ts apps/portal/tests/lib/assignments/plan.test.ts
git commit -m "feat(assignments): add planAssignmentChange

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Assignment Server Actions

**Files:**
- Modify: `apps/portal/app/(admin)/admin/properties/actions.ts`

- [ ] **Step 1: Add imports and type aliases**

In `apps/portal/app/(admin)/admin/properties/actions.ts`, add these imports below the existing `validate` import (after line 13):

```ts
import { validateAgentId } from "@/lib/assignments/validate";
import {
  planAssignmentChange,
  type CurrentAssignment,
} from "@/lib/assignments/plan";
```

Add these type aliases next to the existing `PropertyInsert` / `PropertyUpdate` aliases (after line 33):

```ts
type AssignmentInsert =
  Database["public"]["Tables"]["property_assignments"]["Insert"];
type AvailabilityInsert =
  Database["public"]["Tables"]["admin_call_availability"]["Insert"];

const ASSIGNABLE_ROLES = ["AGENT", "ADMIN"] as const;
```

- [ ] **Step 2: Add the `assertValidAgent` helper**

Append below the existing `assertValidOwner` function (after line 69):

```ts
// Defense-in-depth beyond the RLS-scoped dropdown: the selected primary agent
// must be an active same-operator profile with role AGENT or ADMIN.
async function assertValidAgent(
  supabase: ServerClient,
  operatorId: string,
  agentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, operator_id, role, active")
    .eq("id", agentId)
    .maybeSingle();

  if (
    !data ||
    data.operator_id !== operatorId ||
    !data.active ||
    !ASSIGNABLE_ROLES.includes(data.role as (typeof ASSIGNABLE_ROLES)[number])
  ) {
    return "Selected agent is not a valid, active agent in your operator.";
  }
  return null;
}
```

- [ ] **Step 3: Add `setPrimaryAgentAction` and `unassignPrimaryAgentAction`**

Append at the end of the file:

```ts
async function getCurrentAssignment(
  supabase: ServerClient,
  propertyId: string,
): Promise<CurrentAssignment> {
  const { data } = await supabase
    .from("property_assignments")
    .select("id, primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null)
    .maybeSingle();
  return data ?? null;
}

export async function setPrimaryAgentAction(
  propertyId: string,
  agentId: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validateAgentId(agentId);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  const agentError = await assertValidAgent(supabase, actor.operator_id, agentId);
  if (agentError) return { ok: false, error: agentError };

  const current = await getCurrentAssignment(supabase, propertyId);
  const plan = planAssignmentChange(current, agentId);

  if (plan.action === "noop") return { ok: true };

  // Close-then-insert: end the prior active row before opening the new one so a
  // mid-failure leaves the property unassigned (safe), never double-assigned.
  if (plan.action === "reassign") {
    const { error: closeError } = await supabase
      .from("property_assignments")
      .update({ effective_until: new Date().toISOString() })
      .eq("id", plan.closeId);
    if (closeError) {
      return {
        ok: false,
        error: `Failed to update assignment: ${closeError.message}`,
      };
    }
  }

  const insert: AssignmentInsert = {
    operator_id: actor.operator_id,
    property_id: propertyId,
    primary_agent_id: agentId,
  };
  const { error: insertError } = await supabase
    .from("property_assignments")
    .insert(insert);

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: "This assignment just changed — please refresh and try again.",
      };
    }
    return { ok: false, error: `Failed to assign agent: ${insertError.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action:
      plan.action === "reassign" ? "assignment.changed" : "assignment.created",
    entityType: "property_assignment",
    entityId: propertyId,
    details: {
      property_id: propertyId,
      primary_agent_id: agentId,
      previous_agent_id:
        plan.action === "reassign" ? (current?.primary_agent_id ?? null) : null,
    },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}

export async function unassignPrimaryAgentAction(
  propertyId: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const current = await getCurrentAssignment(supabase, propertyId);
  if (!current) return { ok: true };

  const { error } = await supabase
    .from("property_assignments")
    .update({ effective_until: new Date().toISOString() })
    .eq("id", current.id);

  if (error) {
    return { ok: false, error: `Failed to unassign agent: ${error.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: "assignment.removed",
    entityType: "property_assignment",
    entityId: propertyId,
    details: {
      property_id: propertyId,
      previous_agent_id: current.primary_agent_id,
    },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(admin)/admin/properties/actions.ts"
git commit -m "feat(assignments): add set/unassign primary agent actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Call-availability Server Action

**Files:**
- Modify: `apps/portal/app/(admin)/admin/properties/actions.ts`

- [ ] **Step 1: Add `setCallAvailabilityAction`**

Append at the end of `apps/portal/app/(admin)/admin/properties/actions.ts`:

```ts
// Per-property, per-admin call-acceptance toggle. Upserted (a missing row is
// treated as accepting_calls=false). NOT audited — high-frequency, low-value
// per spec §6. RLS restricts each admin to their own (profile_id) rows.
export async function setCallAvailabilityAction(
  propertyId: string,
  accepting: boolean,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const row: AvailabilityInsert = {
    profile_id: actor.id,
    property_id: propertyId,
    operator_id: actor.operator_id,
    accepting_calls: accepting,
  };

  const { error } = await supabase
    .from("admin_call_availability")
    .upsert(row, { onConflict: "profile_id,property_id" });

  if (error) {
    return {
      ok: false,
      error: `Failed to update availability: ${error.message}`,
    };
  }

  revalidatePath("/admin");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(admin)/admin/properties/actions.ts"
git commit -m "feat(availability): add setCallAvailabilityAction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Assignment card on the property detail page

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/[id]/assignment-card.tsx`
- Modify: `apps/portal/app/(admin)/admin/properties/[id]/page.tsx`

- [ ] **Step 1: Create the assignment card client component**

Create `apps/portal/app/(admin)/admin/properties/[id]/assignment-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setPrimaryAgentAction, unassignPrimaryAgentAction } from "../actions";

export type AgentOption = { id: string; full_name: string; role: string };

type Props = {
  propertyId: string;
  currentAgentId: string | null;
  currentAgentName: string | null;
  agents: AgentOption[];
};

export function AssignmentCard({
  propertyId,
  currentAgentId,
  currentAgentName,
  agents,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(currentAgentId ?? "");

  function onSave() {
    setError(null);
    if (!selected) {
      setError("Choose an agent.");
      return;
    }
    startTransition(async () => {
      const result = await setPrimaryAgentAction(propertyId, selected);
      if (result.ok) {
        toast.success("Primary agent updated");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onUnassign() {
    setError(null);
    startTransition(async () => {
      const result = await unassignPrimaryAgentAction(propertyId);
      if (result.ok) {
        toast.success("Agent unassigned");
        setSelected("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <UserCog className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium text-foreground">Primary agent</h2>
      </div>
      <p className="text-xs text-text-muted">
        {currentAgentName
          ? `Currently assigned to ${currentAgentName}. This person is dialed first when a guest calls.`
          : "No agent assigned. Calls to this property won't reach a primary agent until one is assigned."}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent">Agent</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="agent">
            <SelectValue placeholder="Choose an agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.full_name} ({a.role === "ADMIN" ? "Admin" : "Agent"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onSave}
          disabled={pending || selected === (currentAgentId ?? "")}
        >
          {pending ? "Saving…" : "Save assignment"}
        </Button>
        {currentAgentId ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Unassign
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unassign the primary agent?</AlertDialogTitle>
                <AlertDialogDescription>
                  Calls to this property won&apos;t reach a primary agent until
                  you assign a new one. You can reassign at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onUnassign} disabled={pending}>
                  Unassign
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Fetch assignment data and render the card**

Replace the entire contents of `apps/portal/app/(admin)/admin/properties/[id]/page.tsx` with:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertyForm } from "../property-form";
import { AssignmentCard, type AgentOption } from "./assignment-card";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, name, timezone, owner_user_id, routing_did, property_phone_number, after_hours_support_phone, kiosk_welcome_message, kiosk_apology_message, active",
    )
    .eq("id", id)
    .maybeSingle();

  if (!property) {
    notFound();
  }

  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("operator_id", actor.operator_id)
    .eq("role", "OWNER")
    .eq("active", true)
    .order("full_name");

  // Assignable primary agents: active AGENTs and ADMINs in this operator.
  const { data: agents } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("operator_id", actor.operator_id)
    .in("role", ["AGENT", "ADMIN"])
    .eq("active", true)
    .order("full_name");

  // Current active assignment (effective_until IS NULL).
  const { data: assignment } = await supabase
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", id)
    .is("effective_until", null)
    .maybeSingle();

  const currentAgentId = assignment?.primary_agent_id ?? null;

  // Separate name lookup (2-query pattern): robust even if the assigned agent
  // was later deactivated and so is absent from the assignable list above.
  let currentAgentName: string | null = null;
  if (currentAgentId) {
    const { data: agent } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", currentAgentId)
      .maybeSingle();
    currentAgentName = agent?.full_name ?? null;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href={"/admin/properties" as never}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Properties
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          {property.name}
        </h1>
      </div>

      <PropertyForm mode="edit" owners={owners ?? []} property={property} />

      <AssignmentCard
        propertyId={property.id}
        currentAgentId={currentAgentId}
        currentAgentName={currentAgentName}
        agents={(agents ?? []) as AgentOption[]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(admin)/admin/properties/[id]/assignment-card.tsx" "apps/portal/app/(admin)/admin/properties/[id]/page.tsx"
git commit -m "feat(assignments): add primary-agent card to property detail page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Call-availability section on the `/admin` overview

**Files:**
- Create: `apps/portal/app/(admin)/admin/availability-cards.tsx`
- Modify: `apps/portal/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Create the availability client component**

Create `apps/portal/app/(admin)/admin/availability-cards.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setCallAvailabilityAction } from "./properties/actions";

export type AvailabilityRow = {
  propertyId: string;
  propertyName: string;
  accepting: boolean;
};

export function AvailabilityCards({ rows }: { rows: AvailabilityRow[] }) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.propertyId, r.accepting])),
  );
  const [, startTransition] = useTransition();

  function onToggle(propertyId: string, next: boolean) {
    const prev = state[propertyId];
    // Optimistic: flip immediately, roll back on failure (spec §9.4).
    setState((s) => ({ ...s, [propertyId]: next }));
    startTransition(async () => {
      const result = await setCallAvailabilityAction(propertyId, next);
      if (!result.ok) {
        setState((s) => ({ ...s, [propertyId]: prev }));
        toast.error(result.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        No active properties yet. Add a property to set your call availability.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
      {rows.map((r) => (
        <div
          key={r.propertyId}
          className="flex items-center justify-between gap-3 p-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {r.propertyName}
            </span>
            <span className="text-xs text-text-muted">
              {state[r.propertyId] ? "Accepting calls" : "Not accepting calls"}
            </span>
          </div>
          <Switch
            checked={state[r.propertyId]}
            onCheckedChange={(v) => onToggle(r.propertyId, v)}
            aria-label={`Accept calls for ${r.propertyName}`}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Convert `/admin` to a Server Component with the availability section**

Replace the entire contents of `apps/portal/app/(admin)/admin/page.tsx` with:

```tsx
import Link from "next/link";
import { ArrowRight, Building2, PhoneCall, Users } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { AvailabilityCards, type AvailabilityRow } from "./availability-cards";

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name")
    .eq("operator_id", actor.operator_id)
    .eq("active", true)
    .order("name");

  const { data: availability } = await supabase
    .from("admin_call_availability")
    .select("property_id, accepting_calls")
    .eq("profile_id", actor.id);

  const acceptingByProperty = new Map(
    (availability ?? []).map((a) => [a.property_id, a.accepting_calls]),
  );

  const rows: AvailabilityRow[] = (properties ?? []).map((p) => ({
    propertyId: p.id,
    propertyName: p.name,
    accepting: acceptingByProperty.get(p.id) ?? false,
  }));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Admin overview
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage users, properties, and assignments for your operator.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href={"/admin/users" as never}
          className="group flex items-start justify-between rounded-lg border border-border bg-card p-5 transition hover:border-primary"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Users</span>
            </div>
            <p className="text-xs text-text-muted">
              Invite admins, agents, and owners. Edit roles. Deactivate or
              remove access.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
        </Link>

        <Link
          href={"/admin/properties" as never}
          className="group flex items-start justify-between rounded-lg border border-border bg-card p-5 transition hover:border-primary"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Properties
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Add and edit the hotels and venues you serve — routing numbers,
              owners, and kiosk messaging.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">
            Your call availability
          </h2>
        </div>
        <p className="text-xs text-text-muted">
          Turn this on for each property you&apos;re covering. When on, you&apos;re
          added to the dial alongside the primary agent when a guest calls.
        </p>
        <AvailabilityCards rows={rows} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(admin)/admin/availability-cards.tsx" "apps/portal/app/(admin)/admin/page.tsx"
git commit -m "feat(availability): add per-property call-availability toggle to admin overview

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full test suite + manual smoke + tag

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite, lint, and typecheck**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: all Vitest tests pass (including the new `assignments` tests); no lint or type errors.

- [ ] **Step 2: Start the dev server**

Run (from repo root): `pnpm dev:portal`
Expected: Next.js dev server on http://localhost:3000. Ensure `pnpm supabase:start` is still running.

- [ ] **Step 3: Manual smoke (Playwright MCP or browser), signed in as `admin@lobbyconnect.local` / `localdev123`**

Work through each and confirm:

1. Go to `/admin/properties/<sample hotel id>`. The "Primary agent" card shows the empty state ("No agent assigned").
2. Pick "Alex Agent" → **Save assignment**. Toast "Primary agent updated"; card text now names Alex; an **Unassign** button appears.
3. Pick "Bailey Agent" → **Save assignment**. Card now names Bailey (reassign).
4. Pick "Local Admin" (an ADMIN) → **Save assignment** succeeds (admins are assignable).
5. Click **Unassign** → confirm in the dialog. Card returns to the empty state.
6. Go to `/admin`. The "Your call availability" section lists "The Sample Hotel" with an off switch. Toggle it **on** — it stays on after a full page reload; toggle **off** — stays off after reload.

- [ ] **Step 4: Verify the database side effects (local Studio SQL editor)**

```sql
select action, entity_type, details from audit_logs
where entity_type = 'property_assignment' order by created_at;
```
Expected: rows for `assignment.created` (Alex), `assignment.changed` (Bailey, with `previous_agent_id` = Alex), `assignment.changed` (Admin), `assignment.removed`.

```sql
select count(*) from audit_logs where action like 'availability%';
```
Expected: `0` — the toggle is never audited.

```sql
select count(*) from property_assignments
where property_id = '00000000-0000-0000-0000-0000000000c1' and effective_until is null;
```
Expected: `0` after the final unassign (and never more than `1` at any point).

- [ ] **Step 5: Verify the invariant index rejects a second active row (local Studio SQL editor)**

```sql
insert into property_assignments (operator_id, property_id, primary_agent_id)
values ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b3');
insert into property_assignments (operator_id, property_id, primary_agent_id)
values ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b4');
```
Expected: the **second** insert fails with `duplicate key value violates unique constraint "property_assignments_one_active"`. Then clean up:
```sql
update property_assignments set effective_until = now()
where property_id = '00000000-0000-0000-0000-0000000000c1' and effective_until is null;
```

- [ ] **Step 6: Update status docs**

In `CLAUDE.md`, mark Plan 4c complete in the build-status table and set Plan 5 as next. Update the memory file `project-status.md` (last shipped = 4c, note migration 0005 is local-only and must be applied before any prod push, and that the seed now includes an OWNER + two AGENTs). Commit:

```bash
git add CLAUDE.md
git commit -m "docs(claude): mark Plan 4c complete, Plan 5 next

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Tag the completed plan**

```bash
git tag plan-04c-assignments-availability-complete
```
(Do NOT push — the standing policy keeps `main` and the local migrations un-pushed until prod-DB migration is coordinated; see project-status.)

---

## Definition of Done

- Migration 0005 applied locally; `property_assignments_one_active` index present.
- `seed.sql` yields ADMIN + OWNER + two AGENTs after `db reset`; sample property owned by the OWNER.
- `lib/assignments` unit tests pass; full `pnpm test`, `pnpm lint`, `pnpm typecheck` clean.
- Assignment card: assign / reassign / unassign all work and are audited (`assignment.created|changed|removed`).
- Availability section: per-property optimistic toggle persists across reload and writes **no** audit rows.
- Invariant verified: a second active assignment row is rejected by the index.
- Committed and tagged `plan-04c-assignments-availability-complete` on local `main` (not pushed).
