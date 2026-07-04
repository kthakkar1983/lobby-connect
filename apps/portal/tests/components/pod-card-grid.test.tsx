import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PodCardGrid } from "@/components/dashboard/pod-card-grid";
import type { PropertyCardData } from "@/components/dashboard/property-card";

afterEach(() => cleanup());

const p1: PropertyCardData = {
  id: "p1",
  name: "The Grand Hotel",
  timezone: "America/Chicago",
  callsTonight: 2,
  lastCallAt: null,
  openIncidents: 0,
};

/** Probe publisher: exposes buttons that call the context's publish/register APIs
 *  (mirrors the idiom in tests/components/property-card.test.tsx). */
function Publisher() {
  const { publishRings, registerAcceptAudio, registerAcceptVideo } = useCallSurface();
  return (
    <div>
      <button
        onClick={() =>
          publishRings("audio", [
            {
              key: "audio:call-orphan",
              channel: "AUDIO",
              callId: "call-orphan",
              propertyId: null,
              propertyName: "Unknown property",
              since: Date.now() - 2_000,
            },
          ])
        }
      >
        publish audio ring with null propertyId
      </button>
      <button
        onClick={() =>
          publishRings("video", [
            {
              key: "video:call-outside-pod",
              channel: "VIDEO",
              callId: "call-outside-pod",
              propertyId: "p-not-in-pod",
              propertyName: "Outside Pod Hotel",
              since: Date.now() - 4_000,
            },
          ])
        }
      >
        publish video ring for property outside pod
      </button>
      <button onClick={() => registerAcceptAudio(() => acceptAudioSpy())}>register acceptAudio</button>
      <button onClick={() => registerAcceptVideo((callId) => acceptVideoSpy(callId))}>
        register acceptVideo
      </button>
    </div>
  );
}

let acceptAudioSpy: () => void;
let acceptVideoSpy: (callId: string) => void;

describe("PodCardGrid — unmatched-ring fallback", () => {
  it("renders a fallback card + Answer for an AUDIO ring with a null propertyId; p1's card stays Quiet", async () => {
    let audioCalls = 0;
    acceptAudioSpy = () => {
      audioCalls += 1;
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PodCardGrid properties={[p1]} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptAudio").click();
    });
    await act(async () => {
      screen.getByText("publish audio ring with null propertyId").click();
    });

    // Fallback card shows the ring's propertyName + channel copy.
    expect(screen.getByText("Unknown property")).not.toBeNull();
    expect(screen.getByText("Incoming phone call")).not.toBeNull();

    // p1 is unaffected — no ring matches its id, so it stays Quiet.
    expect(screen.getByText("Quiet")).not.toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });

    expect(audioCalls).toBe(1);
  });

  it("renders a fallback card + Answer for a VIDEO ring targeting a property outside the rendered pod", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PodCardGrid properties={[p1]} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("publish video ring for property outside pod").click();
    });

    expect(screen.getByText("Outside Pod Hotel")).not.toBeNull();
    expect(screen.getByText("Incoming video call")).not.toBeNull();
    expect(screen.getByText("Quiet")).not.toBeNull(); // p1 unaffected

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });

    expect(calls).toEqual(["call-outside-pod"]);
  });
});
