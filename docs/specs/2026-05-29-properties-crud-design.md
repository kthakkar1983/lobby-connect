# Plan 4b — Properties CRUD Design

**Status**: Approved 2026-05-29
**Authors**: Kumar Thakkar + Claude
**Parent spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (sections 5.3, 6.2, 9)
**Predecessor**: Plan 4a (Admin layout + Users CRUD + Invite/Onboarding) — tag `plan-04a-admin-users-complete`

---

## 1. Purpose

Add admin management of `properties`: a list page, a create page, and a detail/edit page. Every meaningful mutation writes an audit row. This is the second of three sibling plans (4a / 4b / 4c) decomposing the "Admin CRUD" milestone. 4b reuses the admin shell built in 4a and the established page pattern (Server Component fetch → client component → Server Action → audit). It adds no new database objects — the `properties` table and its RLS policies already exist from Plan 2.

---

## 2. Scope

**In:**
- `/admin/properties` — list page (Server Component fetch + client table). Read + navigate + "New property" button. No row-level mutations.
- `/admin/properties/new` — create page (full page form).
- `/admin/properties/[id]` — detail + edit page (full page form, same component as create in "edit" mode). Active toggle lives here.
- `app/(admin)/admin/properties/actions.ts` — `createPropertyAction`, `updatePropertyAction`.
- `lib/properties/validate.ts` — TDD'd input validators (name, timezone, phone, kiosk message).
- `app/(admin)/admin/page.tsx` — add a Properties card to the admin overview (mirrors the existing Users card).
- Audit actions: `property.created`, `property.edited`, `property.active_toggled`.

**Out (deferred):**
- Logo + playbook-PDF uploads — a later focused pass (storage buckets + RLS already exist; no migration needed to add them).
- `geocoded_lat` / `geocoded_long` — forward-compat (maps); not surfaced in the UI.
- Property assignments + `admin_call_availability` toggle — Plan 4c.
- Per-property `accepting_calls` toggle — Plan 4c.
- `/audit` viewer — Plan 8 (this plan only *writes* audit rows).
- Hard-delete of properties (see §3.5).
- New SQL migration — none required.

---

## 3. Locked Decisions

### 3.1 Detail-page edit surface (not a Sheet)

Properties have ~9 editable fields including two multi-line kiosk messages — too many for the side Sheet the Users page uses for its 3 fields. 4b uses full pages: `/admin/properties/new` to create and `/admin/properties/[id]` to view + edit. This matches the "list + detail" shape noted in project status and gives the form room to breathe. The list page itself stays read-only: rows link to the detail page; a "New property" button sits top-right.

### 3.2 One shared form component for create and edit

`property-form.tsx` is a single `"use client"` component driven by a `mode: "create" | "edit"` prop (plus an optional `property` for edit and an `owners` list for the dropdown). Create mode calls `createPropertyAction`; edit mode calls `updatePropertyAction`. This avoids duplicating ~9 fields of form markup across two pages.

### 3.3 Reads and writes both use the user-scoped client (RLS, not service role)

This is the key contrast with 4a. The `properties_admin_write` policy (Plan 2) already permits ADMIN `INSERT`/`UPDATE`/`DELETE` scoped to their own operator:

