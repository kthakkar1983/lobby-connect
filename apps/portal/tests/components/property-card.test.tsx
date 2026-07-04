import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";

afterEach(() => cleanup());

const p1: PropertyCardData = {
  id: "p1",
  name: "The Grand Hotel",
  timezone: "America/Chicago",
  callsTonight: 2,
  lastCallAt: null,
  openIncidents: 0,
};

const p2: PropertyCardData = {
  id: "p2",
  name: "Riverside Inn",
  timezone: "America/Chicago",
  callsTonight: 0,
  lastCallAt: null,
  openIncidents: 0,
};

/** Probe publisher: exposes buttons that call the context's publish/register APIs
 *  (mirrors the idiom in tests/components/call-surface-provider.test.tsx). */
function Publisher() {
  const { publishRings, registerAcceptAudio, registerAcceptVideo } = useCallSurface();
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
              since: Date.now() - 5_000, // ringing 5s ago
            },
          ])
        }
      >
        publish video ring for p1
      </button>
      <button
        onClick={() =>
          publishRings("audio", [
            {
              key: "audio:call-2",
              channel: "AUDIO",
              callId: "call-2",
              propertyId: "p1",
              propertyName: p1.name,
              since: Date.now() - 3_000,
            },
          ])
        }
      >
        publish audio ring for p1
      </button>
      <button onClick={() => registerAcceptVideo((callId) => acceptVideoSpy(callId))}>
        register acceptVideo
      </button>
      <button onClick={() => registerAcceptAudio(() => acceptAudioSpy())}>register acceptAudio</button>
    </div>
  );
}

let acceptVideoSpy: (callId: string) => void;
let acceptAudioSpy: () => void;

describe("PropertyCard", () => {
  it("renders a quiet card with no Answer button when nothing is ringing", () => {
    render(
      <CallSurfaceProvider>
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );

    expect(screen.getByText("Quiet")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });

  it("expands only the ringing property's card with elapsed seconds and an Answer button", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
        <PropertyCard property={p2} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    // p1's card rings, showing channel + elapsed seconds; p2's stays quiet.
    expect(screen.getByText(/Ringing/)).not.toBeNull();
    expect(screen.getByText(/· video · \d+s/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Answer" })).not.toBeNull();
    expect(screen.getByText("Quiet")).not.toBeNull(); // p2 unaffected
  });

  it("clicking Answer on a ringing video call invokes the registered acceptVideo with the callId", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
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

    expect(calls).toEqual(["call-1"]);
  });

  it("clicking Answer on a ringing audio call invokes the registered acceptAudio", async () => {
    let audioCalls = 0;
    acceptAudioSpy = () => {
      audioCalls += 1;
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptAudio").click();
    });
    await act(async () => {
      screen.getByText("publish audio ring for p1").click();
    });

    expect(screen.getByText(/· phone · \d+s/)).not.toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });

    expect(audioCalls).toBe(1);
  });

  it("hides the Answer button when canAnswer is false, but keeps the ringing treatment", async () => {
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} canAnswer={false} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    expect(screen.getByText(/Ringing/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });
});
