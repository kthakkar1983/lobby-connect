/**
 * A client-side nudge fired when the agent transitions to actively working —
 * Resume (from break) or Go on duty. The incoming-video poll listens for it and
 * re-fetches IMMEDIATELY.
 *
 * Why it's needed: while she's on break / off duty, GET /api/calls/incoming-video
 * returns [] (her raw status is BREAK/AWAY/OFFLINE — isVideoSilencedStatus). A
 * call that started ringing during that window already fired its one
 * `calls-changed` realtime broadcast, so nothing re-ticks the poll when she comes
 * back — the still-ringing call only surfaces on the 60s fallback poll or a manual
 * refresh. This event closes that gap so it appears the instant she resumes.
 *
 * Producer: components/dashboard/duty-provider.tsx (resume / goOnDuty).
 * Consumer: lib/hooks/use-incoming-video-calls.ts.
 */
export const DUTY_ACTIVATED_EVENT = "lc-duty-active";
