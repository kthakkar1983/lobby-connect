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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor, within } from "@testing-library/react";

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

function makeControls(overrides: Partial<RegisteredCallControls> = {}): RegisteredCallControls {
  return {
    toggleMute: vi.fn(),
    muted: false,
    hangUp: vi.fn(),
    triggerEmergency: vi.fn(),
    saveNote: vi.fn().mockResolvedValue(true),
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
  const { publishActive, registerCallControls, publishGuestVideoTrack, openTileForCall } =
    useCallSurface();
  return (
    <div>
      <button onClick={() => publishActive(active)}>publish active</button>
      <button onClick={() => registerCallControls(controls)}>register controls</button>
      <button onClick={() => publishGuestVideoTrack(track ?? null)}>publish track</button>
      <button onClick={() => openTileForCall()}>open tile</button>
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

/**
 * Every @testing-library/dom event helper (fireEvent, userEvent) resolves
 * `ownerDocument.defaultView` internally and throws against the fake pip
 * document (jsdom's `createHTMLDocument()` has no attached window — the real
 * Document-PiP contract IS a genuine separate Document, so this is a jsdom test
 * artifact, not a bug in the tile). Set a React-controlled input's value with
 * the framework's own native-value setter (bypassing the instance setter React
 * shadows), then dispatch a plain, window-agnostic native Event so React's
 * root-level listener picks it up as a change.
 */
function setNativeInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CallTile", () => {
  it("renders the audio face: property name + a ticking elapsed timer", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await openTile();

    const tile = within(pipDoc.body);
    expect(tile.getByText("The Grand Hotel")).toBeTruthy();
    // ~65s elapsed from answeredAt — the compact "m:ss" format shows 1:05.
    await waitFor(() => expect(tile.getByText(/1:0[4-6]/)).toBeTruthy());
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

    const tile = within(pipDoc.body);
    const muteBtn = tile.getByText("Mute").closest("button");
    expect(muteBtn).toBeTruthy();
    await act(async () => {
      muteBtn!.click();
    });
    expect(toggleMute).toHaveBeenCalledOnce();
  });

  it("shows the muted label when controls.muted is true", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls({ muted: true }) });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    expect(within(pipDoc.body).getByText("Unmute")).toBeTruthy();
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

  it("Enter in the note field calls saveNote with the typed room + note", async () => {
    const saveNote = vi.fn().mockResolvedValue(true);
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls({ saveNote }) });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();

    // userEvent/fireEvent both hang or throw against the window-less pip
    // document (see setNativeInputValue's doc comment) — drive the inputs with
    // plain native events instead.
    const roomInput = pipDoc.body.querySelector('[aria-label="Room number"]') as HTMLInputElement;
    const noteInput = pipDoc.body.querySelector('[aria-label="Call note"]') as HTMLInputElement;
    expect(roomInput).toBeTruthy();
    expect(noteInput).toBeTruthy();

    await act(async () => {
      setNativeInputValue(roomInput, "204");
      setNativeInputValue(noteInput, "VIP");
      noteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(saveNote).toHaveBeenCalledWith("204", "VIP");
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
});