```sql
create policy "properties_admin_write" on properties
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

So property reads **and** writes go through the user-scoped `createServerClient()`. RLS enforces tenancy + role on every write. This honors the project convention ("never bypass RLS in app code — service role only where genuinely needed") more directly than 4a, which needed the service role because `profiles` has no admin INSERT/DELETE policy.

The service role is still used for **one** thing: writing audit rows via the existing `logAuditEvent` helper (`audit_logs` is INSERT-only for service role per the RLS matrix).

### 3.4 Field set

| Field | Control | Required | Notes |
|---|---|---|---|
| `name` | Input | yes | 1–120 chars |
| `timezone` | Select (curated IANA) | yes | `NOT NULL` in schema; default `America/New_York` |
| `owner_user_id` | Select (OWNER profiles + "No owner") | no | options = same-operator `role='OWNER'` profiles |
| `routing_did` | Input | no | Twilio DID guests call; unique partial index |
| `property_phone_number` | Input | no | guest-facing fallback |
| `after_hours_support_phone` | Input | no | ops-only contact |
| `kiosk_welcome_message` | Textarea | no | DB default exists |
| `kiosk_apology_message` | Textarea | no | DB default exists |
| `active` | Switch | — | create always inserts `true`; switch shown in **edit mode only** |

`operator_id` is set server-side from `requireRole("ADMIN").operator_id` — never accepted from the form. `geocoded_*`, `logo_url`, `playbook_*` are left at their DB defaults / null.

**Curated timezone list** (US, since the pilot is US hotels): `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu`. The validator checks membership in this exact set, so a free-typed or foreign value is rejected server-side.

### 3.5 Soft-delete only

"Delete" is `active = false`, toggled by the Active switch on the detail page (audit `property.active_toggled`). There is no hard-delete in 4b. Rationale: `calls.property_id` is `NOT NULL` with no `ON DELETE` clause, so hard-deleting a property with call history would be blocked by Postgres anyway, and call history should not be cascade-destroyed. Properties are durable business entities; deactivation is the correct lifecycle end-state for v1. A hard-delete escape hatch can be added later if a real need appears (it would require a migration decision on the `calls` FK).

### 3.6 Per-field audit on edit (mirrors 4a)

`updatePropertyAction` diffs the incoming patch against the current row and writes one audit row per changed field:
- text/scalar field changes → `property.edited` with `details: { field, from, to }`
- `active` change → `property.active_toggled` with `details: { from, to }`

`createPropertyAction` writes a single `property.created` row with `details: { name, timezone, owner_user_id }`. This matches arch spec §line 374 ("property created/edited/deleted, property settings changed"); we use `active_toggled` in place of a hard `deleted` because deletion is soft.

### 3.7 Server-side owner validation + uniqueness handling

- **Owner**: the dropdown is populated only from same-operator OWNER profiles (RLS-scoped read), but the action additionally verifies that a non-null `owner_user_id` resolves to an existing same-operator profile with `role = 'OWNER'` before writing. Defense-in-depth against a forged form submission.
- **`routing_did` uniqueness**: the partial unique index can raise Postgres error `23505` on insert/update. The action catches this and returns a friendly typed error ("That routing number is already assigned to another property.") rather than a 500.

### 3.8 Not-found handling

`/admin/properties/[id]` fetches the property via the user-scoped client. If RLS returns no row (wrong operator, nonexistent id, or non-admin), the page calls Next's `notFound()` → 404. No information leak about other operators' properties.

---

## 4. File Layout

```
apps/portal/
├── app/
│   └── (admin)/
│       └── admin/
│           ├── page.tsx                       ← MODIFIED: add Properties overview card
│           └── properties/
│               ├── page.tsx                   ← NEW: Server Component, lists properties
│               ├── properties-table.tsx       ← NEW: Client Component (search + row links)
│               ├── property-form.tsx          ← NEW: Client Component (create + edit modes)
│               ├── actions.ts                 ← NEW: create/update Server Actions
│               ├── new/
│               │   └── page.tsx               ← NEW: fetch owners → <PropertyForm mode="create">
│               └── [id]/
│                   └── page.tsx               ← NEW: fetch property + owners → <PropertyForm mode="edit">
├── lib/
│   └── properties/
│       └── validate.ts                        ← NEW: shared input validators
└── tests/
    └── lib/properties/
        └── validate.test.ts                   ← NEW (TDD)
