/**
 * CallTile (Task 17): renders the tile's faces from the CallSurfaceProvider's
 * `active`/`guestVideoTrack`/`callControls`, purely mirror-only — it owns no
 * call state of its own. jsdom has no MediaStream constructor, so tests stub a
 * minimal one that just captures the tracks it was built from.
 *
 * The tile is portaled into a SEPARATE Document (the real Document-PiP
 * contract; call-tile-manager.test.tsx uses the same fake-pip harness), so
 * every query here is scoped via `within(pipDoc.body)`, not the bare `screen`
 * (which is bound to the main test document and would never see tile content).
 */

import { useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor, within } from "@testing-library/react";
import type * as RemoteAccessConnect from "@/lib/remote-access/connect";

// Phase E (Task 19b): the tile's Connect control calls the REAL
// connectToProperty (via the real CallSurfaceProvider below) — mock only its
// leaf dependencies (network fetch + navigation) so the test stays a unit test.
const remoteAccess = vi.hoisted(() => ({
  fetchRemoteCredentials: vi.fn(),
  launchRustdesk: vi.fn(),
}));
vi.mock("@/lib/remote-access/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteAccessConnect>();
  return {
    ...actual,
    fetchRemoteCredentials: remoteAccess.fetchRemoteCredentials,
    launchRustdesk: remoteAccess.launchRustdesk,
  };
});

import {
  CallSurfaceProvider,
  useCallSurface,
  type ActiveCallInfo,
  type RegisteredCallControls,
} from "@/components/dashboard/call-surface-provider";

// Minimal MediaStream stub: jsdom doesn't implement it. Captures the tracks it
// was constructed with so tests can assert the tile attached the RIGHT track.
class FakeMediaStream {
  tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeMediaStream);
  // jsdom's HTMLMediaElement.play() is unimplemented — stub it so the tile's
  // <video> mount doesn't spam "Not implemented" warnings (same pattern used
  // elsewhere for the audio ring/video overlays).
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  remoteAccess.fetchRemoteCredentials.mockReset();
  // Every publishActive() fires a "prewarm" fetch (call-surface-provider's own
  // effect) before any test-specific Connect click — default it to a benign
  // miss so tests that don't care about Connect aren't broken by an unhandled
  // rejection/undefined `.then()`. Connect-specific tests override as needed.
  remoteAccess.fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: true });
  remoteAccess.launchRustdesk.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
});

const audioActive: ActiveCallInfo = {
  callId: "call-audio-1",
  channel: "AUDIO",
  propertyId: "prop-1",
  propertyName: "The Grand Hotel",
  onHold: false,
  answeredAt: Date.now() - 65_000, // ~1:05 elapsed
  timeZone: "America/Chicago",
};

const videoActive: ActiveCallInfo = {
  callId: "call-video-1",
  channel: "VIDEO",
  propertyId: "prop-2",
  propertyName: "The Sample Inn",
  onHold: false,
  answeredAt: Date.now(),
  timeZone: null,
};

const videoActiveTz: ActiveCallInfo = { ...videoActive, timeZone: "America/Chicago" };

function makeControls(overrides: Partial<RegisteredCallControls> = {}): RegisteredCallControls {
  return {
    toggleMute: vi.fn(),
    muted: false,
    hangUp: vi.fn(),
    triggerEmergency: vi.fn(),
    ...overrides,
  };
}

/** Test harness: publishes active/guestVideoTrack/callControls via buttons so
 *  the real CallTile (portaled by the provider) can be exercised end-to-end. */
