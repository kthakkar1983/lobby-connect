import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";

// Task 17 (shift-tracking plan): mocked so tests can drive canWork directly,
// without a real DutyProvider's fetch-hydration cycle (mirrors the pattern in
// duty-control.test.tsx).
const { useDutyOptional } = vi.hoisted(() => ({
  useDutyOptional: vi.fn(),
}));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => useDutyOptional(),
}));

beforeEach(() => {
  useDutyOptional.mockReset();
  // Default: no DutyProvider mounted — every pre-existing test in this file
  // must stay byte-for-byte unaffected by Task 17's gate.
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

  it("shows a Silence toggle on a ringing card; clicking it silences the ring key and disables the button, Answer stays", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    // Ringing → both Answer and Silence are present.
    expect(screen.getByRole("button", { name: "Answer" })).not.toBeNull();
    const silence = screen.getByRole("button", { name: "Silence" });
    expect(silence).not.toBeNull();
    expect(silence.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      silence.click();
    });

    // Once the key is silenced the button reads "Silenced" and is disabled.
    const silenced = screen.getByRole("button", { name: "Silenced" });
    expect(silenced).not.toBeNull();
    expect(silenced.hasAttribute("disabled")).toBe(true);
    expect(silenced.getAttribute("aria-pressed")).toBe("true");

    // Silence is audio-only: the ring stays and Answer remains available.
    expect(screen.getByText(/Ringing/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Answer" })).not.toBeNull();
  });

  it("shows the Silence toggle even when canAnswer is false (admin covering OFF)", async () => {
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} canAnswer={false} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    // No Answer (gated), but Silence is still available so the local ring can be muted.
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Silence" })).not.toBeNull();
  });

  it("shows no Silence toggle on a quiet card", () => {
    render(
      <CallSurfaceProvider>
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );
    expect(screen.queryByRole("button", { name: "Silence" })).toBeNull();
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

  it("Task 17: canWork=false disables the Answer button + shows the go-on-duty label on a ringing VIDEO call, and does not invoke acceptVideo", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);

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

    const btn = screen.getByRole("button", { name: "Go on duty" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();

    await act(async () => {
      btn.click();
    });
    expect(calls).toEqual([]);
  });

  it("Task 17: canWork=false does NOT gate a ringing AUDIO call — Answer stays enabled and invokes acceptAudio", async () => {
    let audioCalls = 0;
    acceptAudioSpy = () => {
      audioCalls += 1;
    };
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);

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

    const btn = screen.getByRole("button", { name: "Answer" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(audioCalls).toBe(1);
  });

  it("Task 17: canWork=true on a ringing VIDEO call behaves exactly like the no-provider case", async () => {
    const calls: string[] = [];
    acceptVideoSpy = (callId: string) => calls.push(callId);
    useDutyOptional.mockReturnValue({ canWork: true } as unknown as ReturnType<typeof useDutyOptional>);

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

    const btn = screen.getByRole("button", { name: "Answer" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(calls).toEqual(["call-1"]);
  });

  it("renders footerSlot under the actions row (Task 9: the admin fleet board's Covering toggle)", () => {
    render(
      <CallSurfaceProvider>
        <PropertyCard property={p1} footerSlot={<button>Covering toggle stub</button>} />
      </CallSurfaceProvider>,
    );

    expect(screen.getByRole("button", { name: "Covering toggle stub" })).not.toBeNull();
  });

  it("renders nothing extra when footerSlot is omitted", () => {
    const { container } = render(
      <CallSurfaceProvider>
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );

    expect(screen.queryByRole("button", { name: "Covering toggle stub" })).toBeNull();
    expect(container).not.toBeNull();
  });
});
