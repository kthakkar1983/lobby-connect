export type KioskScreen =
  | "home"
  | "incoming"
  | "ringing"
  | "connected"
  | "apology";

export interface KioskState {
  screen: KioskScreen;
  callId: string | null;
  channelName: string | null;
}

export type KioskAction =
  | { type: "TAP_CALL" }
  | { type: "CALL_STARTED"; callId: string; channelName: string }
  | { type: "AGENT_JOINED" }
  | { type: "RING_TIMEOUT" }
  | { type: "CANCEL" }
  | { type: "END_CALL" }
  | { type: "DISMISS_APOLOGY" }
  | { type: "ERROR" }
  | { type: "INCOMING_CALL"; callId: string; channelName: string }
  | { type: "INCOMING_EXPIRED" }
  | { type: "ANSWER" }
  | { type: "DROP" };

export function initialState(): KioskState {
  return { screen: "home", callId: null, channelName: null };
}

/**
 * The 120s ring timer is a *no-answer* cutoff: it only means anything while the
 * call is still ringing. It is armed when ringing begins and must be cancelled
 * on connect — but if it ever fires after the agent has joined, this guard keeps
 * it inert so a live call is never torn down out from under the kiosk.
 */
export function shouldFireRingTimeout(screen: KioskScreen): boolean {
  return screen === "ringing";
}

/**
 * The max-call-duration cap (cost backstop) ends a call only while it is
 * connected. If the cap timer ever fires after the call already returned
 * home/apology, this guard keeps it inert so it can't disturb a fresh state.
 */
export function shouldEndForMaxDuration(screen: KioskScreen): boolean {
  return screen === "connected";
}

/** True while a post-drop tap lockout is still in effect. */
export function isLockedOut(lockedUntilMs: number | null, nowMs: number): boolean {
  return lockedUntilMs != null && nowMs < lockedUntilMs;
}

function home(): KioskState {
  return initialState();
}

export function reduce(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "TAP_CALL":
      // Tap starts connecting immediately; the async call setup follows and
      // reports its ids via CALL_STARTED. No blocking consent screen.
      return state.screen === "home" ? { ...state, screen: "ringing" } : state;
    case "CALL_STARTED":
      // Guarded like the other transitions: if the call was cancelled mid-connect
      // (screen already back to home), a late CALL_STARTED must not write stale ids.
      return state.screen === "ringing"
        ? { ...state, callId: action.callId, channelName: action.channelName }
        : state;
    case "AGENT_JOINED":
      return state.screen === "ringing" ? { ...state, screen: "connected" } : state;
    case "RING_TIMEOUT":
      return state.screen === "ringing" ? { ...state, screen: "apology" } : state;
    case "CANCEL":
      return home();
    case "END_CALL":
      return home();
    case "DISMISS_APOLOGY":
      return home();
    case "ERROR":
      return { ...state, screen: "apology" };
    case "INCOMING_CALL":
      // Only ring an idle kiosk; ignore if mid-call (an active call owns the screen).
      return state.screen === "home"
        ? { screen: "incoming", callId: action.callId, channelName: action.channelName }
        : state;
    case "INCOMING_EXPIRED":
      // The agent-initiated call we were ringing went away (agent cancelled, the
      // 30s no-answer window lapsed, or it was answered elsewhere). Return home
      // instead of hanging on a dead ring. Guarded to the incoming screen so a
      // late poll result can't reset a call that has since progressed (e.g. the
      // guest already tapped Answer -> ringing).
      return state.screen === "incoming" ? home() : state;
    case "ANSWER":
      // Tap Answer -> reuse the "ringing" connecting screen; AGENT_JOINED -> connected.
      return state.screen === "incoming" ? { ...state, screen: "ringing" } : state;
    case "DROP":
      // Terminal mid-call drop -> home (App layers the 10s tap lockout separately).
      return initialState();
    default:
      return state;
  }
}
