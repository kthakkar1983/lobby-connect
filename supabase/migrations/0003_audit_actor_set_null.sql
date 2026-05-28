-- 0003_audit_actor_set_null.sql
-- Switch audit_logs.actor_user_id FK to ON DELETE SET NULL so admin hard-deletes
-- don't fail on existing audit rows authored by the deleted user. Post-delete,
-- the audit row still preserves action + entity_type + entity_id + details —
-- only the actor identity is dropped to null.
--
-- Plan: docs/plans/2026-05-28-04a-admin-users-invite.md
-- Spec: docs/specs/2026-05-28-admin-users-invite-design.md (§3.5)
--
-- Idempotent: drops by name (if exists), then re-adds.

alter table audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;

alter table audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key (actor_user_id)
  references profiles(id)
  on delete set null;
