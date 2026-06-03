# Plan 7b — Owner Self-Service Writes Design Spec

**Parent spec:** `docs/specs/2026-05-27-v1-architecture-design.md` §11 (owner portal scope)
**Sibling:** `docs/specs/2026-06-02-07a-owner-portal-design.md` (read views — tag `plan-07a-owner-portal-complete`)
**Builds on:** 7a. Adds the three writes 7a deliberately deferred.

## Goal

Let a hotel owner self-serve the parts of their property that are genuinely theirs: the guest-facing kiosk content, the agent playbook PDF, and closing out emergency incidents. Everything else stays read-only (7a) or admin-only.

## Domain seam (the organizing principle)

**Owners own guest-facing content; admins own operations.**

| Owner may write (7b) | Admin-only (unchanged) |
|---|---|
| 8 `kiosk_*` content fields | `name`, `timezone`, `owner_user_id`, `active` |
| Playbook PDF (upload/replace + view) | `routing_did`, `property_phone_number`, `after_hours_support_phone` |
| Resolve an incident (`status`, `resolution_note`) | Primary-agent assignment, call availability |

This seam also explains a pre-existing fact: 6 of the 8 kiosk fields (`kiosk_welcome_heading`, `kiosk_checkin_time`, `kiosk_checkout_time`, `kiosk_wifi_network`, `kiosk_wifi_password`, `kiosk_breakfast_hours`) have **no edit UI anywhere** — the admin property form only edits `kiosk_welcome_message` + `kiosk_apology_message`. 7b is the first edit surface for guest content, and it belongs to the owner. The two overlapping fields (`welcome_message`, `apology_message`) remain editable by both roles (last-write-wins, both audited) — acceptable, no conflict.

## Decisions

