import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
import { OffDutyPromptProvider } from "@/components/dashboard/off-duty-prompt";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";

// Task 17 (shift-tracking plan): mocked so tests can drive canWork directly,
// without a real DutyProvider's fetch-hydration cycle.
//
// Task 4 (duty-column polish plan): PropertyCard no longer imports duty-provider
// itself — it calls useDutyGuard, and off-duty-prompt.tsx imports exactly this
// one symbol — so this mock still drives the gate unchanged.
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
  kioskOnline: true,
};

const p2: PropertyCardData = {
  id: "p2",
  name: "Riverside Inn",
  timezone: "America/Chicago",
  callsTonight: 0,
  lastCallAt: null,
  openIncidents: 0,
  kioskOnline: true,
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

  it("Task 4: the ringing card's own actions are on the card scale", async () => {
    // Spec §3.6a/D15: all four card actions are h-8 — the same invariant
    // property-action-button.test.tsx:303 already pins for Connect and Kiosk.
    // Answer and Silence are the two that were h-9, i.e. the exact mismatch
    // D15 exists to remove, and the change's own headline claim. Without this,
    // reverting either to size="default" leaves every other test here green,
    // and a reviewer who greps for the D15 pin finds it and wrongly concludes
    // the whole invariant is covered. The height rides a single unasserted
    // prop: `size` carries it alone, deliberately, per PropertyActionButton's
    // "SIZING IS A PROP, NOT A className FIGHT".
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

    expect(screen.getByRole("button", { name: "Answer" }).className).toContain("h-8");
    expect(screen.getByRole("button", { name: "Silence" }).className).toContain("h-8");
  });

  it("Task 4: off duty, Answer keeps its label, stays ENABLED, and does not invoke acceptVideo", async () => {
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

    // Spec §3.6: the per-card label swap is gone. With five properties per pod
    // (more later) a "Go on duty" repeated on every card reads as noise; the
    // shared prompt says it once.
    expect(screen.queryByRole("button", { name: "Go on duty" })).toBeNull();
    const btn = screen.getByRole("button", { name: "Answer" }) as HTMLButtonElement;

    // THE LOAD-BEARING ASSERTION (spec §3.4/D8). A `disabled` button fires no
    // click event, so the guard could never intercept it. useDutyGuard has no
    // power to add or remove a `disabled` attribute, so its own tests cannot
    // prove this — only a rendered control can.
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("title")).toBeNull();

    await act(async () => {
      btn.click();
    });
    expect(calls).toEqual([]);
  });

  it("Task 4: off duty, a ringing AUDIO call is withheld too — one guard covers both channels", async () => {
    // REVERSES the old Task-17 behaviour deliberately. `answerGated` was
    // VIDEO-only because a server 403 (requireOnDuty on answer-video) backs
    // video and nothing backs audio-answer, so an off-duty audio Answer stayed
    // enabled, pulsing, and silently no-opped at softphone.tsx:587 — a button
    // that looked live and did nothing. Spec §3.6 retires that asymmetry: both
    // channels route through the one guard, which refuses AND explains. The
    // video 403 remains the real gate.
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

    const btn = screen.getByRole("button", { name: "Answer" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(audioCalls).toBe(0);
  });

  it("Task 4: a gated Answer opens the shared off-duty prompt rather than doing nothing", async () => {
    // The two tests above prove the action is withheld. Withheld-and-silent and
    // withheld-and-explained are indistinguishable from them, and only one of
    // those is the feature — so drive the real provider once, end to end.
    acceptVideoSpy = () => {};
    useDutyOptional.mockReturnValue({
      canWork: false,
      onBreak: false,
      goOnDuty: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useDutyOptional>);

    render(
      <CallSurfaceProvider>
        <OffDutyPromptProvider>
          <Publisher />
          <PropertyCard property={p1} />
        </OffDutyPromptProvider>
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Answer" }).click();
    });

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("You're off duty")).toBeTruthy();
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

  // Task 5 (spec §3.6b/D16). These two exist because the commit that reserved
  // the action row shipped with NO coverage at all: `git checkout <parent> --
  // property-card.tsx` reverted the whole thing and left jsdom at 293/293 green.
  // jsdom computes no layout, so the reservation cannot be measured — but it CAN
  // be pinned structurally, which is what these do. Task 14 reworks Connect and
  // Kiosk on this very card, and folding connectSlot back into the fixed-height
  // row is the single most likely edit (it lived there until this change, and
  // the plan's own Task-4 snippet still draws it there). That regression crops
  // Connect/Kiosk and clips PropertyActionButton's inline <p role="alert">
  // entirely — so a failed RustDesk launch would show the agent nothing at all,
  // mid-shift, while she believes the remote session is coming.
  it("Task 5: the action row is reserved at h-8, rendered and empty, while the card is quiet", () => {
    const { getByTestId, queryAllByRole } = render(
      <CallSurfaceProvider>
        <PropertyCard property={p1} />
      </CallSurfaceProvider>,
    );

    const row = getByTestId("card-action-row");
    expect(row.className).toContain("h-8");
    expect(row.children.length).toBe(0);

    // The empty row needs no aria-hidden/tabIndex juggling precisely BECAUSE it
    // holds nothing: it cannot be focused and has nothing to announce. Pinned so
    // that "reserve the space" can never quietly become "render hidden buttons",
    // which would put dead controls in the tab order of every quiet card.
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  it("Task 5: a ring fills that same row rather than adding one, and connectSlot stays out of it", async () => {
    acceptVideoSpy = () => {};
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} connectSlot={<button>Connect</button>} />
      </CallSurfaceProvider>,
    );

    const quietRow = screen.getByTestId("card-action-row");
    const connect = screen.getByRole("button", { name: "Connect" });

    // Quiet: Connect already sits outside the reserved row.
    expect(quietRow.contains(connect)).toBe(false);

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    // Ringing: the SAME DOM node (identity, not just a match) now holds Answer
    // and Silence. Same element + same h-8 is the whole geometry contract — a
    // ring changes the row's contents and colour, never the card's height, so
    // the Answer target cannot move under the cursor at the moment she reaches
    // for it, and CSS Grid cannot propagate a growth to every sibling card.
    const ringingRow = screen.getByTestId("card-action-row");
    expect(ringingRow).toBe(quietRow);
    expect(ringingRow.className).toContain("h-8");
    expect(ringingRow.contains(screen.getByRole("button", { name: "Answer" }))).toBe(true);
    expect(ringingRow.contains(screen.getByRole("button", { name: "Silence" }))).toBe(true);

    // `contains`, not `closest("div")`: once Task 14 swaps this stub for a real
    // PropertyActionButton the nearest div is that component's OWN wrapper, so
    // a closest() check would pass while Connect sat inside the reserved row.
    expect(ringingRow.contains(connect)).toBe(false);
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

  it("Task 14: shows a mint 'Kiosk online' dot next to the name when kioskOnline is true", () => {
    render(
      <CallSurfaceProvider>
        <PropertyCard property={{ ...p1, kioskOnline: true }} />
      </CallSurfaceProvider>,
    );
    const dot = screen.getByTitle("Kiosk online");
    expect(dot.className).toContain("bg-live");
  });

  it("Task 14: shows a muted 'Kiosk offline' dot next to the name when kioskOnline is false", () => {
    render(
      <CallSurfaceProvider>
        <PropertyCard property={{ ...p1, kioskOnline: false }} />
      </CallSurfaceProvider>,
    );
    const dot = screen.getByTitle("Kiosk offline");
    expect(dot.className).toContain("bg-muted-foreground/40");
  });

  // Smoke follow-up (2026-07-21): Kumar found Answer/Silence not aligning with
  // the Connect/Kiosk row below. Root cause — the action row was a plain flex
  // (buttons content-width) while the connect row is a grid-cols-2 (equal
  // columns), so the two pairs sat at different widths. Fix: BOTH rows are the
  // same full-width grid-cols-2, so Answer↔Connect and Silence↔Kiosk line up as
  // a true 2×2. jsdom cannot measure the resulting pixels (the live smoke does),
  // but it CAN pin the structural cause: grid-cols-2 + w-full buttons.
  it("lays the action row out as a full-width grid-cols-2 so Answer/Silence align with the row below", async () => {
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

    const row = screen.getByTestId("card-action-row");
    expect(row.className).toContain("grid-cols-2");

    const answer = screen.getByRole("button", { name: "Answer" });
    const silence = screen.getByRole("button", { name: "Silence" });
    // w-full makes each button fill its grid column, so the pair spans the card
    // edge-to-edge and matches the Connect/Kiosk grid beneath it.
    expect(answer.className).toContain("w-full");
    expect(silence.className).toContain("w-full");
  });

  it("keeps Silence in column 2 (under Kiosk) even when it is the only action — admin not covering", async () => {
    // Review-caught edge (2026-07-21): when canAnswer is false, ONLY Silence
    // renders. In a grid-cols-2 with no explicit placement, CSS Grid auto-places
    // the lone child in column 1 — i.e. under Connect, breaking the Silence↔Kiosk
    // pairing the 2×2 exists to create. `col-start-2` pins Silence to the right
    // column in every case (it's already its natural column when Answer is
    // present, so this is harmless there).
    render(
      <CallSurfaceProvider>
        <Publisher />
        <PropertyCard property={p1} canAnswer={false} />
      </CallSurfaceProvider>,
    );

    await act(async () => {
      screen.getByText("publish video ring for p1").click();
    });

    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    const silence = screen.getByRole("button", { name: "Silence" });
    expect(silence.className).toContain("col-start-2");
  });

  it("Answer renders with a leading icon so it aligns with Silence/Connect/Kiosk (D6)", async () => {
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

    const answer = screen.getByRole("button", { name: "Answer" });
    expect(answer.querySelector("svg")).not.toBeNull();
  });
});
