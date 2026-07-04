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
      <button onClick={() => publishActive(activeCall)}>publish active</button>
      <button onClick={() => publishActive(null)}>clear active</button>
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
