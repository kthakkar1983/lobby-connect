import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, within } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { FleetBoard, type FleetPodGroup } from "@/components/dashboard/fleet-board";
import type { PropertyCardData } from "@/components/dashboard/property-card";

afterEach(() => cleanup());

// The real AvailabilityToggle drags in a "use server" action (Supabase server
// client, requireRole, revalidatePath) + sonner's toast — none of which this
// test needs to prove. Stub it with a lightweight, identifiable node so the
// fleet board's footerFor wiring is verifiable without the server chain.
vi.mock("@/app/(admin)/admin/availability-cards", () => ({
  AvailabilityToggle: ({ propertyName, initial }: { propertyName: string; initial: boolean }) => (
    <div data-testid="covering-toggle">
      Covering: {propertyName} ({initial ? "on" : "off"})
    </div>
  ),
}));

const grandHotel: PropertyCardData = {
  id: "p1",
  name: "The Grand Hotel",
  timezone: "America/Chicago",
  callsTonight: 2,
  lastCallAt: null,
  openIncidents: 0,
};

const riversideInn: PropertyCardData = {
  id: "p2",
  name: "Riverside Inn",
  timezone: "America/Chicago",
  callsTonight: 0,
  lastCallAt: null,
  openIncidents: 0,
};

const dilnoza = {
  id: "a1",
  full_name: "Dilnoza K",
  status: "AVAILABLE" as const,
  last_seen_at: new Date().toISOString(),
};

/** Probe publisher, mirroring the idiom in property-card.test.tsx / pod-card-grid.test.tsx. */
function Publisher() {
  const { publishRings, registerAcceptAudio, registerAcceptVideo } = useCallSurface();
  return (
    <div>
      <button
        onClick={() =>
          publishRings("audio", [
            {
              key: "audio:call-p1",
              channel: "AUDIO",
              callId: "call-p1",
              propertyId: "p1",
              propertyName: grandHotel.name,
              since: Date.now() - 3_000,
            },
          ])
        }
      >
        ring p1
      </button>
      <button
        onClick={() =>
          publishRings("audio", [
            {
              key: "audio:call-p2",
              channel: "AUDIO",
              callId: "call-p2",
              propertyId: "p2",
              propertyName: riversideInn.name,
              since: Date.now() - 3_000,
            },
          ])
        }
      >
        ring p2
      </button>
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
        ring orphan (no property)
      </button>
      <button
        onClick={() =>
          publishRings("video", [
            {
              key: "video:call-outside-every-pod",
              channel: "VIDEO",
              callId: "call-outside-every-pod",
              propertyId: "p-not-in-any-pod",
              propertyName: "Outside Pod Hotel",
              since: Date.now() - 4_000,
            },
          ])
        }
      >
        ring outside every pod (video)
      </button>
      <button onClick={() => registerAcceptAudio(() => acceptAudioSpy())}>register acceptAudio</button>
      <button onClick={() => registerAcceptVideo((callId) => acceptVideoSpy(callId))}>
        register acceptVideo
      </button>
    </div>
  );
}

let acceptAudioSpy: () => void = () => {};
let acceptVideoSpy: (callId: string) => void = () => {};

