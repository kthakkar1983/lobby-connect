import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import {
  CallSurfaceProvider,
  useCallSurface,
  type ActiveCallInfo,
} from "@/components/dashboard/call-surface-provider";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";

afterEach(() => {
  cleanup();
  delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
});

const p1: PropertyCardData = {
  id: "p1",
  name: "The Grand Hotel",
  timezone: "America/Chicago",
  callsTonight: 2,
  lastCallAt: null,
  openIncidents: 0,
};

const activeCall: ActiveCallInfo = {
  callId: "call-1",
  channel: "VIDEO",
  propertyId: "p1",
  propertyName: p1.name,
  onHold: false,
  answeredAt: 2_000,
  timeZone: "America/Chicago",
};

/** A fake PiP window: a real Document (createHTMLDocument) + spyable
 *  addEventListener/close, matching the surface openCallTile() touches. */
function makeFakePip() {
  const doc = document.implementation.createHTMLDocument("pip");
  const listeners = new Map<string, Array<() => void>>();
  const win = {
    document: doc,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    }),
    close: vi.fn(() => {
      // Real Document-PiP fires pagehide on close, whether user- or
      // programmatically-triggered — mirror that here.
      for (const fn of listeners.get("pagehide") ?? []) fn();
    }),
  };
  return { win: win as unknown as Window, fireUserClose: () => win.close() };
}

/** Probe publisher: exposes buttons that call the context's publish/register
 *  APIs (mirrors the idiom in call-surface-provider.test.tsx). */
function Publisher() {
  const { publishRings, publishActive, registerAcceptVideo } = useCallSurface();
  return (
    <div>
      <button
        onClick={() =>
          publishRings("video", [
            {
              key: "video:call-1",
              channel: "VIDEO",
              callId: "call-1",
              propertyId: "p1",
              propertyName: p1.name,
              since: Date.now() - 1_000,
            },
          ])
        }
      >
        publish video ring for p1
      </button>
      <button onClick={() => registerAcceptVideo((callId) => acceptVideoSpy(callId))}>
        register acceptVideo
      </button>
      <button onClick={() => publishActive(activeCall)}>publish active</button>
      <button onClick={() => publishActive(null)}>hang up</button>
    </div>
  );
}

/** Probe consumer: surfaces tileMount/tileClosedByUser for assertions. */
function TileProbe() {
  const { tileMount, tileClosedByUser } = useCallSurface();
  return (
    <div>
      <div data-testid="tile-open">{tileMount ? "yes" : "no"}</div>
      <div data-testid="tile-closed-by-user">{tileClosedByUser ? "yes" : "no"}</div>
    </div>
  );
}

let acceptVideoSpy: (callId: string) => void;
let callOrder: string[];

describe("call-tile-manager", () => {
  beforeEach(() => {
    callOrder = [];
    acceptVideoSpy = () => {};
  });

  it("Answer opens the tile (requestWindow) BEFORE the accept dispatch runs", async () => {
    const { win } = makeFakePip();
    const requestWindow = vi.fn(() => {
      callOrder.push("requestWindow");
      return Promise.resolve(win);
    });
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow,
    };
    acceptVideoSpy = () => {
      callOrder.push("acceptVideo");
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
        <TileProbe />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });

    // requestWindow (tile open) is synchronous inside the click; acceptVideo
    // (the registered dispatcher) runs in the same click handler, right after.
    expect(callOrder).toEqual(["requestWindow", "acceptVideo"]);
    expect(requestWindow).toHaveBeenCalledTimes(1);

    // The tile resolves asynchronously (a real Promise) — flush it, then it's open.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tile-open").textContent).toBe("yes");
  });

  it("a user-initiated pagehide (non-programmatic, call still active) sets tileClosedByUser", async () => {
    const { win, fireUserClose } = makeFakePip();
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.resolve(win)),
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
        <TileProbe />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish active").click(); // a call is active
    });
    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tile-open").textContent).toBe("yes");
    expect(screen.getByTestId("tile-closed-by-user").textContent).toBe("no");

    // The agent closes the tile window directly (not via our closeTile()) —
    // simulate the browser firing pagehide on that user action.
    await act(async () => {
      fireUserClose();
    });

    expect(screen.getByTestId("tile-open").textContent).toBe("no");
    expect(screen.getByTestId("tile-closed-by-user").textContent).toBe("yes");
  });

  it("hang-up closes the pip window (close() called) and clears tileClosedByUser", async () => {
    const { win, fireUserClose } = makeFakePip();
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.resolve(win)),
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
        <TileProbe />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish active").click();
    });
    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tile-open").textContent).toBe("yes");

    // Get the tile closed-by-user first, to prove hang-up resets the flag too.
    await act(async () => {
      fireUserClose();
    });
    await act(async () => {
      screen.getByText("register acceptVideo").click(); // no-op, just settling state
    });

    // Re-open the tile is NOT required for this assertion; instead exercise the
    // direct case: publish active again is unrealistic (active is already set),
    // so directly assert on the close spy from the FIRST open + hang-up path.
    // Re-render with a fresh handle: reopen deliberately, then hang up.
    const secondPip = makeFakePip();
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.resolve(secondPip.win)),
    };
    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tile-open").textContent).toBe("yes");

    await act(async () => {
      screen.getByText("hang up").click();
    });

    expect(secondPip.win.close as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tile-open").textContent).toBe("no");
    expect(screen.getByTestId("tile-closed-by-user").textContent).toBe("no");
  });

  it("with no DocPiP support, Answer still dispatches accept normally and does not crash", async () => {
    // window.documentPictureInPicture stays undefined (default jsdom + afterEach cleanup).
    acceptVideoSpy = () => {
      callOrder.push("acceptVideo");
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
        <TileProbe />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    expect(() => {
      act(() => {
        screen.getByRole("button", { name: "Answer" }).click();
      });
    }).not.toThrow();

    expect(callOrder).toEqual(["acceptVideo"]);
    expect(screen.getByTestId("tile-open").textContent).toBe("no");
  });
});
