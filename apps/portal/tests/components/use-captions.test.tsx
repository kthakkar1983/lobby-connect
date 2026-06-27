import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";

// A controllable fake CaptionStream returned by the mocked provider.
const cap = vi.hoisted(() => {
  const handlers: { onPartial?: (t: string) => void; onFinal?: (t: string) => void } = {};
  const stop = vi.fn();
  const start = vi.fn(async (_track: unknown, onPartial: (t: string) => void, onFinal: (t: string) => void) => {
    handlers.onPartial = onPartial;
    handlers.onFinal = onFinal;
  });
  return {
    handlers,
    stop,
    start,
    createCaptionStream: vi.fn(() => ({ start, stop })),
  };
});
vi.mock("@/lib/captions/provider", () => ({ createCaptionStream: cap.createCaptionStream }));

import { useCaptions } from "@/lib/captions/use-captions";

function Harness({ track }: { track: MediaStreamTrack | null }) {
  const c = useCaptions(track);
  return (
    <div>
      <span data-testid="status">{c.status}</span>
      <span data-testid="partial">{c.partial}</span>
      <span data-testid="finals">{c.finals.join("|")}</span>
    </div>
  );
}

const fakeTrack = {} as MediaStreamTrack;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: "jwt-1" }) }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("useCaptions", () => {
  it("fetches a token, starts the stream, and accumulates partial + final captions", async () => {
    render(<Harness track={fakeTrack} />);

    await waitFor(() => expect(cap.start).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("live"));
    expect(cap.createCaptionStream).toHaveBeenCalledWith("jwt-1");

    await act(async () => cap.handlers.onPartial?.("hel"));
    expect(screen.getByTestId("partial").textContent).toBe("hel");

    await act(async () => cap.handlers.onFinal?.("Hello there."));
    expect(screen.getByTestId("finals").textContent).toBe("Hello there.");
    expect(screen.getByTestId("partial").textContent).toBe(""); // partial cleared on final
  });

  it("is idle and starts nothing when there is no track", async () => {
    render(<Harness track={null} />);
    expect(screen.getByTestId("status").textContent).toBe("idle");
    expect(cap.start).not.toHaveBeenCalled();
  });

  it("stops the stream on unmount", async () => {
    const { unmount } = render(<Harness track={fakeTrack} />);
    await waitFor(() => expect(cap.start).toHaveBeenCalled());
    unmount();
    expect(cap.stop).toHaveBeenCalled();
  });

  it("reports error status when the token fetch fails (captions off, no throw)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    render(<Harness track={fakeTrack} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  });
});
