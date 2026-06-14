-- Phase 4 (S8): DB-level guard for "one active VIDEO call per property".
-- The kiosk route check-then-inserts, which races on a double-tap / reload storm.
-- A partial unique index makes the invariant atomic; the route maps 23505 -> 409.
create unique index if not exists calls_one_active_video_per_property
  on public.calls (property_id)
  where channel = 'VIDEO' and state in ('RINGING', 'IN_PROGRESS');
