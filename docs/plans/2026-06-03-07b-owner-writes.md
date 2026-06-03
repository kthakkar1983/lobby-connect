# Owner Self-Service Writes (7b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hotel owner self-serve the three writes 7a deferred — edit guest-facing kiosk content, upload/view the playbook PDF, and resolve emergency incidents — without ever being able to touch operational fields.

**Architecture:** Approach A (locked in the 2026-06-03 brainstorm): kiosk-edit and incident-resolve go through Server Actions on the **user-scoped** Supabase client against new owner `UPDATE` RLS policies, with `BEFORE UPDATE` column-guard triggers enforcing column-level scope (RLS is row-level only). The playbook route is the lone service-role surface (binary upload to a private bucket + canonical-path enforcement). Pure validators (`lib/owner/`, TDD) back every write.

**Tech Stack:** Next.js 15.5 App Router (RSC + Server Actions, async `params`), Supabase (Postgres RLS + triggers + Storage), Tailwind + shadcn (`Input`, `Textarea`, `Label`, `Button`, `Badge`), lucide-react, Vitest.

**Spec:** `docs/specs/2026-06-03-07b-owner-writes-design.md`

---

## Conventions for every task

- **Commands** (run from `apps/portal/`): `pnpm test` (all Vitest), `pnpm test -- <path>` (one file), `pnpm typecheck`, `pnpm lint`.
- **Imports:** shared types from `@lc/shared`; app code via `@/…`.
- **Tokens only** — no raw hex (`text-foreground`, `text-text-muted`, `border-border`, `bg-card`, `text-destructive`, `text-primary`).
- **Typed-routes:** internal `<Link>`/`router.push` to owner routes use `as never` per the CLAUDE.md convention.
- **Next 15 async APIs:** `params` is a Promise — always `await`.
- **Audit:** call `logAuditEvent` after a successful write (actions) / inside the route (playbook). Cast detail objects `as Json`.
- **Owners are not call-takers** — no Softphone/Video changes here.

## Seed fixtures (local dev)

| Thing | UUID |
|---|---|
| Operator | `00000000-0000-0000-0000-0000000000a0` |
| Olivia Owner (`owner@lobbyconnect.local` / `localdev123`) | `00000000-0000-0000-0000-0000000000b2` |
| The Sample Hotel (owned by Olivia) | `00000000-0000-0000-0000-0000000000c1` |
| Alex Agent (assigned primary) | `00000000-0000-0000-0000-0000000000b3` |

## File structure (locked)

```
supabase/migrations/0010_owner_writes.sql                 ← column + 2 RLS policies + 2 column-guard triggers   (Task 4)
packages/shared/src/supabase-types.ts                     ← + incidents.resolution_note (manual edit)            (Task 4)
apps/portal/
  lib/owner/
    kiosk.ts        ← KioskContentInput, KIOSK_FIELDS, validateKioskFields            (Task 1)
    playbook.ts     ← validatePlaybookFile, playbookStorageKey, MAX_PLAYBOOK_BYTES    (Task 2)
    incidents.ts    ← validateResolutionNote, MAX_RESOLUTION_NOTE                      (Task 3)
  tests/owner/
    kiosk.test.ts (Task 1)   playbook.test.ts (Task 2)   incidents.test.ts (Task 3)
  app/(owner)/owner/properties/[id]/
    actions.ts             ← updateKioskContentAction                                  (Task 5)
    kiosk-content-card.tsx ← inline-edit client card                                   (Task 5)
    playbook-card.tsx      ← view + upload client card                                 (Task 7)
    page.tsx               ← swap static sections for the two client cards             (Tasks 5, 7)
  app/api/owner/properties/[id]/playbook/route.ts          ← POST upload + GET signed URL (service role)  (Task 6)
  tests/app/owner/playbook-route.test.ts                                                 (Task 6)
  app/(owner)/owner/incidents/[id]/
    actions.ts             ← resolveIncidentAction                                     (Task 8)
    resolve-incident.tsx   ← resolve control client                                    (Task 8)
    page.tsx               ← render <ResolveIncident> + resolution_note                 (Task 8)
```

---

### Task 1: `lib/owner/kiosk.ts` — kiosk-field validation

