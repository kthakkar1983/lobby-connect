-- 0018_realtime_calls_authz.sql
-- Authorize the per-operator calls broadcast channel (topic `operator:<uuid>:calls`).
--
-- The agent/admin IncomingVideoBanner subscribes to this PRIVATE Realtime channel
-- to receive a content-free "calls-changed" nudge (replacing the old 3s poll). The
-- server publishes via the service-role HTTP broadcast endpoint (bypasses RLS), so
-- only the client READ side needs a policy: an authenticated user may receive
-- broadcasts only on their OWN operator's channel.
--
-- realtime.messages is the table Supabase Realtime consults to authorize channel
-- access; RLS is enabled on it by default (deny-all with no policy). realtime.topic()
-- returns the joined channel topic. current_user_operator_id() is the existing
-- SECURITY DEFINER helper (search_path pinned), granted to `authenticated` in 0014.
--
-- The operator id is the 2nd colon segment of the topic. We compare it as TEXT
-- against current_user_operator_id()::text rather than casting the segment to uuid:
-- a non-operator topic would make `''::uuid` raise inside policy evaluation, whereas
-- text equality is cast-safe and simply does not match. The first-segment guard
-- keeps the policy scoped to operator channels. This is the decision-#6 multi-tenant
-- seam: one operator in v1, correct for many.

create policy "operator members read operator calls channel"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and split_part((select realtime.topic()), ':', 1) = 'operator'
  and split_part((select realtime.topic()), ':', 2) = public.current_user_operator_id()::text
);
