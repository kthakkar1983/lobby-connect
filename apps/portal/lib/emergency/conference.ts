const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Stable per-call conference name. Doubles as the calls-row flag value. */
export function emergencyConferenceName(callId: string): string {
  return `emg-${callId}`;
}

/**
 * TwiML that joins a leg to the emergency conference. Used for BOTH the agent
 * leg (via REST redirect) and the guest leg (returned from /dial-result).
 * endConferenceOnExit=false so guest + 911 continue if the agent drops.
 */
export function buildConferenceTwiml(conferenceName: string): string {
  return (
    `${XML_DECL}<Response><Dial><Conference ` +
    `startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">` +
    `${escapeXml(conferenceName)}` +
    `</Conference></Dial></Response>`
  );
}

/** True when the call has been flagged for the emergency conference. */
export function shouldRouteToEmergencyConference(call: {
  emergency_conference_name: string | null;
}): boolean {
  return Boolean(call.emergency_conference_name);
}