**Files:**
- Create: `apps/portal/lib/owner/kiosk.ts`
- Test: `apps/portal/tests/owner/kiosk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/kiosk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateKioskFields,
  KIOSK_FIELDS,
  type KioskContentInput,
} from "@/lib/owner/kiosk";

function valid(): KioskContentInput {
  return {
    kiosk_welcome_heading: "Welcome",
    kiosk_welcome_message: "How can we help?",
    kiosk_checkin_time: "3:00 PM",
    kiosk_checkout_time: "11:00 AM",
    kiosk_wifi_network: "Hotel-Guest",
    kiosk_wifi_password: "sunshine123",
    kiosk_breakfast_hours: "7-10 AM",
    kiosk_apology_message: "Sorry, no one is available.",
  };
}

describe("KIOSK_FIELDS", () => {
  it("lists the 8 guest-facing kiosk columns", () => {
    expect(KIOSK_FIELDS).toHaveLength(8);
    expect(KIOSK_FIELDS).toContain("kiosk_welcome_heading");
    expect(KIOSK_FIELDS).toContain("kiosk_apology_message");
  });
});

describe("validateKioskFields", () => {
  it("accepts a valid payload", () => {
    expect(validateKioskFields(valid())).toBeNull();
  });

  it("accepts all-empty (every field clears to null)", () => {
    const empty = Object.fromEntries(
      KIOSK_FIELDS.map((f) => [f, ""]),
    ) as KioskContentInput;
    expect(validateKioskFields(empty)).toBeNull();
  });

  it("rejects an over-long welcome message (280 cap)", () => {
    const input = { ...valid(), kiosk_welcome_message: "x".repeat(281) };
    expect(validateKioskFields(input)).toMatch(/280/);
  });

  it("rejects an over-long short field (80 cap)", () => {
    const input = { ...valid(), kiosk_checkin_time: "x".repeat(81) };
    expect(validateKioskFields(input)).toMatch(/80/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/owner/kiosk.test.ts`
Expected: FAIL — `Cannot find module '@/lib/owner/kiosk'`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/owner/kiosk.ts`:

```ts
import { validateKioskMessage } from "@/lib/properties/validate";

// The 8 guest-facing kiosk fields an owner may edit. Must stay in sync with the
// whitelist in supabase/migrations/0010_owner_writes.sql (the column-guard trigger).
export const KIOSK_FIELDS = [
  "kiosk_welcome_heading",
  "kiosk_welcome_message",
  "kiosk_checkin_time",
  "kiosk_checkout_time",
  "kiosk_wifi_network",
  "kiosk_wifi_password",
  "kiosk_breakfast_hours",
  "kiosk_apology_message",
] as const;

export type KioskContentInput = Record<(typeof KIOSK_FIELDS)[number], string>;

const SHORT_MAX = 80; // heading, check-in/out, wifi, breakfast — single-line values

function validateShort(label: string, value: string): string | null {
  if (value.trim().length > SHORT_MAX) {
    return `${label} must be ${SHORT_MAX} characters or fewer.`;
  }
  return null;
}

