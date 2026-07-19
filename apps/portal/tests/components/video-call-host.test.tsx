import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import type { IncomingVideoCall } from "@/lib/hooks/use-incoming-video-calls";

// VideoCallHost discovers rings via useIncomingVideoCalls; feed it a fixed set
// so both calls are answerable. The real hook needs a realtime channel + a
// ringtone (covered by use-incoming-video-calls.test.tsx); here that machinery
// is noise, so it's replaced with a plain value.
const hook = vi.hoisted(() => ({ calls: [] as IncomingVideoCall[] }));
vi.mock("@/lib/hooks/use-incoming-video-calls", () => ({
  useIncomingVideoCalls: () => ({ calls: hook.calls }),
}));

// unlockAudioPlayback touches WebAudio on the accept gesture — stub both exports.
vi.mock("@/lib/video/audio-unlock", () => ({
  unlockAudioPlayback: vi.fn(),
  recoverAudioOnNextGesture: vi.fn(),
}));

// Stub the full-screen VideoCall with a MOUNT-COUNTING probe. The real join
// machinery has its own coverage (video-call*.test.tsx); this file pins exactly
// one thing: a back-to-back A->B call transition must REMOUNT VideoCall.
//
// That remount is what video-call-host.tsx's `key={active.id}` guarantees, and
// it is the ONLY thing keeping per-call state — the Connect failure message
// (connectError) above all — from bleeding into the next guest's call. Both
// setActive paths in the host swap the call object without ever passing through
// null, so WITHOUT the key React would reconcile by position and reuse the one
// instance, carrying its state forward. A `[]` effect runs once per MOUNT:
// ["call-a", "call-b"] proves a remount (key present); ["call-a"] alone would
// mean the instance was reused (key removed) — the exact silent regression this
// exists to catch. The stub mock intercepts the host's `next/dynamic` import
// the same way call-tile-manager.test.tsx relies on.
const mounts = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock("@/components/video-call/video-call", () => ({
  VideoCall: ({ callId }: { callId: string }) => {
    // Empty deps ON PURPOSE: this must run once per MOUNT, not per callId
    // change. Adding callId would make it re-fire on a reused instance and
    // defeat the remount-vs-reuse distinction this whole file exists to draw.
    useEffect(() => {
      mounts.log.push(callId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="video-call">{callId}</div>;
  },
}));

function makeCall(id: string): IncomingVideoCall {
  return {
    id,
    channelName: `ch-${id}`,
    propertyName: "The Sample Hotel",
    propertyId: "prop-1",
    timezone: "America/Chicago",
    ringStartedAt: null,
  };
}

/** Answers a card ring through the host-registered dispatcher — mirrors how
 *  PropertyCard / PodCardGrid invoke actions.acceptVideo(ring.callId). */
function Answerer() {
  const { actions } = useCallSurface();
  return (
    <>
      <button onClick={() => actions.acceptVideo?.("call-a")}>answer a</button>
      <button onClick={() => actions.acceptVideo?.("call-b")}>answer b</button>
    </>
  );
}

describe("VideoCallHost — per-call isolation", () => {
  afterEach(() => {
    cleanup();
    mounts.log.length = 0;
    hook.calls = [];
  });

  it("remounts VideoCall on a back-to-back call transition (key={active.id})", async () => {
    hook.calls = [makeCall("call-a"), makeCall("call-b")];

    render(
      <CallSurfaceProvider>
        <Answerer />
        <VideoCallHost operatorId="op-1" />
      </CallSurfaceProvider>,
    );

    // Answer call A; flush the host's next/dynamic import so the stub mounts.
    await act(async () => {
      screen.getByText("answer a").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("video-call").textContent).toBe("call-a");

    // Transition straight to call B without an intervening hang-up.
    await act(async () => {
      screen.getByText("answer b").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("video-call").textContent).toBe("call-b");

    // A fresh VideoCall per call — never one reused instance whose
    // connectError / roomNumber / notes carry into the next guest.
    expect(mounts.log).toEqual(["call-a", "call-b"]);
  });
});
