export type KioskScreen =
  | "home"
  | "disclosure"
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
  | { type: "CLOSE_DISCLOSURE" }
  | { type: "ACCEPT_DISCLOSURE"; callId: string; channelName: string }
  | { type: "AGENT_JOINED" }
  | { type: "RING_TIMEOUT" }
  | { type: "CANCEL" }
  | { type: "END_CALL" }
  | { type: "DISMISS_APOLOGY" }
  | { type: "ERROR" };

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

function home(): KioskState {
  return initialState();
}

export function reduce(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "TAP_CALL":
      return state.screen === "home" ? { ...state, screen: "disclosure" } : state;
    case "CLOSE_DISCLOSURE":
      return state.screen === "disclosure" ? home() : state;
    case "ACCEPT_DISCLOSURE":
      return {
        screen: "ringing",
        callId: action.callId,
        channelName: action.channelName,
      };
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
    default:
      return state;
  }
}