// welcome/apology reuse the 280-char rule from the admin property form;
// the rest are short single-line fields.
export function validateKioskFields(input: KioskContentInput): string | null {
  return (
    validateShort("Welcome heading", input.kiosk_welcome_heading) ??
    validateKioskMessage(input.kiosk_welcome_message) ??
    validateShort("Check-in time", input.kiosk_checkin_time) ??
    validateShort("Check-out time", input.kiosk_checkout_time) ??
    validateShort("Wi-Fi network", input.kiosk_wifi_network) ??
    validateShort("Wi-Fi password", input.kiosk_wifi_password) ??
    validateShort("Breakfast hours", input.kiosk_breakfast_hours) ??
    validateKioskMessage(input.kiosk_apology_message)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/owner/kiosk.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/kiosk.ts apps/portal/tests/owner/kiosk.test.ts
git commit -m "feat(7b): kiosk-field validation helper (TDD)"
```

---

### Task 2: `lib/owner/playbook.ts` — playbook file validation + storage key

**Files:**
- Create: `apps/portal/lib/owner/playbook.ts`
- Test: `apps/portal/tests/owner/playbook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/playbook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validatePlaybookFile,
  playbookStorageKey,
  MAX_PLAYBOOK_BYTES,
} from "@/lib/owner/playbook";

describe("validatePlaybookFile", () => {
  it("accepts a small PDF", () => {
    expect(validatePlaybookFile({ type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("rejects a non-PDF", () => {
    expect(validatePlaybookFile({ type: "image/png", size: 1024 })).toMatch(/PDF/);
  });

  it("rejects an empty file", () => {
    expect(validatePlaybookFile({ type: "application/pdf", size: 0 })).toMatch(/empty/i);
  });

  it("rejects a file over the size cap", () => {
    expect(
      validatePlaybookFile({ type: "application/pdf", size: MAX_PLAYBOOK_BYTES + 1 }),
    ).toMatch(/10 MB/);
  });
});

describe("playbookStorageKey", () => {
  it("builds the canonical <operator>/<property>/playbook.pdf key", () => {
    expect(playbookStorageKey("op-1", "prop-1")).toBe("op-1/prop-1/playbook.pdf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/owner/playbook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/owner/playbook.ts`:

```ts
export const MAX_PLAYBOOK_BYTES = 10 * 1024 * 1024; // 10 MB

export function validatePlaybookFile(file: {
  type: string;
  size: number;
}): string | null {
  if (file.type !== "application/pdf") return "Playbook must be a PDF.";
  if (file.size === 0) return "File is empty.";
  if (file.size > MAX_PLAYBOOK_BYTES) return "Playbook must be 10 MB or smaller.";
  return null;
}

// Canonical key already used in production (see 6b). One PDF per property.
export function playbookStorageKey(
  operatorId: string,
  propertyId: string,
): string {
  return `${operatorId}/${propertyId}/playbook.pdf`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/owner/playbook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/playbook.ts apps/portal/tests/owner/playbook.test.ts
git commit -m "feat(7b): playbook file validation + storage-key helper (TDD)"
```

---

### Task 3: `lib/owner/incidents.ts` — resolution-note validation

**Files:**
- Create: `apps/portal/lib/owner/incidents.ts`
- Test: `apps/portal/tests/owner/incidents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/incidents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateResolutionNote, MAX_RESOLUTION_NOTE } from "@/lib/owner/incidents";

describe("validateResolutionNote", () => {
  it("accepts an empty/absent note (note is optional)", () => {
    expect(validateResolutionNote("")).toBeNull();
    expect(validateResolutionNote(null)).toBeNull();
    expect(validateResolutionNote(undefined)).toBeNull();
  });

  it("accepts a normal note", () => {
    expect(validateResolutionNote("Spoke with guest; all clear.")).toBeNull();
  });

  it("rejects an over-long note", () => {
    expect(validateResolutionNote("x".repeat(MAX_RESOLUTION_NOTE + 1))).toMatch(/1000/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/owner/incidents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/owner/incidents.ts`:

```ts
export const MAX_RESOLUTION_NOTE = 1000;

export function validateResolutionNote(
  note: string | null | undefined,
): string | null {
  if (!note) return null;
  if (note.trim().length > MAX_RESOLUTION_NOTE) {
    return "Note must be 1000 characters or fewer.";
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/owner/incidents.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/incidents.ts apps/portal/tests/owner/incidents.test.ts
git commit -m "feat(7b): incident resolution-note validation helper (TDD)"
```

---

### Task 4: Migration `0010_owner_writes.sql` — RLS + column-guard triggers

**Files:**
- Create: `supabase/migrations/0010_owner_writes.sql`
- Modify: `packages/shared/src/supabase-types.ts` (add `incidents.resolution_note`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_owner_writes.sql`:

```sql
-- 0010_owner_writes.sql — Plan 7b (owner self-service writes).
-- Adds: incidents.resolution_note; owner UPDATE policies on properties + incidents;
-- BEFORE UPDATE column-guard triggers. RLS is row-level only, so the triggers are
-- what restrict an OWNER (even via direct PostgREST) to the kiosk fields / resolve.
-- Service-role writes have auth.uid() = NULL -> current_user_role() = NULL, never
-- 'OWNER', so they skip both guards. Idempotent.

-- 1. Owner's optional resolution note. Kept separate from the system `notes` the
--    emergency route writes at creation, so resolving never clobbers diagnostics.
alter table incidents
  add column if not exists resolution_note text;

-- 2. properties: owner UPDATE row policy (column scope enforced by trigger below).
drop policy if exists "properties_owner_update" on properties;
create policy "properties_owner_update" on properties
  for update to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and owner_user_id = auth.uid()
  )
  with check (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and owner_user_id = auth.uid()
  );

-- 3. incidents: owner UPDATE row policy. user_owns_property() is the 0004
--    SECURITY DEFINER helper (avoids the policy-recursion trap).
drop policy if exists "incidents_owner_update" on incidents;
create policy "incidents_owner_update" on incidents
  for update to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and user_owns_property(incidents.property_id)
  )
  with check (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and user_owns_property(incidents.property_id)
  );

-- 4. properties column guard: an OWNER may change ONLY the 8 kiosk_* fields.
--    Diff every OTHER column via jsonb subtraction, so any future column is
--    protected by default until added to this whitelist.
create or replace function enforce_owner_property_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() = 'OWNER' then
    if (to_jsonb(old) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message'
        ]::text[])
       is distinct from
       (to_jsonb(new) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message'
        ]::text[])
    then
      raise exception 'owners may only edit guest-facing kiosk fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_owner_property_columns on properties;
create trigger trg_enforce_owner_property_columns
  before update on properties
  for each row execute function enforce_owner_property_columns();

-- 5. incidents column guard: an OWNER may change ONLY status/resolved_at/
--    resolution_note, and NEVER an already-RESOLVED incident (resolve is final).
create or replace function enforce_owner_incident_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() = 'OWNER' then
    if old.status = 'RESOLVED' then
      raise exception 'resolved incidents are final';
    end if;
    if (to_jsonb(old) - array['status','resolved_at','resolution_note']::text[])
       is distinct from
       (to_jsonb(new) - array['status','resolved_at','resolution_note']::text[])
    then
      raise exception 'owners may only resolve an incident';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_owner_incident_columns on incidents;
create trigger trg_enforce_owner_incident_columns
  before update on incidents
  for each row execute function enforce_owner_incident_columns();
```

- [ ] **Step 2: Apply the migration to the local DB**

Apply without wiping data (preserves the uploaded playbook PDF — see the build-quirks note):

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/migrations/0010_owner_writes.sql
```
Expected: `ALTER TABLE`, `CREATE POLICY` (x2), `CREATE FUNCTION` (x2), `CREATE TRIGGER` (x2), no errors.
(Clean-slate alternative: `supabase db reset` — but that wipes Storage; re-upload the sample PDF per the project-status runbook.)

- [ ] **Step 3: Verify the policies + triggers exist**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select polname from pg_policy where polname like '%owner_update%';
   select tgname from pg_trigger where tgname like 'trg_enforce_owner%';"
```
Expected: `properties_owner_update`, `incidents_owner_update`, `trg_enforce_owner_property_columns`, `trg_enforce_owner_incident_columns`.

- [ ] **Step 4: Verify the column guard (negative + positive) by simulating Olivia's JWT**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

-- NEGATIVE: changing a non-kiosk column must be rejected by the trigger.
do $$ begin
  update properties set active = false
   where id = '00000000-0000-0000-0000-0000000000c1';
  raise exception 'TEST FAILED: active change was allowed';
exception when others then
  raise notice 'OK rejected: %', sqlerrm;
end $$;

-- POSITIVE: a kiosk-only change succeeds.
update properties set kiosk_wifi_network = 'Guest-WiFi-7b'
 where id = '00000000-0000-0000-0000-0000000000c1';
SQL
```
Expected: `NOTICE: OK rejected: owners may only edit guest-facing kiosk fields`, then `UPDATE 1`. (No `TEST FAILED`.)

- [ ] **Step 5: Add `resolution_note` to the hand-maintained types**

In `packages/shared/src/supabase-types.ts`, inside `incidents:` add `resolution_note` to all three shapes:
- `Row`: add `resolution_note: string | null;` after `notes: string | null;`
- `Insert`: add `resolution_note?: string | null;`
- `Update`: add `resolution_note?: string | null;`

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors from the new column).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0010_owner_writes.sql packages/shared/src/supabase-types.ts
git commit -m "feat(7b): migration 0010 — owner UPDATE RLS + column-guard triggers"
```

---

### Task 5: Kiosk content editing — Server Action + inline-edit card

**Files:**
- Create: `apps/portal/app/(owner)/owner/properties/[id]/actions.ts`
- Create: `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx`
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`

- [ ] **Step 1: Write the Server Action**

Create `apps/portal/app/(owner)/owner/properties/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { Database, Json } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  KIOSK_FIELDS,
  validateKioskFields,
  type KioskContentInput,
} from "@/lib/owner/kiosk";

type PropertyUpdate = Database["public"]["Tables"]["properties"]["Update"];

export type ActionResult = { ok: true } | { ok: false; error: string };

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateKioskContentAction(
  propertyId: string,
  input: KioskContentInput,
): Promise<ActionResult> {
  const actor = await requireRole("OWNER");

  const validationError = validateKioskFields(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  // RLS scopes this read to Olivia's own properties; a foreign id returns no row.
  const { data: current } = await supabase
    .from("properties")
    .select(KIOSK_FIELDS.join(", "))
    .eq("id", propertyId)
    .maybeSingle<Record<(typeof KIOSK_FIELDS)[number], string | null>>();

  if (!current) return { ok: false, error: "Property not found." };

  const updates: PropertyUpdate = {};
  const audits: Array<{ field: string; from: string | null; to: string | null }> =
    [];

  for (const field of KIOSK_FIELDS) {
    const next = emptyToNull(input[field]);
    if (next !== current[field]) {
      (updates as Record<string, unknown>)[field] = next;
      audits.push({ field, from: current[field], to: next });
    }
  }

  if (audits.length === 0) return { ok: true };

  const { error } = await supabase
    .from("properties")
    .update(updates)
    .eq("id", propertyId);

  if (error) {
    return { ok: false, error: "Couldn't save — please refresh and try again." };
  }

  for (const a of audits) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: "property.kiosk_edited",
      entityType: "property",
      entityId: propertyId,
      details: a as unknown as Json,
    });
  }

  revalidatePath(`/owner/properties/${propertyId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Write the inline-edit card**

Create `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KIOSK_FIELDS, type KioskContentInput } from "@/lib/owner/kiosk";
import { updateKioskContentAction } from "./actions";

const LABELS: Record<(typeof KIOSK_FIELDS)[number], string> = {
  kiosk_welcome_heading: "Welcome heading",
  kiosk_welcome_message: "Welcome message",
  kiosk_checkin_time: "Check-in",
  kiosk_checkout_time: "Check-out",
  kiosk_wifi_network: "Wi-Fi network",
  kiosk_wifi_password: "Wi-Fi password",
  kiosk_breakfast_hours: "Breakfast hours",
  kiosk_apology_message: "Apology message",
};

const LONG_FIELDS = new Set(["kiosk_welcome_message", "kiosk_apology_message"]);

type Props = { propertyId: string; initial: KioskContentInput };

export function KioskContentCard({ propertyId, initial }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<KioskContentInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(field: (typeof KIOSK_FIELDS)[number], v: string) {
    setValues((prev) => ({ ...prev, [field]: v }));
  }

  function cancel() {
    setValues(initial);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateKioskContentAction(propertyId, values);
      if (result.ok) {
        toast.success("Kiosk content updated");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">
          Guest-facing kiosk content
        </h2>
        {editing ? null : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {KIOSK_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={field}>{LABELS[field]}</Label>
            {editing ? (
              LONG_FIELDS.has(field) ? (
                <Textarea
                  id={field}
                  rows={2}
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                />
              ) : (
                <Input
                  id={field}
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                />
              )
            ) : (
              <span className="text-sm text-foreground">
                {initial[field].length > 0 ? initial[field] : "—"}
              </span>
            )}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Wire the card into the property detail page**

In `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`:
1. Add import: `import { KioskContentCard } from "./kiosk-content-card";` and `import { KIOSK_FIELDS, type KioskContentInput } from "@/lib/owner/kiosk";`
2. After `if (!property) notFound();`, build the initial input (null → ""):

```tsx
  const kioskInitial = Object.fromEntries(
    KIOSK_FIELDS.map((f) => [f, (property[f] as string | null) ?? ""]),
  ) as KioskContentInput;
```

3. Replace the entire static `<section>` headed `Guest-facing kiosk content` (the grid of `<Field>`s plus the "Editing these is coming in the owner self-service update (7b)." `<p>`) with:

```tsx
      <KioskContentCard propertyId={property.id} initial={kioskInitial} />
```

(Leave the basics grid and "Recent calls" section unchanged. The `property` select already includes all 8 kiosk fields and `id`.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run `pnpm dev`, sign in as Olivia, open the property detail, click **Edit**, change Wi-Fi network, **Save** → toast + value persists after refresh. **Cancel** discards edits.

- [ ] **Step 6: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/actions.ts" \
        "apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx" \
        "apps/portal/app/(owner)/owner/properties/[id]/page.tsx"
git commit -m "feat(7b): owner inline kiosk-content editing"
```

---

### Task 6: Playbook route — `POST` upload + `GET` signed URL (service role)

**Files:**
- Create: `apps/portal/app/api/owner/properties/[id]/playbook/route.ts`
- Test: `apps/portal/tests/app/owner/playbook-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/owner/playbook-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null = null;
let propertyRow: Record<string, unknown> | null = null;
const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }),
          }),
        };
      }
      // properties
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
        }),
        update: updateMock,
      };
    },
    storage: { from: () => ({ upload: uploadMock, createSignedUrl: createSignedUrlMock }) },
  }),
}));

vi.mock("@/lib/auth/audit", () => ({ logAuditEvent: vi.fn() }));

import { GET, POST } from "@/app/api/owner/properties/[id]/playbook/route";

const PROP = "00000000-0000-0000-0000-0000000000c1";

function getReq() {
  return GET(new Request(`http://localhost/api/owner/properties/${PROP}/playbook`), {
    params: Promise.resolve({ id: PROP }),
  });
}

function postReq(file: File | null) {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return POST(
    new Request(`http://localhost/api/owner/properties/${PROP}/playbook`, {
      method: "POST",
      body: fd,
    }),
    { params: Promise.resolve({ id: PROP }) },
  );
}

function pdf(bytes = 1024) {
  return new File([new Uint8Array(bytes)], "p.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  getUser.mockReset();
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  updateMock.mockClear();
  updateEqMock.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  profileRow = { id: "owner-1", operator_id: "op-1", role: "OWNER" };
  propertyRow = {
    id: PROP,
    operator_id: "op-1",
    owner_user_id: "owner-1",
    playbook_pdf_url: "op-1/" + PROP + "/playbook.pdf",
    playbook_version: 2,
  };
  uploadMock.mockResolvedValue({ data: { path: "x" }, error: null });
  updateEqMock.mockResolvedValue({ error: null });
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://x/signed.pdf" },
    error: null,
  });
});

describe("POST /api/owner/properties/[id]/playbook", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await postReq(pdf())).status).toBe(401);
  });

  it("403 when the caller is not the property owner", async () => {
    propertyRow = { ...propertyRow, owner_user_id: "someone-else" };
    expect((await postReq(pdf())).status).toBe(403);
  });

  it("400 on a non-PDF", async () => {
    const png = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    expect((await postReq(png)).status).toBe(400);
  });

  it("400 on an oversize file", async () => {
    const big = pdf(10 * 1024 * 1024 + 1);
    expect((await postReq(big)).status).toBe(400);
  });

  it("uploads and bumps the version", async () => {
    const res = await postReq(pdf());
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(3);
    expect(uploadMock).toHaveBeenCalledWith(
      "op-1/" + PROP + "/playbook.pdf",
      expect.anything(),
      expect.objectContaining({ contentType: "application/pdf", upsert: true }),
    );
    expect(updateMock).toHaveBeenCalled();
  });
});

