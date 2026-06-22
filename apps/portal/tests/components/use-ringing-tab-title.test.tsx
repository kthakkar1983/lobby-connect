import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useRingingTabTitle } from "@/lib/hooks/use-ringing-tab-title";

afterEach(cleanup);

describe("useRingingTabTitle", () => {
  it("sets the tab title while ringing and restores it when the ring stops", () => {
    document.title = "Agent · Lobby Connect";
    const { rerender } = renderHook(
      ({ ringing, title }: { ringing: boolean; title: string }) =>
        useRingingTabTitle(ringing, title),
      { initialProps: { ringing: false, title: "Incoming call" } },
    );

    expect(document.title).toBe("Agent · Lobby Connect");

    rerender({ ringing: true, title: "Incoming video call · Super 8" });
    expect(document.title).toBe("Incoming video call · Super 8");

    rerender({ ringing: false, title: "Incoming video call · Super 8" });
    expect(document.title).toBe("Agent · Lobby Connect");
  });

  it("updates the title when it changes mid-ring, still restoring the original", () => {
    document.title = "Admin · Lobby Connect";
    const { rerender, unmount } = renderHook(
      ({ ringing, title }: { ringing: boolean; title: string }) =>
        useRingingTabTitle(ringing, title),
      { initialProps: { ringing: true, title: "Incoming call" } },
    );

    expect(document.title).toBe("Incoming call");

    // Property name resolves after the ring starts.
    rerender({ ringing: true, title: "Incoming call · The Sample Hotel" });
    expect(document.title).toBe("Incoming call · The Sample Hotel");

    // Unmounting (e.g. accepting the call) restores the pre-ring title.
    unmount();
    expect(document.title).toBe("Admin · Lobby Connect");
  });
});
