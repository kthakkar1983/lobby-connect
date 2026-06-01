# Plan 6b — Playbook Design Spec

**Parent spec:** `docs/specs/2026-05-27-v1-architecture-design.md` §9.1
**Builds on:** 6a (tag `plan-06a-kiosk-video-complete`)

## Goal

Replace the 60% right-panel empty-state in the agent connected view with a live PDF viewer showing the property playbook.

## Decisions

- `properties.playbook_pdf_url` stores the **path within the `playbooks/` Supabase Storage bucket** (e.g., `{operator_id}/{property_id}/playbook.pdf`), not a full URL.
- The portal API route (`GET /api/calls/[id]/playbook`) uses the service-role admin client to create a 1-hour signed URL. Agents never have direct Storage access.
- PDF rendered in `<iframe>` (no extra deps). An "Open in new tab" link provides a fallback for any browser-level PDF rendering issues.
- Playbook auto-loads when the agent's `VideoCall` component mounts — no explicit click needed.
- If `playbook_pdf_url` is null/empty: the panel shows "No playbook uploaded yet." (same text as the 6a empty-state).
- Signed URL TTL: 3600 seconds (1 hour). Sufficient for a single call. No mid-call refresh in v1.
- No schema migration needed: `playbook_pdf_url` and `playbook_version` already exist on `properties` from `0001_init.sql`. The `playbooks/` storage bucket and its RLS policy exist in `0002_rls.sql`.
- For 6b testing: manually upload a PDF to the `playbooks/` bucket via the Supabase dashboard, then run `UPDATE properties SET playbook_pdf_url = 'your/path.pdf' WHERE id = '...'` in the SQL editor.

## API contract

`GET /api/calls/[id]/playbook`

**Auth:** session cookie (agent or admin in the same operator as the call).

**Response — no playbook:**
```json
{ "hasPlaybook": false }
```

**Response — playbook exists:**
```json
{
  "hasPlaybook": true,
  "signedUrl": "https://…",
  "version": 2
}
```

**Error responses:** `401` (unauthenticated), `404` (call not found / wrong operator), `500` (storage signing failed).

## What 6b does NOT include

- Owner upload UI — Plan 7 (owner portal)
- Playbook versioning / re-upload logic — Plan 7
- Signed URL refresh during a live call — deferred; 1-hour TTL is sufficient for v1
