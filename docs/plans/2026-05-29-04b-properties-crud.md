# Plan 4b — Properties CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins full management of `properties` — a searchable list, a create page, and a detail/edit page — with per-field audit logging, reusing the admin shell and patterns from Plan 4a.

**Architecture:** A list Server Component (`/admin/properties`) fetches rows via the user-scoped Supabase client and feeds a Client table. Create (`/admin/properties/new`) and edit (`/admin/properties/[id]`) are full pages that render one shared `property-form.tsx` Client Component in `mode="create"` / `mode="edit"`. Two Server Actions (`createPropertyAction`, `updatePropertyAction`) validate input via TDD'd `lib/properties/validate.ts`, write through the **user-scoped client** (the `properties_admin_write` RLS policy already permits admin writes — no service role), and log audit rows via the existing `logAuditEvent` helper. Soft-delete only (an Active toggle on the detail page). No new migration.

**Tech Stack:** Next.js 15 (App Router, RSC, async `params`, `typedRoutes`), Supabase JS (user-scoped SSR client), shadcn/ui (new-york), Tailwind v4 tokens, Vitest, pnpm workspace.

**Spec:** `docs/specs/2026-05-29-properties-crud-design.md`
**Predecessor:** Plan 4a (`plan-04a-admin-users-complete`)

---

## File Structure

```
apps/portal/
├── components/ui/textarea.tsx                          ← Task 1 (shadcn add)
├── lib/properties/
│   ├── timezones.ts                                    ← Task 2: curated IANA list + default
│   └── validate.ts                                     ← Task 2: pure input validators
├── tests/lib/properties/validate.test.ts               ← Task 2 (TDD)
└── app/(admin)/admin/
    ├── page.tsx                                        ← Task 8 (MODIFY: add Properties card)
    └── properties/
        ├── actions.ts                                  ← Task 3: create/update Server Actions
        ├── property-form.tsx                           ← Task 4: shared create/edit form (client)
        ├── new/page.tsx                                ← Task 5: create page (server)
        ├── [id]/page.tsx                               ← Task 6: detail/edit page (server)
        ├── page.tsx                                    ← Task 7: list page (server)
        └── properties-table.tsx                        ← Task 7: list table (client)
```

**Responsibilities:**
- `timezones.ts` — single source of the curated timezone options; consumed by both the validator and the form (DRY).
- `validate.ts` — pure, testable input checks. The only file with unit tests (spec §7).
- `actions.ts` — server-side authz (`requireRole`), validation, RLS-enforced write, audit, revalidate. Also exports the shared `PropertyInput` type.
- `property-form.tsx` — all form state + submit wiring for create and edit. One file so the ~9 fields aren't duplicated.
- `page.tsx` / `properties-table.tsx` — list fetch + presentational table (search, row links, New button).
- `new/page.tsx`, `[id]/page.tsx` — thin server wrappers that fetch the owners list (+ the property, for edit) and render the form.

**Testing note (spec §7):** Only `validate.ts` gets unit tests. Server Actions, the form, and the pages are thin glue over tested validators + RLS-enforced writes and have no component-test infrastructure — `pnpm typecheck` + `pnpm lint` are their gate, plus the manual smoke in Task 9.

**Path convention:** all `cd` commands use the absolute portal path:
`/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal`

---

## Task 1: Install the shadcn `textarea` component

The kiosk welcome/apology fields are multi-line. `textarea` is the only shadcn primitive 4a didn't already install.

**Files:**
- Add: `apps/portal/components/ui/textarea.tsx`

- [ ] **Step 1: Run the shadcn CLI from the portal directory.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm dlx shadcn@latest add textarea
```

Expected: writes `components/ui/textarea.tsx`. Accept any overwrite prompt.

- [ ] **Step 2: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass (the new file is standard shadcn output).

- [ ] **Step 3: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/components/ui/textarea.tsx
git commit -m "chore(portal): add shadcn textarea component"
```

