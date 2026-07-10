import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

import {
  CallSurfaceProvider,
  useCallSurface,
  type ActiveCallInfo,
} from "@/components/dashboard/call-surface-provider";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { preparePipDocument } from "@/lib/duty-tile/pip-document";

// Real-video-flow test deps (pins review fold-in I-1: VideoCallHost publishes
// `active`, not just rings). VideoCallHost's own detection hook needs a fake
// realtime channel + ringtone (mirrors use-incoming-video-calls.test.tsx /
// softphone.test.tsx's loop-guard test); its downstream full-screen VideoCall
// is stubbed out entirely — I-1 is about the HOST's publish, not the LiveKit
// join machinery, which has its own dedicated coverage elsewhere.
const videoChannel = vi.hoisted(() => ({
  on: vi.fn(function (this: unknown) {
    return this;
  }),
  subscribe: vi.fn(function (this: unknown, cb: (status: string) => void) {
    cb("SUBSCRIBED");
    return this;
  }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    realtime: { setAuth: () => {} },
    channel: () => videoChannel,
    removeChannel: () => {},
  }),
}));
vi.mock("@/lib/video/ringtone", () => ({
  createRingtone: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/components/video-call/video-call", () => ({
  VideoCall: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close video call (host onClose)</button>
  ),
}));

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
      <button onClick={() => publishActive("VIDEO", activeCall)}>publish active</button>
      <button onClick={() => publishActive("VIDEO", null)}>hang up</button>
      <button onClick={() => publishActive("AUDIO", null)}>audio phase-flap null</button>
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

  it("an off-channel null publish can't wipe the reopen flag (the softphone phase-flap bug)", async () => {
    // 2026-07-07 staging root cause: closing the tile focuses the tab → the
    // softphone's error-phase reconnect self-heal flaps `phase` → its publisher
    // publishes an AUDIO null while the VIDEO call is live → the slot cleared →
    // the auto-close effect reset tileClosedByUser milliseconds after the
    // user-close set it. Ownership in publishActive must prevent the wipe.
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
      screen.getByText("publish active").click(); // VIDEO call live
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
    await act(async () => {
      fireUserClose(); // agent closes the tile mid-call
    });
    expect(screen.getByTestId("tile-closed-by-user").textContent).toBe("yes");

    // The tab regains focus → the softphone's publisher fires an AUDIO null.
    await act(async () => {
      screen.getByText("audio phase-flap null").click();
    });

    // The VIDEO slot survives, so the reopen flag must too.
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

  /**
   * Review fold-in M-1: if preparing the just-opened PiP document throws (e.g.
   * a hostile/unexpected document shape), the window must be closed rather
   * than left orphaned with no handle anywhere in the app (unreachable by the
   * agent, and by our own tileHandleRef). A `pip.document` whose `.head` is
   * missing makes preparePipDocument's `target.head.appendChild(...)` throw.
   */
  it("M-1: closes the pip window if preparing the document throws (no orphaned window)", async () => {
    acceptVideoSpy = () => {};
    const closeSpy = vi.fn();
    // A document-shaped object with NO .head — preparePipDocument's very first
    // stylesheet-copy loop appending into target.head throws a TypeError.
    const brokenDoc = { title: "", documentElement: { className: "" }, body: {} };
    const win = {
      document: brokenDoc,
      addEventListener: vi.fn(),
      close: closeSpy,
    };
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
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });
    // The throw happens INSIDE the .then() — must not escape as an unhandled
    // rejection or crash the click handler.
    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
    // No orphan: the tile never reports itself open (onReady never ran).
    expect(screen.getByTestId("tile-open").textContent).toBe("no");
  });

  /**
   * Review fold-in I-1: before Task 17, only the audio softphone published
   * `active` into the CallSurfaceProvider, so the tile's auto-close/reopen
   * (which keys off `active`) silently no-op'd for VIDEO — a video tile that
   * outlived its call. This drives the REAL VideoCallHost (not the Publisher
   * probe's synthetic "publish active" button) end-to-end: a real incoming
   * ring from /api/calls/incoming-video, a real Answer click (which opens the
   * tile AND calls the host's registered acceptVideo), and the host's own
   * onClose (stubbed VideoCall's close button) — proving publishActive(VIDEO)
   * fires on answer and publishActive(null) fires on hang-up, closing the tile.
   */
  it("a REAL video answer/hang-up flow (VideoCallHost) drives the tile's auto-close via publishActive", async () => {
    const { win } = makeFakePip();
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.resolve(win)),
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/calls/incoming-video") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              calls: [
                {
                  id: "call-1",
                  channelName: "ch-1",
                  propertyName: p1.name,
                  propertyId: p1.id,
                  ringStartedAt: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CallSurfaceProvider>
        <VideoCallHost operatorId="op-1" />
        <PropertyCard property={p1} />
        <TileProbe />
      </CallSurfaceProvider>,
    );

    // The real ring surfaces the card's Answer button (no Publisher involved).
    await waitFor(() => screen.getByRole("button", { name: "Answer" }));

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    // Tile open (requestWindow) resolves asynchronously.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tile-open").textContent).toBe("yes");

    // The host mounted its (stubbed) VideoCall and published VIDEO `active` —
    // proven by the auto-close reacting when the call ends below. Hang up via
    // the host's real onClose path (the stubbed VideoCall's close button).
    await act(async () => {
      screen.getByText("close video call (host onClose)").click();
    });

    // publishActive(null) fired from the host → the provider's auto-close
    // effect closed the tile — the exact behavior I-1 was missing.
    expect(screen.getByTestId("tile-open").textContent).toBe("no");
    expect(screen.getByTestId("tile-closed-by-user").textContent).toBe("no");

    vi.unstubAllGlobals();
  });
});

describe("preparePipDocument", () => {
  // Batch-1 polish (2026-07-10): the PiP html/body/mount chain had no height, so
  // the tile's `h-full` root collapsed to content height and the browser's white
  // canvas showed below it (the "white block"). The prep must fill the window
  // height so the navy body (and, on video, `object-cover` guest video) fills it.
  it("fills the window height (html/body/mount = 100%) so no white gap shows below the tile", () => {
    const doc = document.implementation.createHTMLDocument("pip");
    const mount = preparePipDocument(doc);

    expect(doc.documentElement.style.height).toBe("100%");
    expect(doc.body.style.height).toBe("100%");
    expect(mount.style.height).toBe("100%");
    // Body still carries the navy fill (unchanged) so the filled area is navy.
    expect(doc.body.className).toContain("bg-primary");
  });
});