1. **Writes are RLS-enforced, not service-role.** Per the project convention ("never bypass RLS in app code — use service role only where genuinely needed"), kiosk-content editing and incident resolve go through the **user-scoped** Supabase client against new owner `UPDATE` RLS policies. The lone service-role surface is the playbook route, which genuinely needs binary file handling against a private bucket. (Approach A from the 2026-06-03 brainstorm; B "all service-role" and C "column-level GRANT on the shared `authenticated` role" were rejected.)
2. **Column safety via a trigger, because RLS is row-level.** PostgREST is reachable by any authenticated user with their JWT, so a naive owner `UPDATE` policy on `properties` would let an owner flip `routing_did` / `active` / `owner_user_id` with a raw API call. A `BEFORE UPDATE` column-guard trigger closes this: when the actor's role is `OWNER`, any change to a column outside the kiosk whitelist is rejected. Implemented with `to_jsonb(old) - <kiosk_keys> IS DISTINCT FROM to_jsonb(new) - <kiosk_keys>`, so the guard is **forward-compatible** — a future column is protected by default until explicitly whitelisted.
3. **Service-role writes skip the guard cleanly.** `current_user_role()` is `select role from profiles where id = auth.uid()`; under the service-role client `auth.uid()` is NULL, so it returns NULL, never `'OWNER'`. The playbook route's `properties` update (bumping `playbook_version` / `playbook_pdf_url`) is therefore unaffected by the trigger.
4. **Incident resolve is final, with an optional note.** One Resolve action sets `status='RESOLVED'`, `resolved_at=now()`, and an optional `resolution_note`. No re-open in v1. Finality is enforced server-side: the `incidents` column-guard trigger rejects *any* owner update when `old.status = 'RESOLVED'`. The audit log (`incident.resolved`, who/when) is the safety record.
5. **A dedicated `resolution_note` column.** The emergency route already writes `incidents.notes` at creation (diagnostic text — degraded mode, dispatch errors). The owner's resolution note must not clobber that, so 7b adds `incidents.resolution_note`. System `notes` stays read-only to owners; `resolution_note` is owner-writable.
6. **Kiosk editing is inline on the property detail page.** Mobile-first: an Edit button flips the kiosk-content section to inputs with Save/Cancel in place — fewest taps, no extra navigation. Not a dedicated `/edit` route (that's the desktop admin pattern).
7. **Playbook is one PDF per property, versioned.** Upload replaces the file at the canonical key `<operator_id>/<property_id>/playbook.pdf` (already the prod convention) and increments `playbook_version`. PDF only, ≤ 10 MB. No delete/clear in v1.
8. **Incident resolve is owner-only** (for now). Incidents are surfaced only in the owner portal — created by the emergency route, displayed nowhere else. There is no admin incident UI, so resolve lives only here. The `incidents_owner_update` policy is the only authenticated write path; admins still write incidents via service role if ever needed.

## Migration `0010_owner_writes.sql`

Adds one column, two policies, two triggers. No other schema changes.

1. **Column:** `alter table incidents add column if not exists resolution_note text;`

2. **`properties_owner_update`** — `FOR UPDATE TO authenticated`, both `USING` and `WITH CHECK`:
   `operator_id = current_user_operator_id() AND current_user_role() = 'OWNER' AND owner_user_id = auth.uid()`.

3. **`incidents_owner_update`** — `FOR UPDATE TO authenticated`, both `USING` and `WITH CHECK`:
   `operator_id = current_user_operator_id() AND current_user_role() = 'OWNER' AND user_owns_property(incidents.property_id)`
   (reuses the `0004` SECURITY DEFINER helper to avoid policy recursion).

4. **`enforce_owner_property_columns()`** + `BEFORE UPDATE` trigger on `properties`:
   when `current_user_role() = 'OWNER'`, reject if
   `to_jsonb(old) - kiosk_keys IS DISTINCT FROM to_jsonb(new) - kiosk_keys`
   where `kiosk_keys = ARRAY[kiosk_welcome_heading, kiosk_welcome_message, kiosk_checkin_time, kiosk_checkout_time, kiosk_wifi_network, kiosk_wifi_password, kiosk_breakfast_hours, kiosk_apology_message]`.

5. **`enforce_owner_incident_columns()`** + `BEFORE UPDATE` trigger on `incidents`:
   when `current_user_role() = 'OWNER'`:
   - reject if `old.status = 'RESOLVED'` (resolved incidents are immutable — enforces decision 4);
   - else reject if `to_jsonb(old) - ARRAY['status','resolved_at','resolution_note'] IS DISTINCT FROM to_jsonb(new) - (same)`.

Both trigger functions are `SECURITY DEFINER`, `set search_path = public`. The `WITH CHECK` clauses guarantee the row still belongs to the owner after the update; the triggers guarantee only the allowed columns moved. Together they hold against direct PostgREST, not just the app.

`packages/shared/src/supabase-types.ts` is regenerated for the new `incidents.resolution_note` column.

## Feature 1 — Kiosk content editing (inline)

- **`lib/owner/kiosk.ts` (pure, TDD-first):** `validateKioskFields(input)` → first error string or null. Long fields (`welcome_message`, `apology_message`) keep the 280-char cap from `lib/properties/validate.ts#validateKioskMessage`; the short fields (heading, check-in/out, Wi-Fi network/password, breakfast hours) get shorter caps. Empty → null (a blank field is simply not rendered on the kiosk).
- **`app/(owner)/owner/properties/[id]/actions.ts` → `updateKioskContentAction(propertyId, input)`:** `requireRole("OWNER")` → `validateKioskFields` → fetch current row (user-scoped) → per-field diff → update only the 8 kiosk columns via the **user-scoped client** (RLS + trigger permit) → one `property.kiosk_edited` audit row per changed field (`{ field, from, to }`, mirroring `updatePropertyAction`) → `revalidatePath('/owner/properties/[id]')`. Returns `{ ok } | { ok:false, error }`.
- **`kiosk-content-card.tsx` (client):** display-only by default; **Edit** flips the section to inputs (mobile-first single column, `useTransition`, sonner toast on save). **Save** calls the action; **Cancel** reverts. Replaces the static section + the "coming in 7b" note in the current detail page.

## Feature 2 — Playbook upload + owner view (service-role route)

- **`lib/owner/playbook.ts` (pure, TDD-first):** `validatePlaybookFile({ type, size })` → error or null (PDF only via `application/pdf`, ≤ 10 MB); `playbookStorageKey(operatorId, propertyId)` → `<operator_id>/<property_id>/playbook.pdf`.
- **`POST /api/owner/properties/[id]/playbook`:** session-auth (`getUser`) → resolve profile (service role) → assert role `OWNER` + `owner_user_id === user.id` for the property → read multipart file → `validatePlaybookFile` → service-role `upsert` to the canonical key → bump `playbook_version` (`current + 1`, or `1` if null) and set `playbook_pdf_url` → audit `property.playbook_uploaded` (`{ version }`) → `{ ok, version }`. Rejections: 401 unauth, 403 not-owner, 400 bad file.
- **`GET /api/owner/properties/[id]/playbook`:** owner-gated signed URL (1 h TTL) — mirrors `/api/calls/[id]/playbook` but property-scoped. `{ hasPlaybook:false }` when none set.
- **`playbook-card.tsx` (client):** shows `v{n}` or "No playbook yet"; **View** (GET → open signed URL in new tab) + **Upload / Replace** (`<input type="file" accept="application/pdf">` → POST → `router.refresh()` on success, toast). The agent overlay's existing call-scoped playbook route is untouched and immediately serves the new PDF.

## Feature 3 — Incident resolve (optional note · final)

- **`lib/owner/incidents.ts` (pure, TDD-first):** `validateResolutionNote(note)` → error or null (optional; length cap, e.g. ≤ 1000 chars).
- **`app/(owner)/owner/incidents/[id]/actions.ts` → `resolveIncidentAction(incidentId, note?)`:** `requireRole("OWNER")` → `validateResolutionNote` → user-scoped update `status='RESOLVED'`, `resolved_at=now()`, `resolution_note = note ?? null` → audit `incident.resolved` (`{ note_present }`) → `revalidatePath('/owner/incidents/[id]')` + `revalidatePath('/owner')`. A no-op (already resolved) returns `{ ok }`.
- **`resolve-incident.tsx` (client):** rendered only when `status === 'OPEN'` — a **Resolve** button reveals an optional-note `Textarea` + confirm. On success the page refreshes; the resolved-timestamp display (already in 7a) takes over and the control disappears. Home's open-incident badge clears on the next `AutoRefresh` tick.

## Data flow

1. **Kiosk + incident writes:** client component → Server Action → `requireRole("OWNER")` → pure validator → user-scoped Supabase write (RLS policy authorizes the row; column-guard trigger authorizes the columns) → `logAuditEvent` → `revalidatePath`. No service role.
2. **Playbook:** client component → `POST`/`GET` route → session-auth + ownership check → service-role storage + `properties` write → audit. Service role is justified (private bucket, binary upload, canonical-path enforcement) and is the only RLS bypass in 7b.

## Cross-cutting

- **Styling:** Tailwind tokens only, light mode, mobile-first (consistent with 7a). No hardcoded hex.
- **Loading / pending:** `useTransition` pending states on every write button; sonner toasts for success/error.
- **Errors:** friendly action error strings surfaced inline + via toast; RLS/trigger violations map to a generic "couldn't save — please refresh and try again."
- **Accessibility:** labeled inputs, visible focus rings, keyboard-operable Edit/Save/Cancel/Resolve, ≥ AA contrast.
- **Audit actions added:** `property.kiosk_edited`, `property.playbook_uploaded`, `incident.resolved`.

## Testing

- **Pure helpers (Vitest, TDD-first):** `lib/owner/kiosk.ts`, `lib/owner/playbook.ts`, `lib/owner/incidents.ts`.
- **Route test:** `tests/app/owner/playbook-route.test.ts` — mirrors the 6 existing playbook tests: 401 unauth, 403 non-owner, 400 non-PDF, 400 oversize, version bump on upload, signed-URL happy path on GET, `{hasPlaybook:false}` when unset.
- **Server Actions:** thin wrappers over tested helpers — covered by helper tests + manual smoke, per the established `lib/` TDD pattern (admin actions follow the same convention).
- **Manual smoke (seed OWNER `owner@lobbyconnect.local` / `localdev123`, Olivia, owns "The Sample Hotel"):**
  - Property detail → Edit kiosk content → Save → values persist; start a kiosk session and confirm the kiosk home reflects the change.
  - Upload a PDF → `playbook_version` increments, "View" opens it; answer a video call as Alex → the agent overlay's 60% panel renders the new PDF.
  - Open the 6c incident → Resolve (with and without a note) → status flips to RESOLVED, `resolved_at` shows, Home open-incident badge clears after AutoRefresh; the Resolve control no longer appears.
  - **Negative (security):** with Olivia's JWT, a raw PostgREST `UPDATE properties SET active=false` (or `routing_did=…`) on her property is rejected by the trigger; a raw `UPDATE incidents` on a non-`{status,resolved_at,resolution_note}` column, or any update to an already-RESOLVED incident, is rejected.

## Files

```
supabase/migrations/0010_owner_writes.sql            ← column + 2 policies + 2 column-guard triggers
apps/portal/
  lib/owner/
    kiosk.ts          validateKioskFields                       (+ tests/owner/kiosk.test.ts)
    playbook.ts       validatePlaybookFile, playbookStorageKey  (+ tests/owner/playbook.test.ts)
    incidents.ts      validateResolutionNote                    (+ tests/owner/incidents.test.ts)
  app/(owner)/owner/properties/[id]/
    page.tsx          ← pass kiosk data to the client cards (RSC fetch otherwise unchanged)
    actions.ts        ← updateKioskContentAction
    kiosk-content-card.tsx     ← inline edit (client)
    playbook-card.tsx          ← view + upload (client)
  app/(owner)/owner/incidents/[id]/
    page.tsx          ← render <ResolveIncident> when status === 'OPEN'
    actions.ts        ← resolveIncidentAction
    resolve-incident.tsx       ← resolve control (client)
  app/api/owner/properties/[id]/playbook/route.ts    ← POST upload + GET signed URL (service role)
  tests/app/owner/playbook-route.test.ts
packages/shared/src/supabase-types.ts                ← regen for incidents.resolution_note
```

(Final file list is the plan's job; this is the expected shape.)

## Forward-compat seams

| Later feature | Seam in 7b |
|---|---|
| Admin editing the 6 guest-content kiosk fields | Same columns; admin form could add them later. Owner-write path doesn't block it. |
| Incident re-open / multi-state workflow | `resolution_note` + status are already separate from system `notes`; loosen the trigger's "resolved is final" branch when needed. |
| Playbook history / multiple docs | `playbook_version` already increments; a versioned key scheme drops in without changing the owner UI. |
| Admin incident dashboard | `incidents_owner_update` is owner-scoped; an admin write policy is additive. |
```
