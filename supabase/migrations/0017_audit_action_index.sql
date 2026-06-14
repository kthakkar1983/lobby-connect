-- Phase 4 (S11): supporting index for the /admin/audit filter, which scopes by
-- operator_id, optionally filters by action, and orders by created_at desc on an
-- unboundedly growing table. Without it the action filter degrades to a scan.
create index if not exists audit_logs_operator_action_created_idx
  on public.audit_logs (operator_id, action, created_at desc);