describe("GET /api/owner/properties/[id]/playbook", () => {
  it("403 when not the owner", async () => {
    propertyRow = { ...propertyRow, owner_user_id: "someone-else" };
    expect((await getReq()).status).toBe(403);
  });

  it("hasPlaybook:false when none set", async () => {
    propertyRow = { ...propertyRow, playbook_pdf_url: null };
    const body = await (await getReq()).json();
    expect(body.hasPlaybook).toBe(false);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns a signed URL", async () => {
    const body = await (await getReq()).json();
    expect(body.hasPlaybook).toBe(true);
    expect(body.signedUrl).toBe("https://x/signed.pdf");
    expect(body.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/app/owner/playbook-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/owner/properties/[id]/playbook/route'`.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/owner/properties/[id]/playbook/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { validatePlaybookFile, playbookStorageKey } from "@/lib/owner/playbook";

export const runtime = "nodejs";

const SIGNED_URL_TTL = 3600; // 1 hour

type Ctx = { params: Promise<{ id: string }> };

// Resolves the authenticated OWNER + their owned property, or a NextResponse error.
async function resolveOwnerProperty(propertyId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id, role")
    .eq("id", user.id)
    .maybeSingle();

  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, owner_user_id, playbook_pdf_url, playbook_version")
    .eq("id", propertyId)
    .maybeSingle();

  if (
    !me ||
    !property ||
    me.role !== "OWNER" ||
    property.operator_id !== me.operator_id ||
    property.owner_user_id !== user.id
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin, user, property };
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveOwnerProperty(id);
  if ("error" in resolved) return resolved.error;
  const { admin, property } = resolved;

  if (!property.playbook_pdf_url) {
    return NextResponse.json({ hasPlaybook: false });
  }

  const { data: signed, error } = await admin.storage
    .from("playbooks")
    .createSignedUrl(property.playbook_pdf_url as string, SIGNED_URL_TTL);

  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Could not generate playbook URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    hasPlaybook: true,
    signedUrl: signed.signedUrl,
    version: property.playbook_version,
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveOwnerProperty(id);
  if ("error" in resolved) return resolved.error;
  const { admin, user, property } = resolved;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const fileError = validatePlaybookFile({ type: file.type, size: file.size });
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const key = playbookStorageKey(property.operator_id as string, property.id as string);
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from("playbooks")
    .upload(key, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const nextVersion = ((property.playbook_version as number | null) ?? 0) + 1;
  const { error: updateError } = await admin
    .from("properties")
    .update({ playbook_pdf_url: key, playbook_version: nextVersion })
    .eq("id", property.id as string);
  if (updateError) {
    return NextResponse.json({ error: "Could not save playbook." }, { status: 500 });
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "property.playbook_uploaded",
    entityType: "property",
    entityId: property.id as string,
    details: { version: nextVersion },
  });

  return NextResponse.json({ ok: true, version: nextVersion });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/app/owner/playbook-route.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/owner/properties/[id]/playbook/route.ts" \
        apps/portal/tests/app/owner/playbook-route.test.ts
git commit -m "feat(7b): owner playbook upload + signed-URL route (service role, TDD)"
```

---

### Task 7: Playbook card — view + upload

**Files:**
- Create: `apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx`
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`

- [ ] **Step 1: Write the playbook card**

Create `apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { validatePlaybookFile } from "@/lib/owner/playbook";

type Props = { propertyId: string; version: number | null };

export function PlaybookCard({ propertyId, version }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [viewing, setViewing] = useState(false);

  async function view() {
    setViewing(true);
    try {
      const res = await fetch(`/api/owner/properties/${propertyId}/playbook`);
      const body = await res.json();
      if (body.hasPlaybook && body.signedUrl) {
        window.open(body.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("No playbook uploaded yet.");
      }
    } catch {
      toast.error("Couldn't open the playbook.");
    } finally {
      setViewing(false);
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    const clientError = validatePlaybookFile({ type: file.type, size: file.size });
    if (clientError) {
      toast.error(clientError);
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/owner/properties/${propertyId}/playbook`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        toast.success("Playbook uploaded");
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Upload failed.");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Playbook</h2>
        <span className="text-sm text-text-muted">
          {version ? `v${version}` : "No playbook yet"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={view} disabled={viewing || !version}>
          {viewing ? "Opening…" : "View"}
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={pending}>
          {pending ? "Uploading…" : version ? "Replace" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPick}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the property page**

In `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`:
1. Add import: `import { PlaybookCard } from "./playbook-card";`
2. Remove the `Playbook` `<Field>` from the basics grid (the one rendering `property.playbook_version ? \`v${...}\` : "No playbook yet"`). The basics grid now has 3 `<Field>`s (Guest phone, After-hours, Timezone).
3. Add the card immediately after the basics `<section>` (before `<KioskContentCard>`):

```tsx
      <PlaybookCard propertyId={property.id} version={property.playbook_version} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual check**

As Olivia: **Upload** a PDF → toast + version shows `v{n+1}`; **View** opens it in a new tab. Then answer a video call as Alex (`alex.agent@…`) → the agent overlay's 60% panel renders the same PDF (the existing call-scoped route picks it up).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx" \
        "apps/portal/app/(owner)/owner/properties/[id]/page.tsx"
git commit -m "feat(7b): owner playbook view + upload card"
```

---

### Task 8: Incident resolve — Server Action + resolve control

**Files:**
- Create: `apps/portal/app/(owner)/owner/incidents/[id]/actions.ts`
- Create: `apps/portal/app/(owner)/owner/incidents/[id]/resolve-incident.tsx`
- Modify: `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`

- [ ] **Step 1: Write the Server Action**

Create `apps/portal/app/(owner)/owner/incidents/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logAuditEvent } from "@/lib/auth/audit";
import { validateResolutionNote } from "@/lib/owner/incidents";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function resolveIncidentAction(
  incidentId: string,
  note?: string,
): Promise<ActionResult> {
  const actor = await requireRole("OWNER");

  const noteError = validateResolutionNote(note);
  if (noteError) return { ok: false, error: noteError };

  const supabase = await createServerClient();

  // RLS scopes this to Olivia's owned incidents; a foreign id returns no row.
  const { data: current } = await supabase
    .from("incidents")
    .select("id, status")
    .eq("id", incidentId)
    .maybeSingle();

  if (!current) return { ok: false, error: "Incident not found." };
  if (current.status === "RESOLVED") return { ok: true }; // already final

  const trimmed = note?.trim();
  const { error } = await supabase
    .from("incidents")
    .update({
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
      resolution_note: trimmed && trimmed.length > 0 ? trimmed : null,
    })
    .eq("id", incidentId);

  if (error) {
    return { ok: false, error: "Couldn't resolve — please refresh and try again." };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: "incident.resolved",
    entityType: "incident",
    entityId: incidentId,
    details: { note_present: Boolean(trimmed && trimmed.length > 0) } as Json,
  });

  revalidatePath(`/owner/incidents/${incidentId}`);
  revalidatePath("/owner");
  return { ok: true };
}
```

- [ ] **Step 2: Write the resolve control**

Create `apps/portal/app/(owner)/owner/incidents/[id]/resolve-incident.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { resolveIncidentAction } from "./actions";

type Props = { incidentId: string; status: string };

export function ResolveIncident({ incidentId, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== "OPEN") return null;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await resolveIncidentAction(incidentId, note);
      if (result.ok) {
        toast.success("Incident resolved");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      {open ? (
        <>
          <Label htmlFor="resolution_note">Resolution note (optional)</Label>
          <Textarea
            id="resolution_note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened / how it was handled"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button onClick={confirm} disabled={pending}>
              {pending ? "Resolving…" : "Confirm resolve"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={() => setOpen(true)}>Resolve incident</Button>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire it into the incident detail page**

In `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`:
1. Add import: `import { ResolveIncident } from "./resolve-incident";`
2. Add `resolution_note` to the incident `select(...)` string (after `notes`).
3. Render the control after the status header `<section>` (so an OPEN incident shows the Resolve button near the top):

```tsx
      <ResolveIncident incidentId={incident.id} status={incident.status} />
```

   (`incident.id` is already selected.)
4. Render the resolution note when present — add after the existing `notes` block:

```tsx
      {incident.resolution_note && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Resolution note</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {incident.resolution_note}
          </p>
        </section>
      )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

As Olivia, open an OPEN incident → **Resolve incident** → optionally type a note → **Confirm resolve** → status badge flips to Resolved, `resolved_at` populates, the control disappears, the note renders. Return to Home → the open-incident badge clears after the 20s AutoRefresh (or refocus).

- [ ] **Step 6: Commit**

```bash
git add "apps/portal/app/(owner)/owner/incidents/[id]/actions.ts" \
        "apps/portal/app/(owner)/owner/incidents/[id]/resolve-incident.tsx" \
        "apps/portal/app/(owner)/owner/incidents/[id]/page.tsx"
git commit -m "feat(7b): owner incident resolve (optional note, final)"
```

---

### Task 9: Verify, smoke, and tag

**Files:** (docs only) `memory/project-status.md`, `CLAUDE.md`

- [ ] **Step 1: Full green check**

Run (from `apps/portal/`): `pnpm test && pnpm typecheck && pnpm lint`
Expected: all tests pass (the 210 from 7a + the new kiosk/playbook/incident helper tests + 8 playbook-route tests), typecheck clean, lint clean.

- [ ] **Step 2: End-to-end manual smoke (as Olivia — `owner@lobbyconnect.local` / `localdev123`)**

  - **Kiosk edit:** property detail → Edit → change Wi-Fi network + check-in → Save → persists. Start a kiosk session for The Sample Hotel → the home screen reflects the new values.
  - **Playbook:** Upload a PDF → version bumps + View opens it. Answer a video call as Alex → the agent overlay's playbook panel renders the new PDF.
  - **Incident resolve:** open the 6c incident (create one via the phone→Emergency `933` path if none exists) → Resolve with a note → status flips, Home badge clears after AutoRefresh.
  - **Security (the proof Approach A holds):** confirm Task 4 Step 4 still rejects a non-kiosk owner update; and that resolving an already-RESOLVED incident via the action is a no-op (UI hides the control).

- [ ] **Step 3: Update build-status docs**

  - `CLAUDE.md` build-status table: mark 7b complete with tag `plan-07b-owner-writes-complete` and a one-line summary (kiosk inline edit + playbook upload/view route + incident resolve; migration 0010 owner UPDATE RLS + column-guard triggers).
  - `memory/project-status.md`: add a "Plan 7b — COMPLETE" section mirroring the 7a entry (what shipped, files, smoke note); update "Next up".

- [ ] **Step 4: Commit + tag**

```bash
git add CLAUDE.md memory/project-status.md
git commit -m "docs(7b): mark owner self-service writes complete + update build-status"
git tag plan-07b-owner-writes-complete
```

---

## Self-review notes

- **Spec coverage:** Decisions 1–8 → Task 4 (RLS + triggers + finality + resolution_note + service-role boundary), Tasks 5/7/8 (the three writes), Task 6 (service-role route). Domain seam → kiosk whitelist in Task 1 + trigger in Task 4. Forward-compat seams are inherent (jsonb-diff trigger, separate `resolution_note`, versioned key). All covered.
- **Type consistency:** `KioskContentInput`/`KIOSK_FIELDS` defined in Task 1 and consumed unchanged in Tasks 5; `validatePlaybookFile`/`playbookStorageKey` (Task 2) consumed in Tasks 6/7; `validateResolutionNote` (Task 3) in Task 8; `incidents.resolution_note` (Task 4) used by Task 8 action + page. Action results all `{ ok: true } | { ok: false; error: string }`.
- **No placeholders:** every code step is complete; migration, route, and components are full files; page edits are precise diffs.
```
