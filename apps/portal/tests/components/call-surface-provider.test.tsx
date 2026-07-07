import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup, renderHook, waitFor } from "@testing-library/react";

const { fetchRemoteCredentials, launchRustdesk } = vi.hoisted(() => ({
  fetchRemoteCredentials: vi.fn(),
  launchRustdesk: vi.fn(),
}));

vi.mock("@/lib/remote-access/connect", () => ({
  fetchRemoteCredentials: (...args: unknown[]) => fetchRemoteCredentials(...args),
  launchRustdesk: (...args: unknown[]) => launchRustdesk(...args),
}));

import {
  CallSurfaceProvider,
  useCallSurface,
  useCallSurfaceOptional,
  type IncomingRing,
  type ActiveCallInfo,
} from "@/components/dashboard/call-surface-provider";
import type { RemoteCredentials } from "@/lib/remote-access/connect";

afterEach(() => cleanup());

beforeEach(() => {
  fetchRemoteCredentials.mockReset();
  launchRustdesk.mockReset();
  // Default: nothing configured — individual tests override.
  fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: true });
});

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

  describe("remote-access pre-warm + connectToProperty", () => {
    /** Publishes arbitrary ActiveCallInfo objects and drives connectToProperty,
     *  surfacing the last result so tests can assert launched/notConfigured. */
    function PrewarmHarness() {
      const { publishActive, connectToProperty } = useCallSurface();
      return (
        <div>
          {/* Same callId, DIFFERENT object each click (fresh timeZone) — the
              softphone's mid-call republish. */}
          <button
            onClick={() =>
              publishActive("AUDIO", {
                callId: "call-1",
                channel: "AUDIO",
                propertyId: "prop-1",
                propertyName: "Hotel A",
                onHold: false,
                answeredAt: 2_000,
                timeZone: null,
              })
            }
          >
            publish call-1 (tz null)
          </button>
          <button
            onClick={() =>
              publishActive("AUDIO", {
                callId: "call-1",
                channel: "AUDIO",
                propertyId: "prop-1",
                propertyName: "Hotel A",
                onHold: false,
                answeredAt: 2_000,
                timeZone: "America/New_York",
              })
            }
          >
            republish call-1 (tz set)
          </button>
          <button onClick={() => publishActive("AUDIO", null)}>clear active</button>
          <button
            onClick={async () => {
              const r = await connectToProperty("prop-1");
              const el = document.getElementById("connect-result")!;
              el.textContent = JSON.stringify(r);
            }}
          >
            connect prop-1
          </button>
          <div id="connect-result" data-testid="connect-result" />
        </div>
      );
    }

    it("pre-warms EXACTLY ONCE per call despite the mid-call republish (primitive deps)", async () => {
      fetchRemoteCredentials.mockResolvedValue({
        ok: true,
        creds: { peerId: "p", password: "w" },
      });
      render(
        <CallSurfaceProvider>
          <PrewarmHarness />
        </CallSurfaceProvider>,
      );

      await act(async () => {
        screen.getByText("publish call-1 (tz null)").click();
      });
      await act(async () => {
        screen.getByText("republish call-1 (tz set)").click();
      });

      // Same callId → one pre-warm fetch only (republish + StrictMode deduped).
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(1));
      expect(fetchRemoteCredentials).toHaveBeenCalledWith("prop-1", "prewarm");
    });

    it("clears the cache at call end so the next connect re-fetches", async () => {
      fetchRemoteCredentials.mockResolvedValue({
        ok: true,
        creds: { peerId: "p", password: "w" },
      });
      render(
        <CallSurfaceProvider>
          <PrewarmHarness />
        </CallSurfaceProvider>,
      );

      await act(async () => {
        screen.getByText("publish call-1 (tz null)").click();
      });
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(1));

      // Call ends → cache cleared.
      await act(async () => {
        screen.getByText("clear active").click();
      });

      // Now Connect must re-fetch (map was cleared) via the click path.
      await act(async () => {
        screen.getByText("connect prop-1").click();
      });
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(2));
      expect(fetchRemoteCredentials).toHaveBeenLastCalledWith("prop-1", "click");
      expect(launchRustdesk).toHaveBeenCalledTimes(1);
    });

    it("a cache HIT launches synchronously (before awaiting) and skips the click-fetch", async () => {
      fetchRemoteCredentials.mockResolvedValue({
        ok: true,
        creds: { peerId: "p", password: "w" },
      });
      render(
        <CallSurfaceProvider>
          <PrewarmHarness />
        </CallSurfaceProvider>,
      );

      // Pre-warm resolves and populates the cache.
      await act(async () => {
        screen.getByText("publish call-1 (tz null)").click();
      });
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(1));

      // Connect hits the cache: no additional fetch, launch fired.
      await act(async () => {
        screen.getByText("connect prop-1").click();
      });
      expect(fetchRemoteCredentials).toHaveBeenCalledTimes(1); // NO click-fetch
      expect(launchRustdesk).toHaveBeenCalledTimes(1);
      expect(launchRustdesk).toHaveBeenCalledWith({ peerId: "p", password: "w" });
      await waitFor(() =>
        expect(screen.getByTestId("connect-result").textContent).toBe(
          JSON.stringify({ launched: true }),
        ),
      );
    });

    it("a 404 pre-warm ('not-configured') is bypassed by a click, which still 404s", async () => {
      fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: true });
      render(
        <CallSurfaceProvider>
          <PrewarmHarness />
        </CallSurfaceProvider>,
      );

      // Pre-warm writes the negative-cache entry.
      await act(async () => {
        screen.getByText("publish call-1 (tz null)").click();
      });
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(1));

      // Connect must STILL fetch (click never trusts the negative cache).
      await act(async () => {
        screen.getByText("connect prop-1").click();
      });
      await waitFor(() => expect(fetchRemoteCredentials).toHaveBeenCalledTimes(2));
      expect(fetchRemoteCredentials).toHaveBeenLastCalledWith("prop-1", "click");
      expect(launchRustdesk).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId("connect-result").textContent).toBe(
          JSON.stringify({ launched: false, notConfigured: true }),
        ),
      );
    });

    it("a pre-warm that resolves AFTER active went null never populates the cache (stale guard)", async () => {
      // Deferred pre-warm resolution — we resolve it manually after clearing active.
      let resolvePrewarm!: (v: { ok: true; creds: RemoteCredentials }) => void;
      fetchRemoteCredentials.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePrewarm = resolve as typeof resolvePrewarm;
          }),
      );
      render(
        <CallSurfaceProvider>
          <PrewarmHarness />
        </CallSurfaceProvider>,
      );

      await act(async () => {
        screen.getByText("publish call-1 (tz null)").click();
      });
      // Call ends BEFORE the pre-warm resolves.
      await act(async () => {
        screen.getByText("clear active").click();
      });
      // Now the stale pre-warm resolves — the guard must drop it (cache stays empty).
      await act(async () => {
        resolvePrewarm({ ok: true, creds: { peerId: "stale", password: "x" } });
      });

      // A subsequent connect must re-fetch (nothing cached) via the click path.
      fetchRemoteCredentials.mockResolvedValueOnce({ ok: false, notConfigured: true });
      await act(async () => {
        screen.getByText("connect prop-1").click();
      });
      expect(fetchRemoteCredentials).toHaveBeenLastCalledWith("prop-1", "click");
      expect(launchRustdesk).not.toHaveBeenCalled();
    });
  });
});
