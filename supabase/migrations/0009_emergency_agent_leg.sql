-- 0009: persist the agent's conference leg SID for emergency-call control (Plan 6c fix).
-- After the agent's Client leg is redirected into the emergency conference, the
-- browser Voice SDK can no longer control it; the agent's mute/leave are driven
-- server-side via the Conference Participant API, which needs this SID.
alter table calls
  add column if not exists emergency_agent_call_sid text;
