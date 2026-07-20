import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

// Mock only the hooks the button reads — keeps this test focused on the
// button's branches, mirroring connect-button.test.tsx's mocking pattern
// (its sibling control on the same property card).
const { useCallSurfaceOptional, startOutboundVideo } = vi.hoisted(() => ({
  useCallSurfaceOptional: vi.fn(),
  startOutboundVideo: vi.fn(),
}));
const { useDutyOptional } = vi.hoisted(() => ({
  useDutyOptional: vi.fn(),
}));

vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
}));
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => useDutyOptional(),
}));

import { KioskCallButton } from "@/components/dashboard/kiosk-call-button";

/** A minimal surface stub — only startOutboundVideo is exercised by the button. */
function surfaceStub() {
  return { startOutboundVideo } as unknown as ReturnType<typeof useCallSurfaceOptional>;
}

afterEach(() => cleanup());

beforeEach(() => {
  useCallSurfaceOptional.mockReset();
  startOutboundVideo.mockReset();
  useCallSurfaceOptional.mockReturnValue(surfaceStub());
  useDutyOptional.mockReset();
  // Default: no DutyProvider mounted (owner surfaces + every other test in
  // this file unless overridden) — the duty gate must be a total no-op here.
  useDutyOptional.mockReturnValue(null);
});

describe("KioskCallButton", () => {
  it("renders nothing outside a CallSurfaceProvider", () => {
    useCallSurfaceOptional.mockReturnValue(null);
    const { container } = render(
      <KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("kioskOnline=false: disabled + greyed, label stays 'Kiosk' (not swapped), with an offline title hint", () => {
    // Kumar 2026-07-20: an offline kiosk keeps the "Kiosk" label + icon and just
    // greys out (like the Connect button beside it) -- no "Kiosk offline" label
    // swap. The reason still rides `title` on hover.
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Kiosk offline");
    // The label must NOT swap to "Kiosk offline" anymore.
    expect(screen.queryByRole("button", { name: "Kiosk offline" })).toBeNull();
  });

  it("kioskOnline=false: clicking does not invoke startOutboundVideo", async () => {
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });

    await act(async () => {
      btn.click();
    });
    expect(startOutboundVideo).not.toHaveBeenCalled();
  });

  it("kioskOnline=true + no DutyProvider: enabled, labeled 'Kiosk', no title hint", () => {
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.hasAttribute("title")).toBe(false);
  });

  it("duty-column polish: kioskOnline=true + canWork=false keeps the button ENABLED, with no duty title, but withholds the action", async () => {
    // Repointed from Task 17's disabled+title assertion. Spec §3.4/D8: the duty
    // reason no longer disables — <PropertyActionButton>'s useDutyGuard keeps
    // the control live so the off-duty prompt can intercept the click and offer
    // to start the shift. A `disabled` button fires no click event at all.
    //
    // THIS IS THE LOAD-BEARING ASSERTION for the enabled half: the hook cannot
    // add or remove a `disabled` attribute, so only a rendered control proves
    // it. The `title` is now reserved for REAL unavailability (see the
    // kioskOnline=false cases above), which is what keeps the two kinds
    // distinguishable to a hovering agent.
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.hasAttribute("title")).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(startOutboundVideo).not.toHaveBeenCalled();
  });

  it("kioskOnline=false + canWork=false: real unavailability wins, so it stays genuinely disabled", async () => {
    // The conflation spec §3.4 forbids. Off duty AND an offline kiosk: starting
    // the shift would not make that kiosk reachable, so offering to start it
    // would be a lie. Real unavailability must beat the duty intercept.
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Kiosk offline");

    await act(async () => {
      btn.click();
    });
    expect(startOutboundVideo).not.toHaveBeenCalled();
  });

  it("kioskOnline=true + DutyProvider canWork=true: behaves exactly like the no-provider case", async () => {
    useDutyOptional.mockReturnValue({ canWork: true } as unknown as ReturnType<typeof useDutyOptional>);
    startOutboundVideo.mockResolvedValue({ ok: true });
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(startOutboundVideo).toHaveBeenCalledWith("p1", "Marlin");
  });

  it("calls startOutboundVideo('p1', 'Marlin') when online + on duty", async () => {
    startOutboundVideo.mockResolvedValue({ ok: true });
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });
    expect(startOutboundVideo).toHaveBeenCalledWith("p1", "Marlin");
  });

  it("stays genuinely disabled while a start request is in flight", async () => {
    // Spec §3.4 gives `busy` its own row — a transient REAL unavailability that
    // must keep disabling the control, unlike the duty gate that deliberately
    // must not. Nothing else in this file pinned it: the `busy` branch could be
    // deleted from `unavailableReason` outright and every other test here still
    // passed. It also now reaches `disabled` through the truthiness of a string
    // prop rather than a boolean, so emptying that copy would silently
    // un-disable a mid-flight control. handleClick's `if (!kioskOnline || busy)
    // return` is the backstop; this is the affordance.
    let settle!: (v: { ok: boolean }) => void;
    startOutboundVideo.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        settle = r;
      }),
    );
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });

    // Resolved by name "Kiosk", which also pins that `busy` does NOT swap the
    // label — an in-flight click must not resize the control (spec §3.6a/§5.3).
    const inFlight = screen.getByRole("button", { name: "Kiosk" });
    expect((inFlight as HTMLButtonElement).disabled).toBe(true);
    // A net-new hover string this control did not previously carry: `busy`
    // rides the same `unavailableReason` prop that supplies the title, so the
    // reason surfaces on hover. Deliberate and informative, but asserted here
    // so it is a decision rather than a side effect nobody noticed.
    expect(inFlight.getAttribute("title")).toBe("Starting the call…");

    await act(async () => {
      settle({ ok: true });
    });
    const settled = screen.getByRole("button", { name: "Kiosk" });
    expect((settled as HTMLButtonElement).disabled).toBe(false);
    expect(settled.hasAttribute("title")).toBe(false);
  });

  it("a non-busy failure shows the try-again message", async () => {
    startOutboundVideo.mockResolvedValue({ ok: false });
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Could not start the call — try again."),
    );
  });

  it("a busy (409, property/agent already on a call) failure shows the already-on-a-call message", async () => {
    startOutboundVideo.mockResolvedValue({ ok: false, busy: true });
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Already on a call — try again shortly."),
    );
  });

  it("a subsequent successful call clears a prior error", async () => {
    startOutboundVideo.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());

    await act(async () => {
      screen.getByRole("button", { name: "Kiosk" }).click();
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(startOutboundVideo).toHaveBeenCalledTimes(2);
  });
});
