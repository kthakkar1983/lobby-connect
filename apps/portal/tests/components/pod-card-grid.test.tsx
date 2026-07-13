import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PodCardGrid } from "@/components/dashboard/pod-card-grid";
import type { PropertyCardData } from "@/components/dashboard/property-card";

// Task 17 (shift-tracking plan): mocked so tests can drive canWork directly,
// mirroring property-card.test.tsx / duty-control.test.tsx.
const { useDutyOptional } = vi.hoisted(() => ({
  useDutyOptional: vi.fn(),
}));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => useDutyOptional(),
}));

beforeEach(() => {
  useDutyOptional.mockReset();
  useDutyOptional.mockReturnValue(null);
});

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

  it("renders a Silence toggle on the unmatched fallback card; clicking it disables the button, Answer stays", async () => {
    acceptAudioSpy = () => {};
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

    // Fallback card has both Answer and Silence.
    expect(screen.getByRole("button", { name: "Answer" })).not.toBeNull();
    const silence = screen.getByRole("button", { name: "Silence" });
    expect(silence.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      silence.click();
    });

    const silenced = screen.getByRole("button", { name: "Silenced" });
    expect(silenced.hasAttribute("disabled")).toBe(true);
    // Ring stays answerable after silencing.
    expect(screen.getByRole("button", { name: "Answer" })).not.toBeNull();
  });

  it("Task 17: canWork=false disables the unmatched fallback's Answer for a VIDEO ring and does not invoke acceptVideo", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);

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

    const btn = screen.getByRole("button", { name: "Go on duty" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();

    await act(async () => {
      btn.click();
    });
    expect(calls).toEqual([]);
  });

  it("Task 17: canWork=false does NOT gate the unmatched fallback's Answer for an AUDIO ring", async () => {
    let audioCalls = 0;
    acceptAudioSpy = () => {
      audioCalls += 1;
    };
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);

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

    const btn = screen.getByRole("button", { name: "Answer" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(audioCalls).toBe(1);
  });

  it("suppresses the unmatched-ring fallback when showUnmatchedRings={false} (Task 9: the fleet board hoists it instead)", async () => {
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PodCardGrid properties={[p1]} showUnmatchedRings={false} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptAudio").click();
    });
    await act(async () => {
      screen.getByText("publish audio ring with null propertyId").click();
    });

    // No fallback card for the orphan ring — the per-pod grid suppressed it.
    expect(screen.queryByText("Unknown property")).toBeNull();
    expect(screen.queryByText("Incoming phone call")).toBeNull();
    // p1's own card is unaffected either way.
    expect(screen.getByText("Quiet")).not.toBeNull();
  });
});