function Harness({
  active,
  controls,
  track,
}: {
  active: ActiveCallInfo | null;
  controls: RegisteredCallControls | null;
  track?: MediaStreamTrack | null;
}) {
  const {
    publishActive,
    registerCallControls,
    publishGuestVideoTrack,
    openTileForCall,
    publishCaptions,
    appendChatLine,
  } = useCallSurface();
  // Task 9: a monotonic per-render counter so repeated "publish guest chat"
  // clicks within one test always mint a distinct ChatLine id (the tile's
  // inbound-detection effect keys off id-change, not object identity).
  const chatSeqRef = useRef(0);
  return (
    <div>
      <button onClick={() => publishActive(active?.channel ?? "AUDIO", active)}>
        publish active
      </button>
      <button onClick={() => registerCallControls(controls)}>register controls</button>
      <button onClick={() => publishGuestVideoTrack(track ?? null)}>publish track</button>
      <button onClick={() => openTileForCall()}>open tile</button>
      <button onClick={() => publishCaptions(["Extra towels to 204"], "")}>publish captions</button>
      <button
        onClick={() => {
          chatSeqRef.current += 1;
          appendChatLine({
            id: `guest-chat-${chatSeqRef.current}`,
            from: "guest",
            text: "Is the pool open?",
            ts: Date.now(),
          });
        }}
      >
        publish guest chat
      </button>
    </div>
  );
}

/** A fake PiP window: a real Document (createHTMLDocument) + spyable
 *  addEventListener/close, matching call-tile-manager.test.tsx's harness. */
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
      for (const fn of listeners.get("pagehide") ?? []) fn();
    }),
  };
  return { win: win as unknown as Window, doc };
}

function renderTile(props: {
  active: ActiveCallInfo | null;
  controls: RegisteredCallControls | null;
  track?: MediaStreamTrack | null;
}) {
  const { win, doc } = makeFakePip();
  (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
    requestWindow: vi.fn(() => Promise.resolve(win)),
  };
  render(
    <CallSurfaceProvider>
      <Harness {...props} />
    </CallSurfaceProvider>,
  );
  return { pipDoc: doc };
}

async function openTile() {
  await act(async () => {
    screen.getByText("open tile").click();
  });
  await act(async () => {
    await Promise.resolve(); // flush the requestWindow promise
  });
}

