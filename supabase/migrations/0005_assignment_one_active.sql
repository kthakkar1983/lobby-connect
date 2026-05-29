-- 0005_assignment_one_active.sql
-- Enforces the core assignment invariant: at most one ACTIVE primary-agent
-- assignment per property. An "active" row has effective_until IS NULL.
-- Plan 5 phone routing assumes exactly one active assignment per property;
-- two active rows would make the parallel-dial target ambiguous.
--
-- The v1 spec deferred a DB constraint "because of complexity" -- that concern
-- was about time-overlap (range) constraints. "At most one open row" is a
-- simple partial unique index, so we add it. The Server Action uses
-- close-then-insert ordering, so this index only ever fires on a concurrent
-- double-assign race, which the action surfaces as a friendly retry message.
--
-- Idempotent: create index if not exists.

create unique index if not exists property_assignments_one_active
  on property_assignments(property_id)
  where effective_until is null;
