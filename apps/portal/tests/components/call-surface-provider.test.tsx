import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup, renderHook } from "@testing-library/react";

import {
  CallSurfaceProvider,
  useCallSurface,
  useCallSurfaceOptional,
  type IncomingRing,
  type ActiveCallInfo,
} from "@/components/dashboard/call-surface-provider";

afterEach(() => cleanup());

const videoRing: IncomingRing = {
  key: "call-1",
  channel: "VIDEO",
  callId: "call-1",
  propertyId: "prop-1",
  propertyName: "The Grand Hotel",
  since: 1_000,
};

const silenceableRing: IncomingRing = {
  key: "video:call-1",
  channel: "VIDEO",
  callId: "call-1",
  propertyId: "prop-1",
  propertyName: "The Grand Hotel",
  since: 1_000,
};

const activeCall: ActiveCallInfo = {
  callId: "call-1",
  channel: "VIDEO",
  propertyId: "prop-1",
  propertyName: "The Grand Hotel",
  onHold: false,
  answeredAt: 2_000,
  timeZone: "America/New_York",
};

/** Publisher: exposes buttons that call the context's publish/register APIs. */
function Publisher() {
  const { publishRings, publishActive, registerAcceptVideo } = useCallSurface();
  return (
    <div>
      <button onClick={() => publishRings("video", [videoRing])}>publish rings</button>
      <button onClick={() => publishRings("video", [])}>clear rings</button>
      <button onClick={() => publishActive("VIDEO", activeCall)}>publish active</button>
      <button onClick={() => publishActive("VIDEO", null)}>clear active</button>
      <button onClick={() => publishActive("AUDIO", null)}>audio clears active</button>
      <button onClick={() => registerAcceptVideo((callId) => acceptVideoSpy(callId))}>
        register acceptVideo
      </button>
      <button onClick={() => registerAcceptVideo(null)}>unregister acceptVideo</button>
    </div>
  );
}

/** Consumer: renders the snapshot + a button wired to the live acceptVideo action. */
function Consumer() {
  const { rings, active, actions } = useCallSurface();
  return (
    <div>
      <div data-testid="ring-count">{rings.length}</div>
      <div data-testid="ring-property">{rings[0]?.propertyName ?? "none"}</div>
      <div data-testid="active-property">{active?.propertyName ?? "none"}</div>
      <div data-testid="accept-video-registered">{actions.acceptVideo ? "yes" : "no"}</div>
      <button onClick={() => actions.acceptVideo?.("call-1")}>Answer</button>
    </div>
  );
}

let acceptVideoSpy: (callId: string) => void;

