// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchRustdesk } from "@/lib/remote-access/connect";

// Regression guard for the 2026-07-07 staging bug: launching the rustdesk://
// deep link via a top-level navigation (window.location.assign) fired the
// page's unload and tore down the live LiveKit PeerConnections, killing the
// in-progress video call the instant Connect was pressed. The launch MUST go
// through a transient subframe so the top document is never unloaded. (A revert
// to location.assign creates no iframe, so the not.toBeNull() assertion fails.)
describe("launchRustdesk", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("launches through a hidden iframe (never a top-level navigation), with an encoded src", () => {
    launchRustdesk({ peerId: "511 505", password: "pw?&x" });

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "rustdesk://connection/new/511%20505?password=pw%3F%26x",
    );
    expect(iframe?.style.display).toBe("none");
    expect(iframe?.getAttribute("aria-hidden")).toBe("true");
  });

  it("removes the transient iframe after the launch window", () => {
    vi.useFakeTimers();
    launchRustdesk({ peerId: "123456", password: "pw" });
    expect(document.querySelector("iframe")).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
