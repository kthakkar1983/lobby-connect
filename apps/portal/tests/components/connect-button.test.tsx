import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

// Mock only the hook the button reads — keeps this test focused on the button's
// three branches, without spinning up the provider's pre-warm machinery.
const { useCallSurfaceOptional, connectToProperty } = vi.hoisted(() => ({
  useCallSurfaceOptional: vi.fn(),
  connectToProperty: vi.fn(),
}));

vi.mock("@/components/dashboard/call-surface-provider", () => ({
  useCallSurfaceOptional: () => useCallSurfaceOptional(),
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
});