describe("CallTile", () => {
  it("renders the audio face: property name + a ticking elapsed timer", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await openTile();

    const tile = within(pipDoc.body);
    expect(tile.getByText("The Grand Hotel")).toBeTruthy();
    // ~65s elapsed from answeredAt — the compact "m:ss" format shows 1:05.
    // ANCHORED: the audio face also renders the hotel wall clock ("11:04 PM"),
    // which contains "1:04"-style substrings at many times of day — an
    // unanchored regex intermittently double-matched and failed on wall-clock.
    await waitFor(() => expect(tile.getByText(/^1:0[4-6]$/)).toBeTruthy());
  });

  it("mounts a <video> whose srcObject received the published guest track", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();

    const video = await waitFor(() => {
      const el = pipDoc.body.querySelector("video");
      expect(el).toBeTruthy();
      return el as HTMLVideoElement;
    });
    const srcObject = video.srcObject as unknown as FakeMediaStream;
    expect(srcObject).toBeInstanceOf(FakeMediaStream);
    expect(srcObject.getTracks()).toEqual([track]);
  });

  // NOTE: elements inside the fake pip document have no `defaultView` (jsdom's
  // `document.implementation.createHTMLDocument()` produces a window-less
  // document), and `dom-accessibility-api` (which getByRole's accessible-name
  // matching depends on) throws "no window available" against such a document.
  // getByText matches on plain textContent (no accessible-name computation) and
  // a native `.click()` dispatches a real click without needing a window, so
  // both stay usable — only getByRole is avoided for pip-scoped queries.
  it("mute button calls the registered toggleMute spy and reflects muted state", async () => {
    const toggleMute = vi.fn();
    const { pipDoc } = renderTile({
      active: audioActive,
      controls: makeControls({ toggleMute, muted: false }),
    });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    // Icon-only in the tile now (labels dropped, 2026-07-21) — query by the
    // accessible name, not visible text. The button carries only its icon.
    const muteBtn = pipDoc.body.querySelector('[aria-label="Mute"]') as HTMLButtonElement;
    expect(muteBtn).toBeTruthy();
    expect(muteBtn.textContent?.trim()).toBe("");
    await act(async () => {
      muteBtn.click();
    });
    expect(toggleMute).toHaveBeenCalledOnce();
  });

  it("reflects muted state on the mute control's accessible label (icon-only)", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls({ muted: true }) });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    expect(pipDoc.body.querySelector('[aria-label="Unmute"]')).toBeTruthy();
    expect(pipDoc.body.querySelector('[aria-label="Mute"]')).toBeNull();
  });

  it("911 requires two taps: first arms (shows Confirm 911), second fires the trigger", async () => {
    vi.useFakeTimers();
    const triggerEmergency = vi.fn();
    const { pipDoc } = renderTile({
      active: audioActive,
      controls: makeControls({ triggerEmergency }),
    });
    await act(async () => {
      screen.getByText("publish active").click();
    });
    await act(async () => {
      screen.getByText("register controls").click();
    });
    await act(async () => {
      screen.getByText("open tile").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const tile = within(pipDoc.body);
    await act(async () => {
      tile.getByText("911").click();
    });
    expect(triggerEmergency).not.toHaveBeenCalled();
    expect(tile.getByText("Confirm 911")).toBeTruthy();

    await act(async () => {
      tile.getByText("Confirm 911").click();
    });
    expect(triggerEmergency).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("911 auto-reverts (un-arms) after the arm window without firing the trigger", async () => {
    vi.useFakeTimers();
    const triggerEmergency = vi.fn();
    const { pipDoc } = renderTile({
      active: audioActive,
      controls: makeControls({ triggerEmergency }),
    });
    await act(async () => {
      screen.getByText("publish active").click();
    });
    await act(async () => {
      screen.getByText("register controls").click();
    });
    await act(async () => {
      screen.getByText("open tile").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const tile = within(pipDoc.body);
    await act(async () => {
      tile.getByText("911").click();
    });
    expect(tile.getByText("Confirm 911")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(5_100);
    });

    expect(tile.getByText("911")).toBeTruthy();
    expect(triggerEmergency).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("hides the 911 control entirely when triggerEmergency is absent (video has no 911 path)", async () => {
    const { pipDoc } = renderTile({
      active: videoActive,
      controls: makeControls({ triggerEmergency: undefined }),
    });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    // queryByText (not queryByRole): no accessible-name computation needed, so
    // it works against the window-less pip document (see the note above).
    expect(within(pipDoc.body).queryByText("911")).toBeNull();
  });

  it("renders nothing when there is no active call (defensive)", () => {
    render(
      <CallSurfaceProvider>
        <Harness active={null} controls={null} />
      </CallSurfaceProvider>,
    );
    // tileMount stays null (no call → no reason to have opened one) → no portal
    // exists anywhere, so there's nothing to query for tile content.
    expect(screen.queryByText("The Grand Hotel")).toBeNull();
  });

  // Phase E (Task 19b): the tile's Connect control mirrors the property card's
  // ConnectButton via the same connectToProperty() on the surface. publishActive
  // pre-warms credentials in the background (call-surface-provider's own
  // effect), so a click that lands after the pre-warm resolved is a cache HIT —
  // it launches synchronously without a second ("click") fetch.
  it("Connect is enabled and launches remote access for the active call's property", async () => {
    remoteAccess.fetchRemoteCredentials.mockResolvedValue({
      ok: true,
      creds: { peerId: "peer-1", password: "pw" },
    });
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    // Let the background pre-warm fetch resolve and cache the creds.
    await waitFor(() =>
      expect(remoteAccess.fetchRemoteCredentials).toHaveBeenCalledWith(
        audioActive.propertyId,
        "prewarm",
      ),
    );

    const tile = within(pipDoc.body);
    const connectBtn = tile.getByText("Connect").closest("button") as HTMLButtonElement;
    expect(connectBtn.disabled).toBe(false);

    await act(async () => {
      connectBtn.click();
    });

    expect(remoteAccess.launchRustdesk).toHaveBeenCalledWith({ peerId: "peer-1", password: "pw" });
  });

  it("disables Connect when the active call has no propertyId", async () => {
    const { pipDoc } = renderTile({
      active: { ...audioActive, propertyId: null },
      controls: makeControls(),
    });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    const connectBtn = tile.getByText("Connect").closest("button") as HTMLButtonElement;
    expect(connectBtn.disabled).toBe(true);

    await act(async () => {
      connectBtn.click();
    });
    expect(remoteAccess.fetchRemoteCredentials).not.toHaveBeenCalled();
  });

  // Batch-1 polish (2026-07-10): 911 was 6px from Hang up in the control row —
  // the opposite of the full-screen overlay, which isolates it. It must NOT be a
  // sibling of the terminating button anymore (moved to the tile-face corner).
  // Task 5 (call-controls-column-polish, spec §3.3) relabelled Hang up → End
  // call; this test now pins the separation against the new label.
  it("keeps 911 out of the End call control row (accidental end→911 tap guard)", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    const btn911 = tile.getByText("911").closest("button"); // 911 keeps its visible label
    const endCall = pipDoc.body.querySelector('[aria-label="End call"]'); // End call is icon-only
    expect(btn911).toBeTruthy();
    expect(endCall).toBeTruthy();
    // Different parent element => not adjacent in the same control row.
    expect(btn911!.parentElement).not.toBe(endCall!.parentElement);
  });

  // The tile's terminating control carries "End call" as its accessible name and
  // never "Hang up". It is icon-only now (2026-07-21), so the name is on
  // aria-label, not visible text.
  it('the tile terminating control is "End call", not "Hang up" (icon-only)', async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    expect(pipDoc.body.querySelector('[aria-label="End call"]')).toBeTruthy();
    // "Hang up" must not exist as visible text OR as an accessible name.
    expect(within(pipDoc.body).queryByText("Hang up")).toBeNull();
    expect(pipDoc.body.querySelector('[aria-label="Hang up"]')).toBeNull();
  });

  // Spec §3.1: the bar leads with Connect and bookends with End call. Mute and
  // End call are icon-only (aria-label); Connect keeps its visible "Connect"
  // label — so rank each by whichever carries its name.
  it("orders the tile bar Connect … Mute … End call (Connect leads, End call bookends, spec §3.1)", async () => {
    const controls = makeControls({ triggerEmergency: undefined, sendChat: vi.fn(), sendTyping: vi.fn() });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    // Window-less pip → querySelectorAll, not getAllByRole.
    const buttons = Array.from(pipDoc.body.querySelectorAll("button"));
    const nameOf = (b: Element) => `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
    const connect = buttons.findIndex((b) => /connect/i.test(nameOf(b)));
    const mute = buttons.findIndex((b) => b.getAttribute("aria-label") === "Mute");
    const end = buttons.findIndex((b) => b.getAttribute("aria-label") === "End call");
    expect(connect).toBeGreaterThanOrEqual(0);
    expect(mute).toBeGreaterThanOrEqual(0);
    expect(connect).toBeLessThan(mute);
    expect(mute).toBeLessThan(end);
  });

  // The tile controls are icon-only round buttons now (2026-07-21). "End call"
  // once needed whitespace-nowrap so its longer label couldn't wrap; icon-only,
  // it is a fixed-size round button that cannot wrap — pin that shape + the
  // blaze fill (matching the agent overlay's End call) instead.
  it("renders End call as a fixed-size round blaze icon button, bookended right", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    const end = pipDoc.body.querySelector('[aria-label="End call"]') as HTMLElement;
    expect(end.className).toContain("rounded-full");
    expect(end.className).toContain("bg-attention");
    expect(end.className).toContain("ml-auto"); // far-right bookend
  });

  // Batch 2 a11y (Task 1): the tile face is bg-primary (navy), and the three
  // hand-rolled controls here (Mute via TileIconButton, 911, End call) had no
  // focus ring at all — a keyboard user tabbing through the tile couldn't see
  // where focus was. Pin the DARK ring recipe (ring-primary-foreground /
  // ring-offset-primary, tuned for the navy face) on all three. NOTE: getByRole
  // is unusable against this fake PiP document (see the harness NOTE above —
  // createHTMLDocument() has no defaultView and dom-accessibility-api throws),
  // so this reuses the file's own aria-label/getByText query style rather than
  // accessible-name matching.
  it("gives the tile's Mute, 911, and End call controls a focus ring visible on the navy face", async () => {
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    const muteBtn = pipDoc.body.querySelector('[aria-label="Mute"]') as HTMLButtonElement;
    const btn911 = tile.getByText("911").closest("button") as HTMLButtonElement;
    const endCallBtn = pipDoc.body.querySelector('[aria-label="End call"]') as HTMLButtonElement;

    for (const btn of [muteBtn, btn911, endCallBtn]) {
      expect(btn).toBeTruthy();
      expect(btn.className).toContain("focus-visible:ring-primary-foreground");
      expect(btn.className).toContain("focus-visible:ring-offset-primary");
    }
  });

  // Batch-1 polish (2026-07-10): the tile Connect was a near-invisible navy
  // outline. It gains the Monitor icon (like the overlays) + the teal accent
  // fill so it reads as "remote in".
  it("Connect carries a monitor icon and the teal accent so it reads as the remote-in action", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const connectBtn = within(pipDoc.body).getByText("Connect").closest("button") as HTMLButtonElement;
    expect(connectBtn.querySelector("svg")).toBeTruthy();
    expect(connectBtn.className).toContain("bg-accent");
  });

  // Spec §7's behavioural gap. The tile's Connect called connectToProperty as a
  // bare `void` with no catch, so a failed remote-access launch was SILENT — and
  // the tile is the surface the agent is most likely to be looking at when she
  // presses it, with the tab backgrounded behind RustDesk.
  it("surfaces a failed remote-access launch instead of failing silently", async () => {
    // The default beforeEach outcome: a 404, i.e. no credentials configured.
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    await act(async () => {
      (tile.getByText("Connect").closest("button") as HTMLButtonElement).click();
    });

    // Neither findBy* nor *ByRole works against the fake PiP document:
    // createHTMLDocument() has no defaultView, so waitFor's getWindowFromNode
    // throws and byRole's visibility check dereferences a null window for
    // getComputedStyle. A plain querySelector is the portable form here — which
    // is why every other assertion in this file is getByText or querySelector.
    await waitFor(() =>
      expect(pipDoc.body.querySelector('[role="alert"]')).not.toBeNull(),
    );
    const alert = pipDoc.body.querySelector('[role="alert"]') as HTMLElement;
    // The COMPACT wording, deliberately not the overlays' full string. This
    // window is 380x300 (TILE_WIDTH/TILE_HEIGHT) and the bar beside this button
    // already carries Mute, End call and the caption toggle, so the wrapper
    // shrinks toward min-content: "No remote access configured. Ask an admin."
    // wraps to roughly four lines of text-xs there. Both strings say the same
    // two things — whose problem it is, and whether pressing again helps.
    expect(alert.textContent).toBe("No credentials. Ask an admin.");
    // Blaze, not the light surfaces' red: `text-destructive` (#C81E1E) reads at
    // roughly 2.5:1 on the tile's navy bar and fails AA. This is what
    // `surface="dark"` buys, and it is the whole reason the prop exists.
    expect(alert.className).toContain("text-attention");
    // OUT OF FLOW. Rendering this must not resize the control bar it belongs
    // to: in flow it grows the bar from ~40px to ~100px of a 300px window and
    // permanently shrinks the guest's video face, with no dismissal short of a
    // successful retry. jsdom does no layout, so the mechanism is what can be
    // pinned here — offsetHeight is 0 for everything either way.
    expect(alert.className).toContain("absolute");
  });

  it("clears a previous Connect failure once a later attempt launches", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    const connectBtn = tile.getByText("Connect").closest("button") as HTMLButtonElement;
    await act(async () => connectBtn.click());
    await waitFor(() => expect(pipDoc.body.querySelector('[role="alert"]')).not.toBeNull());

    // A stale failure left on screen after a working retry reads as "still
    // broken" for the rest of the call — in a window the size of a postcard.
    remoteAccess.fetchRemoteCredentials.mockResolvedValue({
      ok: true,
      creds: { peerId: "peer-1", password: "pw" },
    });
    await act(async () => connectBtn.click());
    await waitFor(() => expect(pipDoc.body.querySelector('[role="alert"]')).toBeNull());
  });

  // The tile lives in a Document-PiP window the size of a postcard. Task 14 put
  // it on the shared <PropertyActionButton>, whose CARD scale (`sm`, h-8) would
  // be visibly oversized here — `size="xs"` is the tile's, and the reason that
  // variant exists.
  it("keeps the tile's Connect at the compact PiP scale, not the card scale", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const connectBtn = within(pipDoc.body).getByText("Connect").closest("button") as HTMLButtonElement;
    expect(connectBtn.className).toContain("h-6");
    expect(connectBtn.className).not.toContain("h-8");
  });

  it("renders the hotel-clock chip on the video face when a timezone is present", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActiveTz, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    expect(pipDoc.body.querySelector('[data-testid="hotel-clock-chip"]')).toBeTruthy();
  });

  it("omits the hotel-clock chip on video when there is no timezone", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    expect(pipDoc.body.querySelector('[data-testid="hotel-clock-chip"]')).toBeNull();
  });

  // Copy fix (2026-07-23, uiux-polish-batch4-copy): the copy guide
  // (docs/brand/ui-copy-guide.md) settles on ONE noun for a property,
  // "Property" — "Hotel" was the odd one out on both tile faces. The
  // data-testid stays "hotel-clock-chip" (a code identifier, out of scope
  // for this pass); only the visible labels change.
  it('labels the video clock-chip "Property", not "Hotel"', async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActiveTz, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    const tile = within(pipDoc.body);
    expect(tile.getByText("Property")).toBeTruthy();
    expect(tile.queryByText("Hotel")).toBeNull();
  });

  it('labels the audio face clock "Property local time", not "Hotel local time"', async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await openTile();
    const tile = within(pipDoc.body);
    expect(tile.getByText("Property local time")).toBeTruthy();
    expect(tile.queryByText("Hotel local time")).toBeNull();
  });

  it("shows the caption band in the tile only after captions are turned on (default OFF)", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    // The compact CC toggle lives in the control bar, which renders only once
    // controls are registered (as they always are while the tile is open during
    // a live call — the softphone/video-host register them on answer).
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    const tile = within(pipDoc.body);

    // Default OFF: publishing text does not surface a band.
    await act(async () => screen.getByText("publish captions").click());
    expect(tile.queryByText(/Extra towels to 204/)).toBeNull();

    // Turn captions ON via the tile's compact CC toggle (icon-only → query by title).
    const cc = pipDoc.body.querySelector('[title="Turn captions on"]') as HTMLButtonElement;
    expect(cc).toBeTruthy();
    await act(async () => cc.click());
    await act(async () => screen.getByText("publish captions").click());
    await waitFor(() => expect(tile.getByText(/Extra towels to 204/)).toBeTruthy());
  });

  it("has no Room #/Note inputs anymore", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    expect(pipDoc.body.querySelector('[aria-label="Room number"]')).toBeNull();
    expect(pipDoc.body.querySelector('[aria-label="Call note"]')).toBeNull();
  });

  // Task 9: Video/Chat toggle. Chat is video-only, so controls must include
  // sendChat/sendTyping (registered only by the video call owner) for the
  // toggle to render at all — mirrors the video-has-no-911 pattern above.
  it("clicking the Chat toggle switches the VIDEO face to chat mode and reveals the ChatDock input", async () => {
    const controls = makeControls({
      triggerEmergency: undefined,
      sendChat: vi.fn(),
      sendTyping: vi.fn(),
    });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const tile = within(pipDoc.body);
    // Still on the video face: no chat input yet.
    expect(tile.queryByPlaceholderText(/type/i)).toBeNull();

    // Single icon-only round toggle now (aria-label "Chat"), not a "Chat" text
    // segment of a Video|Chat switch.
    const chatToggle = pipDoc.body.querySelector('[aria-label="Chat"]') as HTMLButtonElement;
    expect(chatToggle).toBeTruthy();
    await act(async () => {
      chatToggle.click();
    });

    expect(tile.getByPlaceholderText(/type/i)).toBeTruthy();
  });

  // Task 9: inbound-badge + chime gating. A guest line while the agent is
  // still on the video face arms the unread dot; the SAME line-append while
  // she's already viewing chat must not re-arm it (she's looking right at it).
  it("marks the Chat toggle unread on an inbound guest line in video mode, but not once chat is already open", async () => {
    const controls = makeControls({
      triggerEmergency: undefined,
      sendChat: vi.fn(),
      sendTyping: vi.fn(),
    });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    expect(pipDoc.body.querySelector('[data-testid="chat-unread"]')).toBeNull();

    // Inbound guest line while still on the video face → badge appears.
    await act(async () => screen.getByText("publish guest chat").click());
    await waitFor(() =>
      expect(pipDoc.body.querySelector('[data-testid="chat-unread"]')).toBeTruthy(),
    );

    // Opening chat clears it (badge-clear effect).
    const chatToggle = pipDoc.body.querySelector('[aria-label="Chat"]') as HTMLButtonElement;
    await act(async () => {
      chatToggle.click();
    });
    expect(pipDoc.body.querySelector('[data-testid="chat-unread"]')).toBeNull();

    // A second inbound guest line while ALREADY viewing chat must not re-arm it.
    await act(async () => screen.getByText("publish guest chat").click());
    expect(pipDoc.body.querySelector('[data-testid="chat-unread"]')).toBeNull();
  });

  // The inbound-chat CHIME moved to the CallSurfaceProvider (main window) — the
  // tile's DocPiP document is autoplay-locked, so a tile-owned chime was silent
  // for the first guest message. The tile must therefore NOT carry its own chime
  // <audio> (that would double-play once the PiP unlocks). See the chime test in
  // call-surface-provider.test.tsx.
  it("does not render its own chime audio (chime lives in the provider now)", async () => {
    const controls = makeControls({ triggerEmergency: undefined, sendChat: vi.fn(), sendTyping: vi.fn() });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    expect(pipDoc.querySelector('audio[src*="chat-message"]')).toBeNull();
  });

  // Item 4 (2026-07-21): the tile gained a Camera toggle on VIDEO calls, mirroring
  // the overlay. It rides the same registered-controls seam as chat — the VIDEO
  // owner registers toggleCamera/cameraOff; AUDIO omits them (no camera).
  it("renders a Camera toggle on VIDEO calls and calls the registered toggleCamera", async () => {
    const toggleCamera = vi.fn();
    const controls = makeControls({
      triggerEmergency: undefined,
      sendChat: vi.fn(),
      sendTyping: vi.fn(),
      toggleCamera,
      cameraOff: false,
    });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    const camBtn = pipDoc.body.querySelector('[aria-label="Camera off"]') as HTMLButtonElement;
    expect(camBtn).toBeTruthy();
    expect(camBtn.textContent?.trim()).toBe(""); // icon-only
    await act(async () => camBtn.click());
    expect(toggleCamera).toHaveBeenCalledOnce();
  });

  it("reflects camera-off state on the Camera toggle's accessible label", async () => {
    const controls = makeControls({
      triggerEmergency: undefined,
      sendChat: vi.fn(),
      sendTyping: vi.fn(),
      toggleCamera: vi.fn(),
      cameraOff: true,
    });
    const { pipDoc } = renderTile({ active: videoActive, controls });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    // cameraOff → the accessible name offers the "on" action (mirrors the kiosk).
    expect(pipDoc.body.querySelector('[aria-label="Camera on"]')).toBeTruthy();
    expect(pipDoc.body.querySelector('[aria-label="Camera off"]')).toBeNull();
  });

  it("shows no Camera toggle on AUDIO calls (audio registers no camera control)", async () => {
    // Default makeControls() is the audio shape (triggerEmergency present, no
    // toggleCamera) — the softphone never registers a camera.
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    expect(pipDoc.body.querySelector('[aria-label="Camera off"]')).toBeNull();
    expect(pipDoc.body.querySelector('[aria-label="Camera on"]')).toBeNull();
  });
});