describe("CallSurfaceProvider", () => {
  it("mirrors publishRings from a publisher into a separate consumer", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <Consumer />
      </CallSurfaceProvider>,
    );

    expect(screen.getByTestId("ring-count").textContent).toBe("0");

    await act(async () => {
      screen.getByText("publish rings").click();
    });

    expect(screen.getByTestId("ring-count").textContent).toBe("1");
    expect(screen.getByTestId("ring-property").textContent).toBe("The Grand Hotel");
  });

  it("reaches a late-registered acceptVideo handler from the consumer (the ref/memo subtlety)", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);

    render(
      <CallSurfaceProvider>
        <Publisher />
        <Consumer />
      </CallSurfaceProvider>,
    );

    // Not registered yet — the consumer must see a null action.
    expect(screen.getByTestId("accept-video-registered").textContent).toBe("no");

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });

    // The consumer's memoized `actions` must refresh even though only a ref changed.
    expect(screen.getByTestId("accept-video-registered").textContent).toBe("yes");

    await act(async () => {
      screen.getByText("Answer").click();
    });

    expect(calls).toEqual(["call-1"]);
  });

  it("clears the action back to null on unregister", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <Consumer />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    expect(screen.getByTestId("accept-video-registered").textContent).toBe("yes");

    await act(async () => {
      screen.getByText("unregister acceptVideo").click();
    });
    expect(screen.getByTestId("accept-video-registered").textContent).toBe("no");
  });

  it("mirrors publishActive, and clears it back to null", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <Consumer />
      </CallSurfaceProvider>,
    );

    expect(screen.getByTestId("active-property").textContent).toBe("none");

    await act(async () => {
      screen.getByText("publish active").click();
    });
    expect(screen.getByTestId("active-property").textContent).toBe("The Grand Hotel");

    await act(async () => {
      screen.getByText("clear active").click();
    });
    expect(screen.getByTestId("active-property").textContent).toBe("none");
  });

  it("a null from the OTHER channel cannot clear the slot (publisher ownership)", async () => {
    // Root cause of the 2026-07-07 reopen-affordance bug: closing the tile
    // focuses the tab, the softphone's error-phase reconnect self-heal flaps
    // `phase`, its publisher re-runs and publishes an AUDIO null mid-VIDEO-call
    // — which used to wipe the slot (and with it the reopen flag). A publisher
    // may only clear what it owns.
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <Consumer />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish active").click();
    });
    expect(screen.getByTestId("active-property").textContent).toBe("The Grand Hotel");

    await act(async () => {
      screen.getByText("audio clears active").click(); // the softphone phase-flap publish
    });
    expect(screen.getByTestId("active-property").textContent).toBe("The Grand Hotel");

    await act(async () => {
      screen.getByText("clear active").click(); // the owner's null still clears
    });
    expect(screen.getByTestId("active-property").textContent).toBe("none");
  });

  it("useCallSurface throws when rendered outside the provider", () => {
    const { result } = renderHook(() => {
      try {
        return { value: useCallSurface(), error: null };
      } catch (error) {
        return { value: null, error: error as Error };
      }
    });
    expect(result.current.value).toBeNull();
    expect(result.current.error?.message).toBe(
      "useCallSurface must be used inside CallSurfaceProvider",
    );
  });

  it("silenceRing adds a key, is idempotent, and prunes a key once its ring stops (auto-reset)", async () => {
    acceptVideoSpy = () => {};

    /** Silence harness: publishes the silenceable ring, silences it, clears it,
     *  and surfaces the silenced-key state. */
    function SilenceHarness() {
      const { silencedKeys, silenceRing, publishRings } = useCallSurface();
      return (
        <div>
          <div data-testid="silenced-count">{silencedKeys.size}</div>
          <div data-testid="has-key">{silencedKeys.has("video:call-1") ? "yes" : "no"}</div>
          <button onClick={() => publishRings("video", [silenceableRing])}>publish silenceable ring</button>
          <button onClick={() => publishRings("video", [])}>clear silenceable ring</button>
          <button onClick={() => silenceRing("video:call-1")}>silence</button>
        </div>
      );
    }

    render(
      <CallSurfaceProvider>
        <SilenceHarness />
      </CallSurfaceProvider>,
    );

    // Publish the ring, then silence it → the key is present.
    await act(async () => {
      screen.getByText("publish silenceable ring").click();
    });
    await act(async () => {
      screen.getByText("silence").click();
    });
    expect(screen.getByTestId("silenced-count").textContent).toBe("1");
    expect(screen.getByTestId("has-key").textContent).toBe("yes");

    // Silencing again is idempotent — still exactly one key.
    await act(async () => {
      screen.getByText("silence").click();
    });
    expect(screen.getByTestId("silenced-count").textContent).toBe("1");

    // The ring goes away → the prune effect drops the now-stale silenced key.
    await act(async () => {
      screen.getByText("clear silenceable ring").click();
    });
    expect(screen.getByTestId("silenced-count").textContent).toBe("0");
    expect(screen.getByTestId("has-key").textContent).toBe("no");
  });

  it("exposes an empty silencedKeys set by default", () => {
    const inside = renderHook(() => useCallSurfaceOptional(), {
      wrapper: CallSurfaceProvider,
    });
    expect(inside.result.current?.silencedKeys.size).toBe(0);
  });

  it("useCallSurfaceOptional returns null outside the provider and the value inside", () => {
    const outside = renderHook(() => useCallSurfaceOptional());
    expect(outside.result.current).toBeNull();

    const inside = renderHook(() => useCallSurfaceOptional(), {
      wrapper: CallSurfaceProvider,
    });
    expect(inside.result.current).not.toBeNull();
    expect(inside.result.current?.rings).toEqual([]);
    expect(inside.result.current?.active).toBeNull();
  });
});
