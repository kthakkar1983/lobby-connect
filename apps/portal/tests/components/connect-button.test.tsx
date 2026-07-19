import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

// Mock only the hooks the button reads — keeps this test focused on the button's
// branches, without spinning up the provider's pre-warm machinery or a real
// DutyProvider hydration cycle.
const { useCallSurfaceOptional, connectToProperty } = vi.hoisted(() => ({
  useCallSurfaceOptional: vi.fn(),
  connectToProperty: vi.fn(),
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

import { ConnectButton } from "@/components/dashboard/connect-button";

/** A minimal surface stub — only connectToProperty is exercised by the button. */
function surfaceStub() {
  return { connectToProperty } as unknown as ReturnType<typeof useCallSurfaceOptional>;
}

afterEach(() => cleanup());

beforeEach(() => {
  useCallSurfaceOptional.mockReset();
  connectToProperty.mockReset();
  useCallSurfaceOptional.mockReturnValue(surfaceStub());
  useDutyOptional.mockReset();
  // Default: no DutyProvider mounted (owner surfaces + every other test in this
  // file) — Task 17's gate must be a total no-op here, matching production.
  useDutyOptional.mockReturnValue(null);
});

describe("ConnectButton", () => {
  it("renders nothing outside a CallSurfaceProvider", () => {
    useCallSurfaceOptional.mockReturnValue(null);
    const { container } = render(<ConnectButton propertyId="prop-1" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Connect")).toBeNull();
  });

  it("launched=true clears any prior error and shows no alert", async () => {
    // First click fails (notConfigured) → error shows; second click launches → clears.
    connectToProperty
      .mockResolvedValueOnce({ launched: false, notConfigured: true })
      .mockResolvedValueOnce({ launched: true });
    render(<ConnectButton propertyId="prop-1" />);

    await act(async () => {
      screen.getByText("Connect").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "No remote access configured — ask an admin.",
      ),
    );

    await act(async () => {
      screen.getByText("Connect").click();
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(connectToProperty).toHaveBeenLastCalledWith("prop-1");
  });

  it("notConfigured shows the ask-an-admin message", async () => {
    connectToProperty.mockResolvedValue({ launched: false, notConfigured: true });
    render(<ConnectButton propertyId="prop-1" />);

    await act(async () => {
      screen.getByText("Connect").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "No remote access configured — ask an admin.",
      ),
    );
  });

  it("a transport failure (not notConfigured) shows the try-again message", async () => {
    connectToProperty.mockResolvedValue({ launched: false, notConfigured: false });
    render(<ConnectButton propertyId="prop-1" />);

    await act(async () => {
      screen.getByText("Connect").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Could not fetch credentials — try again.",
      ),
    );
  });

  it("is never disabled (agents + admins, any call phase — D10/D11)", () => {
    render(<ConnectButton propertyId="prop-1" />);
    const btn = screen.getByText("Connect").closest("button")!;
    expect(btn.disabled).toBe(false);
  });

  it("Task 17: with no DutyProvider mounted, ignores canWork entirely (never gated)", () => {
    // Belt-and-suspenders on top of the default beforeEach stub: even if a
    // caller somehow returned a duty-shaped value, useDutyOptional() returning
    // null (no provider) must short-circuit the gate.
    useDutyOptional.mockReturnValue(null);
    render(<ConnectButton propertyId="prop-1" />);
    const btn = screen.getByText("Connect").closest("button")!;
    expect(btn.disabled).toBe(false);
  });

  it("duty-column polish: canWork=false keeps the button ENABLED and labelled Connect, but withholds the action", async () => {
    // Repointed from Task 17's disabled+relabel assertion. Spec §3.4/D8: a
    // `disabled` button fires no click event, so the off-duty prompt could
    // never intercept it and could never offer to start the shift. The gate
    // moved into <PropertyActionButton>'s useDutyGuard, which keeps the control
    // live and withholds the call instead.
    //
    // THIS IS THE LOAD-BEARING ASSERTION for the enabled half: useDutyGuard has
    // no power to add or remove a `disabled` attribute, so the hook's own tests
    // cannot prove it. Only a rendered control can.
    useDutyOptional.mockReturnValue({ canWork: false } as unknown as ReturnType<typeof useDutyOptional>);
    render(<ConnectButton propertyId="prop-1" />);

    const btn = screen.getByRole("button")!;
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.hasAttribute("disabled")).toBe(false);

    // Spec §3.6: no per-card "Go on duty" swap — with five properties per pod
    // it repeats across every card and reads as noise. The prompt says it once.
    expect(btn.textContent).toBe("Connect");

    await act(async () => {
      btn.click();
    });
    expect(connectToProperty).not.toHaveBeenCalled();
  });

  it("Task 17: DutyProvider present + canWork=true behaves exactly like the no-provider case", async () => {
    useDutyOptional.mockReturnValue({ canWork: true } as unknown as ReturnType<typeof useDutyOptional>);
    connectToProperty.mockResolvedValue({ launched: true });
    render(<ConnectButton propertyId="prop-1" />);

    const btn = screen.getByText("Connect").closest("button")!;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.click();
    });
    expect(connectToProperty).toHaveBeenCalledWith("prop-1");
  });
});
