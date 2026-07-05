import { describe, it, expect, beforeEach, vi } from "vitest";
import { PUSH_TTL_SECONDS } from "@lc/shared";

// vi.mock factories are hoisted above the module body, so any variable they
// reference must be created via vi.hoisted (house pattern — see reliable-fetch.test).
const { sendNotification, setVapidDetails, captureMessage, captureException, resolveTargetUserIds, deleteEq } =
  vi.hoisted(() => ({
    sendNotification: vi.fn(),
    setVapidDetails: vi.fn(),
    captureMessage: vi.fn(),
    captureException: vi.fn(),
    resolveTargetUserIds: vi.fn(),
    deleteEq: vi.fn(),
  }));

// --- mock web-push (default export object) ---
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

// --- mock Sentry ---
vi.mock("@sentry/nextjs", () => ({ captureMessage, captureException }));

// --- mock VAPID config (avoid needing the env vars) ---
vi.mock("@/lib/push/vapid", () => ({
  getVapidConfig: () => ({ publicKey: "pub", privateKey: "priv", subject: "mailto:ops@x.com" }),
}));

// --- mock the targets resolver so send.test is isolated from targets logic ---
vi.mock("@/lib/push/targets", () => ({
  resolveTargetUserIds: (...args: unknown[]) => resolveTargetUserIds(...args),
}));

// --- mock createAdminClient: only push_subscriptions is touched by send.ts ---
// .select().in() returns subs; .delete().eq() records a prune.
let subsResult: Array<{ endpoint: string; p256dh: string; auth: string }> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "push_subscriptions") {
        return {
          select: () => ({ in: () => Promise.resolve({ data: subsResult }) }),
          delete: () => ({
            eq: (col: string, val: string) => {
              deleteEq(col, val);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { sendCallPush, type CallPushPayload } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

const payload: CallPushPayload = {
  type: "incoming-call",
  callId: "call-1",
  channel: "VIDEO",
  propertyId: "prop-1",
  propertyName: "Grand Hotel",
};

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  captureMessage.mockReset();
  captureException.mockReset();
  resolveTargetUserIds.mockReset();
  deleteEq.mockReset();
  sendNotification.mockResolvedValue(undefined);
  resolveTargetUserIds.mockResolvedValue(["agent-1", "admin-1"]);
  subsResult = [
    { endpoint: "https://push/1", p256dh: "k1", auth: "a1" },
    { endpoint: "https://push/2", p256dh: "k2", auth: "a2" },
  ];
});

describe("sendCallPush", () => {
  it("sends to every subscription of every target user with the JSON body + TTL", async () => {
    await sendCallPush(admin, payload);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const body = JSON.stringify(payload);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push/1", keys: { p256dh: "k1", auth: "a1" } },
      body,
      { TTL: PUSH_TTL_SECONDS },
    );
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push/2", keys: { p256dh: "k2", auth: "a2" } },
      body,
      { TTL: PUSH_TTL_SECONDS },
    );
  });

  it("prunes the endpoint on a 410 error and does NOT hit Sentry", async () => {
    sendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 410 });

    await sendCallPush(admin, payload);

    expect(deleteEq).toHaveBeenCalledWith("endpoint", "https://push/2");
    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("prunes the endpoint on a 404 error too", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });

    await sendCallPush(admin, payload);

    expect(deleteEq).toHaveBeenCalledWith("endpoint", "https://push/1");
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("captures a Sentry message on a non-expiry error and does NOT prune", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });

    await sendCallPush(admin, payload);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]![0]).toContain("500");
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it("never calls web-push when there are no target users", async () => {
    resolveTargetUserIds.mockResolvedValue([]);
    await sendCallPush(admin, payload);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does nothing (no send) when there are no subscriptions for the targets", async () => {
    subsResult = [];
    await sendCallPush(admin, payload);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never rejects even if resolveTargetUserIds throws (routes it to Sentry)", async () => {
    resolveTargetUserIds.mockRejectedValue(new Error("db down"));
    await expect(sendCallPush(admin, payload)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