describe("FleetBoard", () => {
  it("renders a group header per pod: agent name, duty label, and property count", () => {
    const groups: FleetPodGroup[] = [
      { agent: dilnoza, properties: [grandHotel] },
      { agent: null, properties: [riversideInn] },
    ];

    render(
      <CallSurfaceProvider>
        <FleetBoard groups={groups} canAnswerByProperty={{}} coveringByProperty={{}} />
      </CallSurfaceProvider>,
    );

    expect(screen.getByText("Dilnoza K")).not.toBeNull();
    expect(screen.getByText("On duty")).not.toBeNull();
    // Both single-property groups render the same "· 1 property" count text.
    expect(screen.getAllByText("· 1 property")).toHaveLength(2);
    expect(screen.getByText("Unassigned")).not.toBeNull();

    // Both properties' cards render under their respective group.
    expect(screen.getByText("The Grand Hotel")).not.toBeNull();
    expect(screen.getByText("Riverside Inn")).not.toBeNull();
  });

  it("renders the Covering toggle in each card's footer via footerFor", () => {
    const groups: FleetPodGroup[] = [{ agent: dilnoza, properties: [grandHotel, riversideInn] }];

    render(
      <CallSurfaceProvider>
        <FleetBoard
          groups={groups}
          canAnswerByProperty={{}}
          coveringByProperty={{ p1: true, p2: false }}
        />
      </CallSurfaceProvider>,
    );

    const toggles = screen.getAllByTestId("covering-toggle");
    expect(toggles).toHaveLength(2);
    expect(screen.getByText("Covering: The Grand Hotel (on)")).not.toBeNull();
    expect(screen.getByText("Covering: Riverside Inn (off)")).not.toBeNull();
  });

  it("gates Answer by covering: a ringing property with covering=false shows no Answer; covering=true does", async () => {
    const groups: FleetPodGroup[] = [{ agent: dilnoza, properties: [grandHotel, riversideInn] }];
    let audioCalls = 0;
    acceptAudioSpy = () => {
      audioCalls += 1;
    };

    render(
      <CallSurfaceProvider>
        <Publisher />
        <FleetBoard
          groups={groups}
          canAnswerByProperty={{ p1: false, p2: true }}
          coveringByProperty={{ p1: false, p2: true }}
        />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptAudio").click();
    });

    // p1 (covering=false) rings — no Answer button anywhere for it.
    await act(async () => {
      screen.getByText("ring p1").click();
    });
    expect(screen.getByText(/Ringing/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();

    // p2 (covering=true) rings instead — Answer appears and works.
    await act(async () => {
      screen.getByText("ring p2").click();
    });
    const answerButton = screen.getByRole("button", { name: "Answer" });
    expect(answerButton).not.toBeNull();

    await act(async () => {
      answerButton.click();
    });
    expect(audioCalls).toBe(1);
  });

  it("hoists the unmatched-ring fallback exactly once at the board level, not once per pod group", async () => {
    const groups: FleetPodGroup[] = [
      { agent: dilnoza, properties: [grandHotel] },
      { agent: null, properties: [riversideInn] },
    ];

    render(
      <CallSurfaceProvider>
        <Publisher />
        <FleetBoard groups={groups} canAnswerByProperty={{}} coveringByProperty={{}} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("ring orphan (no property)").click();
    });

    // Exactly one fallback card, not one per rendered PodCardGrid (2 groups here).
    const fallbackHeadings = screen.getAllByText("Unknown property");
    expect(fallbackHeadings).toHaveLength(1);
    expect(screen.getByText("Incoming phone call")).not.toBeNull();

    // Both real cards stay Quiet — the orphan ring matches neither.
    const quietLabels = screen.getAllByText("Quiet");
    expect(quietLabels).toHaveLength(2);
  });

  it("dispatches acceptVideo from the hoisted fallback for a VIDEO ring outside every rendered pod", async () => {
    const groups: FleetPodGroup[] = [
      { agent: dilnoza, properties: [grandHotel] },
      { agent: null, properties: [riversideInn] },
    ];
    const accepted: string[] = [];
    acceptVideoSpy = (callId: string) => accepted.push(callId);

    render(
      <CallSurfaceProvider>
        <Publisher />
        <FleetBoard groups={groups} canAnswerByProperty={{}} coveringByProperty={{}} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("register acceptVideo").click();
    });
    await act(async () => {
      screen.getByText("ring outside every pod (video)").click();
    });

    expect(screen.getByText("Outside Pod Hotel")).not.toBeNull();
    expect(screen.getByText("Incoming video call")).not.toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });
    expect(accepted).toEqual(["call-outside-every-pod"]);
  });

  it("renders no properties/groups gracefully (empty fleet)", () => {
    render(
      <CallSurfaceProvider>
        <FleetBoard groups={[]} canAnswerByProperty={{}} coveringByProperty={{}} />
      </CallSurfaceProvider>,
    );
    expect(screen.queryByText("Unassigned")).toBeNull();
  });
});

// Sanity: the mocked toggle renders inside the card body, not floating outside it.
describe("FleetBoard — footer placement", () => {
  it("places the covering toggle within the same card as its property name", () => {
    const groups: FleetPodGroup[] = [{ agent: dilnoza, properties: [grandHotel] }];
    const { container } = render(
      <CallSurfaceProvider>
        <FleetBoard
          groups={groups}
          canAnswerByProperty={{}}
          coveringByProperty={{ p1: true }}
        />
      </CallSurfaceProvider>,
    );
    const heading = screen.getByText("The Grand Hotel");
    const card = heading.closest("div[data-live-state]");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByTestId("covering-toggle")).not.toBeNull();
    expect(container).not.toBeNull();
  });
});
