import type { Event } from "@sentry/nextjs";

// Markers the Twilio Voice SDK logs to the console while its signalling
// websocket drops and re-establishes (close 1005 -> TransportError 31009).
const TWILIO_TRANSPORT_MARKERS = ["TransportError", "WSTransport", "31009"];

/**
 * The agent/admin softphone keeps a Twilio Voice `Device` registered in the
 * browser. Its signalling websocket periodically drops and reconnects on its
 * own; during that churn the SDK rejects an internal promise with `undefined`,
 * which the browser reports as an UnhandledRejection carrying no stack and no
 * value — zero diagnostic signal, and it does not affect the call.
 *
 * We drop ONLY that empty rejection, and ONLY when the breadcrumb trail shows
 * it was preceded by Twilio transport churn — so a genuine empty rejection from
 * our own code (which we *would* want to see) is still reported.
 */
export function isTwilioTransportNoise(event: Pick<Event, "exception" | "breadcrumbs">): boolean {
  const first = event.exception?.values?.[0];
  const isEmptyRejection =
    first?.type === "UnhandledRejection" &&
    typeof first.value === "string" &&
    first.value.includes("Non-Error promise rejection captured with value: undefined");
  if (!isEmptyRejection) return false;

  const breadcrumbs = Array.isArray(event.breadcrumbs) ? event.breadcrumbs : [];
  return breadcrumbs.some((crumb) => {
    const message = typeof crumb?.message === "string" ? crumb.message : "";
    return (
      message.includes("TwilioVoice") &&
      TWILIO_TRANSPORT_MARKERS.some((marker) => message.includes(marker))
    );
  });
}
