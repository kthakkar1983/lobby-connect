/**
 * Kiosk user-facing copy (Stage 3, spec §6). Guest-facing voice: reassuring,
 * human, calm (Stage 0 §5). Tiny standalone mirror of the portal's lib/copy —
 * the two apps are separate build graphs.
 */
export const copy = {
  loading: "Getting things ready…",
  recording: {
    heading: "Before we connect you",
    body: "Your call with the front desk may be recorded for training and quality. Tap continue when you're ready.",
    action: "Continue",
  },
  apology: {
    heading: "Sorry to keep you waiting.",
    fallback:
      "The front desk is helping another guest right now. Please try again in a couple of minutes.",
  },
  reconnecting: {
    title: "Reconnecting…",
    subtitle: "Hold tight — we're getting you back.",
  },
} as const;
