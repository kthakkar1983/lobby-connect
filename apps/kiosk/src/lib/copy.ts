/**
 * Kiosk user-facing copy (Stage 3, spec §6). Guest-facing voice: reassuring,
 * human, calm (Stage 0 §5). Tiny standalone mirror of the portal's lib/copy —
 * the two apps are separate build graphs.
 */
export const copy = {
  loading: "Getting things ready…",
  home: {
    // Shown on Home during the post-terminal-drop tap lockout (App.tsx):
    // the agent may be calling right back, so tap-to-call is briefly
    // disabled while the incoming poll keeps listening for that call-back.
    reconnecting: "Reconnecting you to the front desk — one moment.",
  },
  incoming: {
    title: "The front desk is calling",
    subtitle: "Tap Answer to connect",
    answer: "Answer",
  },
  ringing: {
    title: "Ringing the front desk…",
    subtitle: "Someone's almost there",
    recordingNote: "Calls may be recorded for quality",
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
  error: {
    heading: "One moment…",
    body: "Returning to the welcome screen.",
  },
} as const;