```

No `apps/kiosk/`, `packages/shared/`, or `supabase/` changes in this plan. The sidebar already lists Properties (`components/app-sidebar.tsx`, wired in 4a) — no edit needed.

---

## 5. Server Action Surface

Both actions live in `app/(admin)/admin/properties/actions.ts`. Each calls `requireRole("ADMIN")` first, validates input, performs the mutation via the **user-scoped** client (RLS-enforced), writes audit rows via `logAuditEvent`, and `revalidatePath('/admin/properties')`.

| Action | Inputs | Audit `action` | Notes |
|---|---|---|---|
| `createPropertyAction` | `name`, `timezone`, `owner_user_id?`, `routing_did?`, `property_phone_number?`, `after_hours_support_phone?`, `kiosk_welcome_message?`, `kiosk_apology_message?` | `property.created` | `operator_id` from actor; `active` defaults true; owner validated; on success `revalidatePath` + `redirect('/admin/properties/<id>')`. Returns typed error on `23505` (duplicate DID). |
| `updatePropertyAction` | `propertyId` + the same optional fields + `active` | One row per changed field: `property.edited {field, from, to}`; `active` change → `property.active_toggled {from, to}` | Fetch target (user-scoped); RLS already scopes to the actor's operator. Diff → update only changed fields. No-op returns `ok` without writing. Same `23505` handling. |

Both return the shared `ActionResult = { ok: true } | { ok: false; error: string }` type used in 4a.

---

## 6. RLS Considerations

- **List / detail reads**: user-scoped `createServerClient()`. `properties_select` lets an admin see all properties in their operator. ✓
- **Owner dropdown**: read `profiles where role = 'OWNER'` via the user-scoped client. `profiles_select_same_operator` lets the admin see all same-operator profiles. ✓
- **Writes (insert/update)**: user-scoped client. `properties_admin_write` allows ADMIN INSERT/UPDATE in their own operator and the `with check` clause enforces `operator_id` on write. No service role. ✓
- **Audit**: service-role via the existing `logAuditEvent` helper. ✓

No new policies or migrations are required.

---

## 7. Testing Strategy

**TDD on `lib/properties/validate.ts`** (pure functions, mirror 4a's `validate.test.ts`):
- `validatePropertyName` — required, ≤120 chars.
- `validateTimezone` — required, must be a member of the curated IANA set.
- `validatePhone` — optional; if present, lenient format (allowed chars `+`, digits, spaces, `-`, `(`, `)`) and ≤32 chars. Shared by the three phone-ish fields.
- `validateKioskMessage` — optional; ≤280 chars.

**Skipped:**
- React component tests — no component-test infra in this project; visual smoke covers it.
- Server Action end-to-end tests — thin glue over the tested validators + RLS-enforced writes.
- Audit logger — already covered in Plan 3.

**Manual smoke (final task):**
1. Sign in as the seeded admin → sidebar → `/admin/properties` → empty state with "New property".
2. Create a property (name + timezone + optional owner/phones/messages) → redirected to its detail page; row appears in the list. Confirm `property.created` audit row.
3. Edit a field (e.g., rename, change timezone) → save → confirm one `property.edited` row per changed field.
4. Toggle Active off → confirm `property.active_toggled`; toggle back on.
5. Set an owner from the dropdown (requires an OWNER profile to exist — invite one via `/admin/users` if needed) → confirm it persists and shows on the list.
6. Enter a `routing_did` already used by another property → friendly error, no 500.
7. Visit `/admin/properties/<random-uuid>` → 404.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Duplicate `routing_did` raises an unhandled `23505` → 500 | Action catches `23505` and returns a friendly typed error |
| Forged `owner_user_id` pointing at a foreign / non-OWNER profile | Server-side check that the owner is a same-operator `role='OWNER'` profile before write; dropdown is also RLS-scoped |
| `timezone` free-typed or invalid breaks downstream call routing (Plan 5) | Select-only input + validator restricts to the curated IANA set |
| Typed-routes (`typedRoutes: true`) rejects the dynamic detail `href` | Use the established `href as never` cast (same pattern as the existing sidebar/overview links) |
| Writing via the user-scoped client silently fails if RLS denies (e.g., role drift) | `requireRole("ADMIN")` gate up front; surface any write error as a typed `ActionResult` error |
| Admin deactivates the property they're actively routing in Plan 5 | Out of scope for 4b; routing logic (Plan 5) will treat `active=false` as not-routable |

---

## 9. Non-Goals

- No logo or playbook uploads, no Supabase Storage interaction.
- No geocoding / map fields.
- No assignments, backup agents, or `accepting_calls` toggle (4c).
- No hard-delete; no bulk actions; no CSV import.
- No row-level mutations on the list page (all edits happen on the detail page).
- No `/audit` viewer (Plan 8).

---

## 10. Definition of Done

- `/admin/properties` lists the operator's properties with search; "New property" CTA present.
- `/admin/properties/new` creates a property (audited `property.created`) and redirects to its detail page.
- `/admin/properties/[id]` shows + edits all in-scope fields; per-field `property.edited` audit; Active toggle audited `property.active_toggled`.
- Owner dropdown populated from same-operator OWNER profiles; "No owner" supported.
- Duplicate `routing_did` and unknown `[id]` handled gracefully (typed error / 404).
- Validators TDD-covered; `pnpm test` clean.
- `pnpm typecheck` + `pnpm lint` clean.
- Admin overview shows a Properties card.
- Tag `plan-04b-properties-crud-complete` on `main`.

---

*End of Plan 4b design.*
