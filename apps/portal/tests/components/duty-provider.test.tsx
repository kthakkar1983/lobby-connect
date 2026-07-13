/**
 * Task 14 (shift-tracking plan): DutyProvider owns duty/break state, hydrates
 * from GET /api/presence, and exposes goOnDuty/endShift/takeBreak/resume +
 * registerPrime/registerBeat seams so the softphone can register its real
 * ring-prime + beat without the provider owning the <audio> element (that
 * firewall against render loops — see CallSurfaceProvider — must be
 * preserved; this provider is deliberately separate).
 *
 * Fetch mocks modeled on tests/components/softphone.test.tsx's "D13 duty
 * hydration + gated beats" describe block: a plain URL-string switch, GET vs
 * POST /api/presence distinguished by init.method.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

const push = vi.hoisted(() => ({
  armPush: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
}));
vi.mock("@/lib/push/client", () => ({
  armPush: () => push.armPush(),
}));

import { DutyProvider, useDuty, useDutyOptional } from "@/components/dashboard/duty-provider";
import { DUTY_ACTIVATED_EVENT } from "@/lib/duty/duty-events";

describe("DutyProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let presenceGetBody: {
    onDuty: boolean;
    onBreak: boolean;
    accepting: boolean;
    shiftStartedAt: string | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    push.armPush.mockResolvedValue(true);
    presenceGetBody = {
      onDuty: true,
      onBreak: false,
      accepting: true,
      shiftStartedAt: "2026-07-12T01:00:00.000Z",
    };
    fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/presence" && (!init || init.method !== "POST")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(presenceGetBody),
        });
      }
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  function renderDuty() {
    return renderHook(() => useDuty(), {
      wrapper: ({ children }) => <DutyProvider>{children}</DutyProvider>,
    });
  }

  function postsTo(url: string) {
    return fetchMock.mock.calls.filter(
      (args) => args[0] === url && (args[1] as RequestInit | undefined)?.method === "POST",
    );
  }

  it("hydrates onDuty/onBreak/shiftStartedAt/accepting from GET /api/presence", async () => {
    presenceGetBody = {
      onDuty: false,
      onBreak: true,
      accepting: false,
      shiftStartedAt: "2026-07-12T02:00:00.000Z",
    };
    const { result } = renderDuty();

    await waitFor(() => expect(result.current.onDuty).toBe(false));
    expect(result.current.onBreak).toBe(true);
    expect(result.current.accepting).toBe(false);
    expect(result.current.shiftStartedAt).toBe("2026-07-12T02:00:00.000Z");
  });

  it("goOnDuty calls the registered prime fn and POSTs /api/presence/go-on-duty", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));

    const prime = vi.fn();
    act(() => {
      result.current.registerPrime(prime);
    });

    await act(async () => {
      await result.current.goOnDuty();
    });

    expect(prime).toHaveBeenCalledTimes(1);
    expect(push.armPush).toHaveBeenCalledTimes(1);
    expect(postsTo("/api/presence/go-on-duty")).toHaveLength(1);
  });

  it("takeBreak POSTs /api/presence/take-break and flips onBreak; resume POSTs /api/presence/resume and flips it back", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));

    await act(async () => {
      await result.current.takeBreak();
    });
    expect(result.current.onBreak).toBe(true);
    expect(postsTo("/api/presence/take-break")).toHaveLength(1);

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.onBreak).toBe(false);
    expect(postsTo("/api/presence/resume")).toHaveLength(1);
  });

  it("resume dispatches the duty-activated nudge (a call ringing during the break re-surfaces immediately)", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));
    const onActive = vi.fn();
    window.addEventListener(DUTY_ACTIVATED_EVENT, onActive);

    await act(async () => {
      await result.current.takeBreak();
    });
    await act(async () => {
      await result.current.resume();
    });

    expect(onActive).toHaveBeenCalled();
    window.removeEventListener(DUTY_ACTIVATED_EVENT, onActive);
  });

  it("goOnDuty dispatches the duty-activated nudge (a call ringing at clock-in re-surfaces immediately)", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));
    const onActive = vi.fn();
    window.addEventListener(DUTY_ACTIVATED_EVENT, onActive);

    await act(async () => {
      await result.current.goOnDuty();
    });

    expect(onActive).toHaveBeenCalled();
    window.removeEventListener(DUTY_ACTIVATED_EVENT, onActive);
  });

  it("canWork is onDuty && !onBreak", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));
    expect(result.current.canWork).toBe(true);

    await act(async () => {
      await result.current.takeBreak();
    });
    expect(result.current.onBreak).toBe(true);
    expect(result.current.canWork).toBe(false);

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.canWork).toBe(true);

    await act(async () => {
      await result.current.endShift();
    });
    expect(result.current.onDuty).toBe(false);
    expect(result.current.canWork).toBe(false);
    expect(postsTo("/api/presence/end-shift")).toHaveLength(1);
  });

  it("hydrated flips true after the initial GET settles", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
  });

  it("hydrated flips true even when the initial GET fails (fail-open)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/presence" && (!init || init.method !== "POST")) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    });
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    // Fail-open: onDuty default stands.
    expect(result.current.onDuty).toBe(true);
  });

  it("setAccepting updates accepting (softphone toggle pushes its value back)", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));
    expect(result.current.accepting).toBe(true);
    act(() => {
      result.current.setAccepting(false);
    });
    expect(result.current.accepting).toBe(false);
  });

  it("markOffDuty flips onDuty/onBreak off WITHOUT POSTing end-shift", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));
    act(() => {
      result.current.markOffDuty();
    });
    expect(result.current.onDuty).toBe(false);
    expect(result.current.onBreak).toBe(false);
    expect(result.current.shiftStartedAt).toBeNull();
    // No POST to any presence route — the server already ended the shift.
    expect(postsTo("/api/presence/end-shift")).toHaveLength(0);
  });

  it("refreshFromServer re-reads truth, applies it, and returns the applied booleans", async () => {
    const { result } = renderDuty();
    await waitFor(() => expect(result.current.onDuty).toBe(true));

    // Server truth changed (shift resumed elsewhere with Accepting off).
    presenceGetBody = {
      onDuty: true,
      onBreak: false,
      accepting: false,
      shiftStartedAt: "2026-07-12T05:00:00.000Z",
    };
    let applied: { onDuty: boolean | null; accepting: boolean | null } | null = null;
    await act(async () => {
      applied = await result.current.refreshFromServer();
    });
    expect(applied).toEqual({ onDuty: true, accepting: false });
    expect(result.current.accepting).toBe(false);
    expect(result.current.shiftStartedAt).toBe("2026-07-12T05:00:00.000Z");
  });

  it("useDuty throws when rendered outside the provider", () => {
    const { result } = renderHook(() => {
      try {
        return { value: useDuty(), error: null };
      } catch (error) {
        return { value: null, error: error as Error };
      }
    });
    expect(result.current.value).toBeNull();
    expect(result.current.error?.message).toBe("useDuty must be used within DutyProvider");
  });

  it("useDutyOptional returns null when rendered outside the provider", () => {
    const { result } = renderHook(() => useDutyOptional());
    expect(result.current).toBeNull();
  });
});