---

## Task 2: Timezone constants + input validators (TDD)

**Files:**
- Create: `apps/portal/lib/properties/timezones.ts`
- Create: `apps/portal/lib/properties/validate.ts`
- Test: `apps/portal/tests/lib/properties/validate.test.ts`

- [ ] **Step 1: Write the curated timezone constants.**

Create `apps/portal/lib/properties/timezones.ts`:

```ts
// Curated IANA timezones offered when creating/editing a property. US-only for
// the v1 pilot. The validator restricts input to these values; the property
// form renders them as Select options. Single source of truth for both.

export type TimezoneOption = { value: string; label: string };

export const PROPERTY_TIMEZONES: ReadonlyArray<TimezoneOption> = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
];

export const TIMEZONE_VALUES: ReadonlyArray<string> = PROPERTY_TIMEZONES.map(
  (t) => t.value,
);

export const DEFAULT_TIMEZONE = "America/New_York";
```

- [ ] **Step 2: Write the failing test.**

Create `apps/portal/tests/lib/properties/validate.test.ts` (mirrors 4a's dynamic-import + exact-string style):

```ts
import { describe, expect, it } from "vitest";

describe("validatePropertyName", () => {
  it("accepts a normal name", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("Grand Plaza Hotel")).toBeNull();
  });

  it("rejects an empty / whitespace-only string", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("   ")).toBe("Enter a property name.");
  });

  it("rejects names over 120 characters", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("a".repeat(121))).toBe(
      "Property name must be 120 characters or fewer.",
    );
  });
});

describe("validateTimezone", () => {
  it("accepts a curated zone", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("America/New_York")).toBeNull();
    expect(validateTimezone("Pacific/Honolulu")).toBeNull();
  });

  it("rejects a non-curated zone", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("Europe/London")).toBe("Choose a valid timezone.");
  });

  it("rejects an empty string", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("")).toBe("Choose a valid timezone.");
  });
});

describe("validatePhone", () => {
  it("accepts an empty value (optional field)", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("   ")).toBeNull();
  });

  it("accepts an E.164-style number with formatting", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("+1 (555) 123-4567")).toBeNull();
  });

  it("rejects letters", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("CALL-US")).toBe(
      "Phone number can only contain digits, spaces, and + - ( ) characters.",
    );
  });

  it("rejects values over 32 characters", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("1".repeat(33))).toBe(
      "Phone number must be 32 characters or fewer.",
    );
  });
});

describe("validateKioskMessage", () => {
  it("accepts an empty value", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("")).toBeNull();
  });

  it("accepts a normal message", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("How can we help you today?")).toBeNull();
  });

  it("rejects messages over 280 characters", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("x".repeat(281))).toBe(
      "Message must be 280 characters or fewer.",
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm test tests/lib/properties/validate.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/properties/validate'` (file not created yet).

- [ ] **Step 4: Write the validators.**

Create `apps/portal/lib/properties/validate.ts`:

```ts
import { TIMEZONE_VALUES } from "./timezones";

// Lenient on purpose: accepts E.164 numbers AND Twilio SIDs. Length and the
// allowed character set are the only checks (spec §3.4 / §7).
const PHONE_RE = /^[+()\-\s\d]+$/;

export function validatePropertyName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter a property name.";
  if (trimmed.length > 120) {
    return "Property name must be 120 characters or fewer.";
  }
  return null;
}

export function validateTimezone(input: string): string | null {
  if (!TIMEZONE_VALUES.includes(input)) return "Choose a valid timezone.";
  return null;
}

// Shared by routing_did, property_phone_number, after_hours_support_phone.
// Empty is valid — the field clears to null.
export function validatePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 32) {
    return "Phone number must be 32 characters or fewer.";
  }
  if (!PHONE_RE.test(trimmed)) {
    return "Phone number can only contain digits, spaces, and + - ( ) characters.";
  }
  return null;
}

export function validateKioskMessage(input: string): string | null {
  if (input.trim().length > 280) {
    return "Message must be 280 characters or fewer.";
  }
  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm test tests/lib/properties/validate.test.ts
```

Expected: PASS — all assertions green.

- [ ] **Step 6: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 7: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/lib/properties/timezones.ts apps/portal/lib/properties/validate.ts apps/portal/tests/lib/properties/validate.test.ts
git commit -m "feat(portal): property input validators and curated timezones (TDD)"
```

---

## Task 3: Property create/update Server Actions

No unit test — these are thin glue over the Task 2 validators + RLS-enforced writes (spec §7). `pnpm typecheck` is the correctness gate (it checks the Supabase Insert/Update types and the audit helper signature).

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/actions.ts`

- [ ] **Step 1: Write the actions file.**

Create `apps/portal/app/(admin)/admin/properties/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { Database, Json } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  validatePropertyName,
  validateTimezone,
  validatePhone,
  validateKioskMessage,
} from "@/lib/properties/validate";

export type PropertyInput = {
  name: string;
  timezone: string;
  owner_user_id: string | null;
  routing_did: string;
  property_phone_number: string;
  after_hours_support_phone: string;
  kiosk_welcome_message: string;
  kiosk_apology_message: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type PropertyInsert = Database["public"]["Tables"]["properties"]["Insert"];
type PropertyUpdate = Database["public"]["Tables"]["properties"]["Update"];

function validatePropertyInput(input: PropertyInput): string | null {
  return (
    validatePropertyName(input.name) ??
    validateTimezone(input.timezone) ??
    validatePhone(input.routing_did) ??
    validatePhone(input.property_phone_number) ??
    validatePhone(input.after_hours_support_phone) ??
    validateKioskMessage(input.kiosk_welcome_message) ??
    validateKioskMessage(input.kiosk_apology_message)
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Defense-in-depth beyond the RLS-scoped dropdown: a non-null owner must be an
// existing same-operator profile with role OWNER.
async function assertValidOwner(
  supabase: ServerClient,
  operatorId: string,
  ownerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, operator_id, role")
    .eq("id", ownerId)
    .maybeSingle();

  if (!data || data.operator_id !== operatorId || data.role !== "OWNER") {
    return "Selected owner is not a valid owner in your operator.";
  }
  return null;
}

export async function createPropertyAction(
  input: PropertyInput,
): Promise<CreateResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validatePropertyInput(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  if (input.owner_user_id) {
    const ownerError = await assertValidOwner(
      supabase,
      actor.operator_id,
      input.owner_user_id,
    );
    if (ownerError) return { ok: false, error: ownerError };
  }

  const insert: PropertyInsert = {
    operator_id: actor.operator_id,
    name: input.name.trim(),
    timezone: input.timezone,
    owner_user_id: input.owner_user_id,
    active: true,
  };

  // Optional text columns: omit when blank so nullable columns stay null and
  // the kiosk-message columns fall back to their DB defaults.
  const routingDid = emptyToNull(input.routing_did);
  if (routingDid) insert.routing_did = routingDid;
  const propertyPhone = emptyToNull(input.property_phone_number);
  if (propertyPhone) insert.property_phone_number = propertyPhone;
  const afterHours = emptyToNull(input.after_hours_support_phone);
  if (afterHours) insert.after_hours_support_phone = afterHours;
  const welcome = emptyToNull(input.kiosk_welcome_message);
  if (welcome) insert.kiosk_welcome_message = welcome;
  const apology = emptyToNull(input.kiosk_apology_message);
  if (apology) insert.kiosk_apology_message = apology;

  const { data, error } = await supabase
    .from("properties")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error: "That routing number is already assigned to another property.",
      };
    }
    return {
      ok: false,
      error: `Failed to create property: ${error?.message ?? "unknown error"}`,
    };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: "property.created",
    entityType: "property",
    entityId: data.id,
    details: {
      name: insert.name,
      timezone: insert.timezone,
      owner_user_id: input.owner_user_id,
    },
  });

  revalidatePath("/admin/properties");
  return { ok: true, id: data.id };
}

export async function updatePropertyAction(
  input: PropertyInput & { propertyId: string; active: boolean },
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validatePropertyInput(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  if (input.owner_user_id) {
    const ownerError = await assertValidOwner(
      supabase,
      actor.operator_id,
      input.owner_user_id,
    );
    if (ownerError) return { ok: false, error: ownerError };
  }

  // RLS scopes this read to the actor's operator; a foreign / unknown id
  // returns no row.
  const { data: current } = await supabase
    .from("properties")
    .select(
      "id, operator_id, name, timezone, owner_user_id, routing_did, property_phone_number, after_hours_support_phone, kiosk_welcome_message, kiosk_apology_message, active",
    )
    .eq("id", input.propertyId)
    .maybeSingle();

  if (!current) {
    return { ok: false, error: "Property not found in your operator." };
  }

  const next = {
    name: input.name.trim(),
    timezone: input.timezone,
    owner_user_id: input.owner_user_id,
    routing_did: emptyToNull(input.routing_did),
    property_phone_number: emptyToNull(input.property_phone_number),
    after_hours_support_phone: emptyToNull(input.after_hours_support_phone),
    kiosk_welcome_message: emptyToNull(input.kiosk_welcome_message),
    kiosk_apology_message: emptyToNull(input.kiosk_apology_message),
  };

  const updates: PropertyUpdate = {};
  const auditEvents: Array<{ action: string; details: unknown }> = [];

  const TEXT_FIELDS = [
    "name",
    "timezone",
    "owner_user_id",
    "routing_did",
    "property_phone_number",
    "after_hours_support_phone",
    "kiosk_welcome_message",
    "kiosk_apology_message",
  ] as const;

  for (const field of TEXT_FIELDS) {
    if (next[field] !== current[field]) {
      (updates as Record<string, unknown>)[field] = next[field];
      auditEvents.push({
        action: "property.edited",
        details: { field, from: current[field], to: next[field] },
      });
    }
  }

  if (input.active !== current.active) {
    updates.active = input.active;
    auditEvents.push({
      action: "property.active_toggled",
      details: { from: current.active, to: input.active },
    });
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from("properties")
    .update(updates)
    .eq("id", input.propertyId);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That routing number is already assigned to another property.",
      };
    }
    return { ok: false, error: `Failed to update property: ${error.message}` };
  }

  for (const evt of auditEvents) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: evt.action,
      entityType: "property",
      entityId: input.propertyId,
      details: evt.details as Json,
    });
  }

  revalidatePath("/admin/properties");
  revalidatePath(`/admin/properties/${input.propertyId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass. (Type-only exports `PropertyInput` / `ActionResult` / `CreateResult` are allowed from a `"use server"` file — they erase at compile time, same as 4a's `ActionResult`.)

- [ ] **Step 3: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/properties/actions.ts
git commit -m "feat(portal): property create/update server actions with per-field audit"
```

---

## Task 4: Shared property form (create + edit)

No unit test (client UI; spec §7). `pnpm typecheck` + `pnpm lint` are the gate.

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/property-form.tsx`

- [ ] **Step 1: Write the form component.**

Create `apps/portal/app/(admin)/admin/properties/property-form.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  PROPERTY_TIMEZONES,
  DEFAULT_TIMEZONE,
} from "@/lib/properties/timezones";
import {
  createPropertyAction,
  updatePropertyAction,
  type PropertyInput,
} from "./actions";

export type OwnerOption = { id: string; full_name: string };

export type PropertyRow = {
  id: string;
  name: string;
  timezone: string;
  owner_user_id: string | null;
  routing_did: string | null;
  property_phone_number: string | null;
  after_hours_support_phone: string | null;
  kiosk_welcome_message: string | null;
  kiosk_apology_message: string | null;
  active: boolean;
};

// shadcn Select disallows an empty-string value, so null owner uses a sentinel.
const NO_OWNER = "none";

type Props =
  | { mode: "create"; owners: OwnerOption[] }
  | { mode: "edit"; owners: OwnerOption[]; property: PropertyRow };

export function PropertyForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = props.mode === "edit" ? props.property : null;

  const [name, setName] = useState(initial?.name ?? "");
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? DEFAULT_TIMEZONE,
  );
  const [ownerId, setOwnerId] = useState(initial?.owner_user_id ?? NO_OWNER);
  const [routingDid, setRoutingDid] = useState(initial?.routing_did ?? "");
  const [propertyPhone, setPropertyPhone] = useState(
    initial?.property_phone_number ?? "",
  );
  const [afterHours, setAfterHours] = useState(
    initial?.after_hours_support_phone ?? "",
  );
  const [welcome, setWelcome] = useState(
    initial?.kiosk_welcome_message ?? "",
  );
  const [apology, setApology] = useState(
    initial?.kiosk_apology_message ?? "",
  );
  const [active, setActive] = useState(initial?.active ?? true);

  function buildInput(): PropertyInput {
    return {
      name,
      timezone,
      owner_user_id: ownerId === NO_OWNER ? null : ownerId,
      routing_did: routingDid,
      property_phone_number: propertyPhone,
      after_hours_support_phone: afterHours,
      kiosk_welcome_message: welcome,
      kiosk_apology_message: apology,
    };
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (props.mode === "create") {
        const result = await createPropertyAction(buildInput());
        if (result.ok) {
          toast.success("Property created");
          router.push(`/admin/properties/${result.id}` as never);
        } else {
          setError(result.error);
        }
      } else {
        const result = await updatePropertyAction({
          ...buildInput(),
          propertyId: props.property.id,
          active,
        });
        if (result.ok) {
          toast.success("Property updated");
          router.refresh();
        } else {
          setError(result.error);
        }
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner">Owner</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger id="owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OWNER}>No owner</SelectItem>
              {props.owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="routing_did">Routing number (Twilio DID)</Label>
          <Input
            id="routing_did"
            value={routingDid}
            onChange={(e) => setRoutingDid(e.target.value)}
            placeholder="+15551234567"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="property_phone">Property phone number</Label>
          <Input
            id="property_phone"
            value={propertyPhone}
            onChange={(e) => setPropertyPhone(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="after_hours">After-hours support phone</Label>
          <Input
            id="after_hours"
            value={afterHours}
            onChange={(e) => setAfterHours(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="welcome">Kiosk welcome message</Label>
        <Textarea
          id="welcome"
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          placeholder="How can we help?"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apology">Kiosk apology message</Label>
        <Textarea
          id="apology"
          value={apology}
          onChange={(e) => setApology(e.target.value)}
          rows={3}
        />
      </div>

      {props.mode === "edit" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <Label htmlFor="active" className="flex flex-col gap-0.5">
            <span>Active</span>
            <span className="text-xs text-text-muted">
              Inactive properties are hidden from routing and assignments.
            </span>
          </Label>
          <Switch id="active" checked={active} onCheckedChange={setActive} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : props.mode === "create"
              ? "Create property"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/properties" as never)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass. (`as never` on the dynamic `router.push` targets matches the existing `typedRoutes` idiom used in `app-sidebar.tsx` / `admin/page.tsx`.)

- [ ] **Step 3: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/properties/property-form.tsx
git commit -m "feat(portal): shared property create/edit form component"
```

---

## Task 5: Create page (`/admin/properties/new`)

No unit test (server wrapper). Typecheck + lint gate.

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/new/page.tsx`

- [ ] **Step 1: Write the create page.**

Create `apps/portal/app/(admin)/admin/properties/new/page.tsx`:

```tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertyForm } from "../property-form";

export default async function NewPropertyPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("operator_id", actor.operator_id)
    .eq("role", "OWNER")
    .eq("active", true)
    .order("full_name");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={"/admin/properties" as never}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Properties
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          New property
        </h1>
      </div>

      <PropertyForm mode="create" owners={owners ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass. (`.select("id, full_name")` on `profiles` yields `{ id: string; full_name: string }[]`, assignable to `OwnerOption[]` — no cast needed.)

- [ ] **Step 3: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/properties/new/page.tsx
git commit -m "feat(portal): new property page"
```

---

## Task 6: Detail/edit page (`/admin/properties/[id]`)

No unit test (server wrapper). Typecheck + lint gate.

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/[id]/page.tsx`

- [ ] **Step 1: Write the detail page.**

Create `apps/portal/app/(admin)/admin/properties/[id]/page.tsx`. Note Next 15 async `params`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertyForm } from "../property-form";

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

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass. (`notFound()` returns `never`, so `property` narrows to non-null; the selected columns match `PropertyRow` exactly, so no cast is needed.)

- [ ] **Step 3: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/properties/\[id\]/page.tsx
git commit -m "feat(portal): property detail/edit page"
```

---

## Task 7: List page + table (`/admin/properties`)

No unit test (server fetch + presentational table). Typecheck + lint gate.

**Files:**
- Create: `apps/portal/app/(admin)/admin/properties/page.tsx`
- Create: `apps/portal/app/(admin)/admin/properties/properties-table.tsx`

- [ ] **Step 1: Write the list table (client component).**

Create `apps/portal/app/(admin)/admin/properties/properties-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PropertyListRow = {
  id: string;
  name: string;
  timezone: string;
  routing_did: string | null;
  active: boolean;
  created_at: string;
  owner_name: string;
};

type Props = {
  readonly properties: PropertyListRow[];
};

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function PropertiesTable({ properties }: Props) {
  const [query, setQuery] = useState("");

  const filtered = properties.filter((p) => {
    if (!query) return true;
    return p.name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Button asChild>
          <Link href={"/admin/properties/new" as never}>
            <Plus className="mr-2 h-4 w-4" />
            New property
          </Link>
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-text-muted/40" />
          <p className="text-sm font-medium text-foreground">
            No properties yet
          </p>
          <p className="text-xs text-text-muted">
            Add your first property to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Routing #</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    <Link
                      href={`/admin/properties/${p.id}` as never}
                      className="hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.owner_name}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.timezone}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.routing_did ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.active ? "secondary" : "outline"}>
                      {p.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {relative(p.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the list page (server component).**

Create `apps/portal/app/(admin)/admin/properties/page.tsx`. Owner names are resolved with a second query (the project's 2-query join pattern — no FK embed):

```tsx
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertiesTable } from "./properties-table";

export default async function PropertiesPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, name, timezone, routing_did, active, created_at, owner_user_id")
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load properties: ${error.message}`);
  }

  const ownerIds = [
    ...new Set(
      (properties ?? [])
        .map((p) => p.owner_user_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    for (const o of owners ?? []) ownerNames.set(o.id, o.full_name);
  }

  const rows = (properties ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    timezone: p.timezone,
    routing_did: p.routing_did,
    active: p.active,
    created_at: p.created_at,
    owner_name: p.owner_user_id
      ? (ownerNames.get(p.owner_user_id) ?? "—")
      : "—",
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Properties</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage the hotels and venues your operator serves.
          </p>
        </div>
      </header>

      <PropertiesTable properties={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 4: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/properties/page.tsx apps/portal/app/\(admin\)/admin/properties/properties-table.tsx
git commit -m "feat(portal): properties list page with search"
```

---

## Task 8: Add a Properties card to the admin overview

**Files:**
- Modify: `apps/portal/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Update the import line.**

In `apps/portal/app/(admin)/admin/page.tsx`, change:

```tsx
import { ArrowRight, Users } from "lucide-react";
```

to:

```tsx
import { ArrowRight, Building2, Users } from "lucide-react";
```

- [ ] **Step 2: Add the Properties card inside the `<section>`, immediately after the existing Users `</Link>`.**

Insert this block right after the closing `</Link>` of the Users card and before `</section>`:

```tsx
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
```

- [ ] **Step 3: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 4: Commit.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git add apps/portal/app/\(admin\)/admin/page.tsx
git commit -m "feat(portal): add Properties card to admin overview"
```

---

## Task 9: Full verification + manual smoke + tag

- [ ] **Step 1: Run the full test / typecheck / lint suite from the repo root.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all pass — including the existing 4a tests plus the new `validate.test.ts`.

- [ ] **Step 2: Production build (catches RSC/route issues the dev server hides).**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm build
```

Expected: build succeeds; the route list shows `/admin/properties`, `/admin/properties/new`, and `/admin/properties/[id]`.

- [ ] **Step 3: Manual smoke (requires local Supabase + `.env.local`).** Start the stack and dev server:

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm supabase:start
pnpm dev:portal
```

Then walk through, signed in as the seeded admin (`admin@lobbyconnect.local` / `localdev123`):

1. Sidebar → **Properties** → empty state with **New property**.
2. **New property** → fill Name + pick a Timezone → **Create property** → redirected to the detail page; the row appears in the list. Confirm a `property.created` row in `audit_logs`.
3. On the detail page, rename + change timezone → **Save changes** → confirm one `property.edited` row per changed field (`details.field` / `from` / `to`).
4. Toggle **Active** off → Save → confirm `property.active_toggled`; the list badge reads **Inactive**. Toggle back on.
5. Invite an OWNER via `/admin/users` (if none exists), then set it via the **Owner** dropdown on a property → Save → the list **Owner** column shows the name.
6. Create/edit a property using a `routing_did` already held by another property → friendly inline error, no 500.
7. Visit `/admin/properties/<random-uuid>` → Next 404.

- [ ] **Step 4: Tag the completed plan.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git tag plan-04b-properties-crud-complete
```

(Use the `superpowers:finishing-a-development-branch` skill to decide on pushing / next steps.)

---

## Self-Review

**Spec coverage** (each §):
- §2 in-scope list/new/detail pages → Tasks 5/6/7. Actions → Task 3. Validators → Task 2. Overview card → Task 8. Audit actions → Task 3. ✓
- §3.1 detail-page surface → Tasks 5/6; read-only list → Task 7. ✓
- §3.2 one shared form, `mode` prop → Task 4. ✓
- §3.3 user-scoped reads+writes, service role only for audit → Task 3 (uses `createServerClient` for writes; `logAuditEvent` for audit). ✓
- §3.4 field set + curated US timezones + active edit-only → Tasks 2 (timezones), 4 (form: Active rendered only in edit mode). ✓
- §3.5 soft-delete only → Task 4 (Active switch); no delete action exists. ✓
- §3.6 per-field audit / create audit → Task 3. ✓
- §3.7 owner validation + `23505` handling → Task 3 (`assertValidOwner`, `error.code === "23505"`). ✓
- §3.8 `notFound()` → Task 6. ✓
- §7 tests only on validators → Task 2 is the only TDD task; others gated by typecheck/lint + Task 9 smoke. ✓
- §10 DoD → Task 9 (full suite, build, smoke, tag). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete content; every command has expected output. ✓

**Type consistency:** `PropertyInput` defined in Task 3, imported in Task 4. `OwnerOption` / `PropertyRow` defined in Task 4, consumed in Tasks 5/6. `PropertyListRow` defined in Task 7 table, produced by Task 7 page's `rows`. Action names (`createPropertyAction`, `updatePropertyAction`) consistent across Tasks 3–4. Audit actions (`property.created`, `property.edited`, `property.active_toggled`) consistent between Task 3 and the Task 9 smoke. ✓

---

*End of Plan 4b implementation plan.*
