-- 0014: Actually remove `anon` EXECUTE on the SECURITY DEFINER helpers.
--
-- 0013's `revoke ... from anon` was a no-op: these functions are granted EXECUTE
-- to PUBLIC by default at creation, and `anon` inherits from PUBLIC. To remove
-- anon's access we must revoke from PUBLIC and re-grant explicitly to the roles
-- that genuinely need it. `authenticated` evaluates the SELECT/owner helpers
-- inside RLS; `service_role` is kept so service-role writes that fire the
-- column-guard triggers never hit a permission error. anon never needs them
-- (no RLS policy targets anon).
do $$
declare f text;
  fns text[] := array[
    'current_user_operator_id()',
    'current_user_role()',
    'user_owns_property(uuid)',
    'user_is_assigned_to_property(uuid)',
    'enforce_owner_incident_columns()',
    'enforce_owner_property_columns()',
    'enforce_profile_self_columns()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
