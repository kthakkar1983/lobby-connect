import { describe, expect, it } from "vitest";
import { serializeSubscription, urlBase64ToUint8Array } from "@/lib/push/sw-registration";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with padding restored", () => {
    // "hi~?" in base64url is aGl-Pw (uses - and _ variants)
    const bytes = urlBase64ToUint8Array("aGl-Pw");
    expect(Array.from(bytes)).toEqual([104, 105, 126, 63]);
  });
});

describe("serializeSubscription", () => {
  it("extracts endpoint + keys", () => {
    const sub = {
      toJSON: () => ({ endpoint: "https://fcm.example/e1", keys: { p256dh: "p", auth: "a" } }),
    } as unknown as PushSubscription;
    expect(serializeSubscription(sub)).toEqual({ endpoint: "https://fcm.example/e1", p256dh: "p", auth: "a" });
  });

  it("returns null when keys are missing", () => {
    const sub = { toJSON: () => ({ endpoint: "https://fcm.example/e1" }) } as unknown as PushSubscription;
    expect(serializeSubscription(sub)).toBeNull();
  });
});
