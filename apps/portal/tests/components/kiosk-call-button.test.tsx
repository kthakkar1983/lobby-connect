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

  it("kioskOnline=false: disabled, labeled 'Kiosk offline', with an offline title hint", () => {
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} />);
    const btn = screen.getByRole("button", { name: "Kiosk offline" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Kiosk offline");
  });

  it("kioskOnline=false: clicking does not invoke startOutboundVideo", async () => {
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} />);
    const btn = screen.getByRole("button", { name: "Kiosk offline" });

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

  it("kioskOnline=true + DutyProvider canWork=false: disabled with a go-on-duty title hint, label stays 'Kiosk', never invokes startOutboundVideo", async () => {
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);
    render(<KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={true} />);
    const btn = screen.getByRole("button", { name: "Kiosk" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Go on duty to call");

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
