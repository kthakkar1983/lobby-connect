# Phase 3 — Agent + Admin Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Phase-3 workspace design (`docs/specs/2026-07-04-phase3-workspace-design.md`, D1–D12): push-first alerting with an audible contract, dashboard-first property-card answering, the call-scoped Document-PiP tile, RustDesk remote-access credentials + Connect (card and in-call), and duty controls — with the dial/911/overlay machinery untouched except the additive, byte-reviewed seam this plan names explicitly (Task 4). **Hold is DEFERRED out of Phase 3** (Kumar, plan gate 2026-07-04: "push it to when we have more than one property") — the recorded design lives in spec §3.6; cards/tile/provider keep a dormant `on-hold` state seam and nothing sets it.

**Architecture:** Five shippable phases in spec §6 order — (A) Gate 3.1 push-ring spike, (B) property cards + ring-on-card, (C) push productionized + Go on duty / End shift, (D) call tile, (E) remote access + Connect, then close-out. The client work pivots on one new context (`CallSurfaceProvider`, grown beside the existing `LineStatusProvider`) that `Softphone` and the video-incoming hook *publish into* and cards/tile *consume from* — the Twilio `Device` and Agora machinery stay mounted exactly where they are today (D1/D2). Push is a third transport for the existing "calls-changed" nudge (SW message → the same `tick()` refetch realtime triggers), not a new ring pathway.

**Tech Stack:** Next.js 15 App Router (typed routes), React 19, Tailwind v4 brand tokens, Twilio Voice SDK + REST, Agora RTC, Supabase (Postgres + RLS + Realtime), `web-push@3.6.7` (new dep), Document Picture-in-Picture (Chromium), Vitest (node + jsdom profiles).

**Conventions (house rules — every task):**
- No hardcoded hex; brand tokens only (`bg-live`, `text-attention-text`, `border-border`, …). Red = 911/destructive only; blaze = sparing attention accent; rings/live = mint.
- Migrations in `supabase/migrations/`, committed before applied; run `pnpm gen:types` after each (CI drift-check enforces). Supabase CLI is pinned `2.101.0`; `supabase start` must be running.
- All `profiles.status`/`last_seen_at` writes stay service-role. Audit via `logAuditEvent` + constants in `lib/audit/actions.ts`.
- Typed routes: no `as never`; dynamic hrefs use `as Route`.
- Per-task gate: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test` (+ `pnpm lint`, `pnpm check:routes`, `pnpm -F @lc/portal build` at phase ends). Full suite currently ~523 tests — keep green.
- Commit after every task (`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, no emojis).
- Branch: `phase3-workspace`. Staging = push the `staging` branch (box auto-deploys); prod = PR to `main` (Claude cannot push `main`).

**Load-bearing DO-NOT-TOUCH list (spec §4):** dial/routing semantics (`plan-dial`, presence gating, apology TwiML), the 911 conference machinery (with hold deferred, NOTHING in this plan touches it; Task 4 touches adjacent TwiML and carries an explicit byte-review step), both in-call overlays' call logic (additive controls only), kiosk semantics, RLS posture, heartbeat presence model, reaper/finalization.

---

## Migration renumbering note (vs spec §3.7)

Ship order puts push before remote access, so: **0019 = `push_subscriptions`** (Phase C), **0020 = `property_remote_access`** (Phase E). The spec's §3.5/§3.7 lines are amended accordingly. (The former 0021 hold-columns migration is deferred with hold.)

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `apps/portal/lib/push/vapid.ts` | VAPID env reader (server) | 1 |
| `apps/portal/public/push-sw.js` | Service worker: push → toast + tab message; click → focus/open | 2 (spike), 12 (prod) |
| `apps/portal/lib/push/sw-registration.ts` | Client SW register + subscribe helpers | 2 (spike), 12 |
| `apps/portal/app/duty-tile-prototype/push-spike.tsx` + `app/api/push-spike/route.ts` | Gate 3.1 spike UI + delayed-send route (temporary) | 2, 3 (drill), 13 (removed) |
| `apps/portal/lib/voice/twiml.ts` | + `propertyId` `<Parameter>` (additive, reviewed) | 4 |
| `apps/portal/lib/dashboard/pods.ts` | Pure pod-grouping + card live-state + duty-label helpers (TDD) | 5 |
| `apps/portal/components/dashboard/call-surface-provider.tsx` | New context: incoming/active call state + accept dispatchers | 6 |
| `apps/portal/lib/hooks/use-incoming-video-calls.ts` | Video-incoming detection (moved out of the banner; realtime + poll + focus + SW message) | 7 |
| `apps/portal/components/softphone/softphone.tsx` | Publish into provider; incoming block UI retired; duty/heartbeat arm | 7, 15 |
| `apps/portal/components/video-call/video-call-host.tsx` | Headless incoming publisher + overlay mount | 7 |
| `apps/portal/components/dashboard/property-card.tsx` | Shared card (both scopes): identity, live state, tonight, Answer/Connect | 8, 19 (Connect) |
| `apps/portal/app/(agent)/agent/page.tsx` | Pod card grid replaces right-rail placements | 8, 9 |
| `apps/portal/app/(admin)/admin/page.tsx` | Pod-grouped fleet cards replace ops table | 9 |
| `apps/portal/components/dashboard-workspace.tsx` | Aside → headless hosts; toast retired | 9 |
| `supabase/migrations/0019_push_subscriptions.sql` | Push subscription store + RLS | 10 |
| `apps/portal/lib/push/send.ts` + `lib/push/targets.ts` | web-push send + prune + per-property target users (TDD) | 11 |
| `apps/portal/app/api/push/subscription/route.ts` | Session-authed subscribe/unsubscribe | 11 |
| `apps/portal/lib/push/client.ts` | Browser subscribe/sync manager | 12 |
| `apps/portal/app/api/kiosk/call-started/route.ts` (+ answer-video, end-video, call-ended) | Push send beside broadcast in `after()` | 13 |
| `apps/portal/components/dashboard/duty-controls.tsx` + `app/api/presence/end-shift/route.ts` | Go on duty / End shift | 14, 15 |
| `apps/portal/lib/duty-tile/call-tile-manager.ts` + `components/call-tile/*` | Call-scoped DocPiP tile | 16, 17 |
| `supabase/migrations/0020_property_remote_access.sql` | Credentials table, service-role only | 18 |
| `apps/portal/app/api/remote-access/[propertyId]/route.ts` + `lib/remote-access/*` + admin CRUD | Credential API + Connect + pre-warm | 18, 19, 20 |
| `packages/shared/src/protocol.ts` | + `PUSH_TTL_SECONDS` guard | 11 |

(Hold files — migration, `lib/hold/`, hold route, dial-result/emergency touches — are DEFERRED with hold; recorded design in spec §3.6.)

Retired in place: softphone incoming block (7), `IncomingVideoBanner` UI + `IncomingCallToast` + persistent Video card (9), `/duty-tile-prototype` route (21).

---

# PHASE A — Gate 3.1: push-ring spike (spec §5)

Evidence-first: prove push wakes the SW and the throttled tab rings loudly on Kumar's real machines before anything depends on Web Push. Everything in this phase except `push-sw.js` and `lib/push/vapid.ts` is throwaway (removed in Task 13/25).

## Task 1: `web-push` dep + VAPID env plumbing

**Files:**
- Modify: `apps/portal/package.json` (dependency)
- Create: `apps/portal/lib/push/vapid.ts`
- Test: `apps/portal/tests/lib/push/vapid.test.ts`

- [ ] **Step 1: Add the dependency**

```bash
pnpm -F @lc/portal add web-push@3.6.7
pnpm -F @lc/portal add -D @types/web-push
```

- [ ] **Step 2: Generate the VAPID keypair (one-time, human step recorded here)**

```bash
npx web-push generate-vapid-keys
```

Produces a public + private key. Env vars (names locked here):
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public, both apps' envs (Vercel prod/preview + Coolify staging + `.env.local`)
- `VAPID_PRIVATE_KEY` — server-only (Vercel + Coolify staging + `.env.local`; never NEXT_PUBLIC)
- `VAPID_SUBJECT` — `mailto:kthakkar.1983@gmail.com`

Set via `vercel env add` (CLI is authed) for prod and the Coolify UI for staging (runbook §5 app env section). Keys go in the PM vault like the other secrets (`docs/setup/2026-07-03-accounts-credentials-inventory.md` gains a row).

- [ ] **Step 3: Write the failing test**

```typescript
// apps/portal/tests/lib/push/vapid.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getVapidConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the three VAPID values when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const { getVapidConfig } = await import("@/lib/push/vapid");
    expect(getVapidConfig()).toEqual({
      publicKey: "pub-key",
      privateKey: "priv-key",
      subject: "mailto:ops@example.com",
    });
  });

  it("throws a named error when a value is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const { getVapidConfig } = await import("@/lib/push/vapid");
    expect(() => getVapidConfig()).toThrow(/VAPID_PRIVATE_KEY/);
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`Cannot find module '@/lib/push/vapid'`)

Run: `pnpm -F @lc/portal test tests/lib/push/vapid.test.ts`

- [ ] **Step 5: Implement**

```typescript
// apps/portal/lib/push/vapid.ts
// VAPID credentials for Web Push. Read at call time (not module load) so
// vi.stubEnv works in tests and the build doesn't need the private key
// (same pattern as lib/twilio/config.ts).

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidConfig(): VapidConfig {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey) throw new Error("Missing env: NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  if (!privateKey) throw new Error("Missing env: VAPID_PRIVATE_KEY");
  if (!subject) throw new Error("Missing env: VAPID_SUBJECT");
  return { publicKey, privateKey, subject };
}
```

- [ ] **Step 6: Run tests — expect PASS**, then `pnpm -F @lc/portal typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/portal/package.json pnpm-lock.yaml apps/portal/lib/push/vapid.ts apps/portal/tests/lib/push/vapid.test.ts
git commit -m "feat(push): web-push dep + VAPID config reader (Gate 3.1 groundwork)"
```

## Task 2: minimal service worker + spike page + delayed-send route

**Files:**
- Create: `apps/portal/public/push-sw.js`
- Create: `apps/portal/lib/push/sw-registration.ts`
- Create: `apps/portal/app/api/push-spike/route.ts` (temporary)
- Create: `apps/portal/components/duty-tile/push-spike-panel.tsx` (temporary)
- Modify: `apps/portal/components/duty-tile/duty-tile-prototype.tsx` (render the panel)
- Test: `apps/portal/tests/lib/push/sw-registration.test.ts`

The SW written here is already the production skeleton (Task 12 only extends it); the spike route + panel are marked temporary and die in Task 13.

- [ ] **Step 1: The service worker.** Plain JS, no imports (served verbatim from `public/`):

```javascript
// apps/portal/public/push-sw.js
// Lobby Connect push service worker.
// Contract: every push shows an OS notification (Chrome silent-push budget)
// AND messages open tabs; the TAB owns ring audio (audible contract, spec §3.2).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const type = data.type || "incoming-call";
  const propertyName = data.propertyName || "a property";

  event.waitUntil(
    (async () => {
      // Tell every open portal tab first — the tab plays the loud primed ring.
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const tab of tabs) {
        tab.postMessage({ source: "lc-push", ...data, receivedAt: Date.now() });
      }
      if (type === "call-cleared") {
        // Close the matching incoming toast; no new notification.
        const existing = await self.registration.getNotifications({ tag: data.callId || "" });
        for (const n of existing) n.close();
        return;
      }
      await self.registration.showNotification("Lobby Connect — incoming call", {
        body: `Incoming ${data.channel === "AUDIO" ? "phone" : "video"} call · ${propertyName}`,
        tag: data.callId || "lc-incoming",
        requireInteraction: true,
        icon: "/brand/mark.svg",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (tabs.length > 0) {
        await tabs[0].focus();
        // Ask the tab to navigate home so the ringing card is on screen.
        tabs[0].postMessage({ source: "lc-push", type: "focus-home" });
        return;
      }
      await self.clients.openWindow("/");
    })(),
  );
});
```

- [ ] **Step 2: Client registration/subscription helpers** (pure enough to unit-test with mocked globals):

```typescript
// apps/portal/lib/push/sw-registration.ts
// Browser-side service-worker + push-subscription helpers. All feature-detected:
// on non-supporting browsers every function is a safe no-op returning null.

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/push-sw.js");
  } catch {
    return null;
  }
}

/** Base64url → Uint8Array (applicationServerKey wants bytes). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function serializeSubscription(sub: PushSubscription): SubscriptionKeys | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Ask permission (must be inside a user gesture) and subscribe. */
export async function ensurePushSubscription(vapidPublicKey: string): Promise<SubscriptionKeys | null> {
  const reg = await registerPushServiceWorker();
  if (!reg) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return serializeSubscription(existing);
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
    return serializeSubscription(sub);
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Failing tests for the pure parts**

```typescript
// apps/portal/tests/lib/push/sw-registration.test.ts
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
```

Run: `pnpm -F @lc/portal test tests/lib/push/sw-registration.test.ts` — FAIL (module missing) → create the module (Step 2 code) → PASS.

- [ ] **Step 4: The temporary spike route.** Client holds its own subscription (no DB in the spike); the route sleeps then sends. The 360s case is judged on the box staging (long-running container — `setTimeout` reliable); Vercel gets `maxDuration = 60` so the 15s/60s cases also work on prod if needed.

```typescript
// apps/portal/app/api/push-spike/route.ts
// TEMPORARY — Gate 3.1 spike only (removed once push is productionized).
// Accepts a raw subscription + delay, sleeps, sends one push. The 360s case
// exceeds Vercel limits by design: run the full drill against box staging.
import { NextResponse } from "next/server";
import webpush from "web-push";
import { requireApiActor } from "@/lib/auth/api-actor";
import { getVapidConfig } from "@/lib/push/vapid";

export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const body = (await request.json().catch(() => ({}))) as {
    subscription?: { endpoint: string; p256dh: string; auth: string };
    delaySeconds?: number;
  };
  if (!body.subscription?.endpoint) {
    return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
  }
  const delay = Math.min(Math.max(body.delaySeconds ?? 15, 0), 600);
  const scheduledFor = Date.now() + delay * 1000;

  const vapid = getVapidConfig();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  await new Promise((r) => setTimeout(r, delay * 1000));
  try {
    await webpush.sendNotification(
      {
        endpoint: body.subscription.endpoint,
        keys: { p256dh: body.subscription.p256dh, auth: body.subscription.auth },
      },
      JSON.stringify({
        type: "incoming-call",
        callId: `spike-${scheduledFor}`,
        channel: "VIDEO",
        propertyName: "Push spike",
        scheduledFor,
      }),
      { TTL: 120 },
    );
    return NextResponse.json({ ok: true, scheduledFor });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 5: The spike panel** — added to the existing prototype page (client component). It reuses the Gate-3.0 report vocabulary: log lines, delivery latency (`receivedAt - scheduledFor`), visibility state at receipt, silent-ring detection (same 600ms paused check), loud ring via the same primed `Audio("/sounds/ring.mp3")`.

```tsx
// apps/portal/components/duty-tile/push-spike-panel.tsx
"use client";
// TEMPORARY — Gate 3.1 spike panel (lives on /duty-tile-prototype; removed
// with the prototype). Subscribe → schedule a server push → minimized-browser
// drill. The TAB plays the ring on the SW message; the toast is observed only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import {
  ensurePushSubscription,
  pushSupported,
  type SubscriptionKeys,
} from "@/lib/push/sw-registration";

interface LogEntry {
  at: number;
  msg: string;
}

export function PushSpikePanel(): React.JSX.Element {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionKeys | null>(null);
  const [ringing, setRinging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [{ at: Date.now(), msg }, ...l].slice(0, 100));
  }, []);

  // SW messages: ring + measure. Listener attached for the page's lifetime.
  useEffect(() => {
    if (!pushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        scheduledFor?: number;
        receivedAt?: number;
      };
      if (data?.source !== "lc-push") return;
      const latencyMs =
        data.receivedAt && data.scheduledFor ? Math.max(0, data.receivedAt - data.scheduledFor) : null;
      addLog(
        `PUSH received (tab ${document.visibilityState}) — delivery latency ${
          latencyMs === null ? "unknown" : `${(latencyMs / 1000).toFixed(1)}s`
        }`,
      );
      setRinging(true);
      ringtoneRef.current?.start();
      setTimeout(() => {
        if (audioRef.current?.paused) {
          addLog("Ring audio is NOT playing (blocked?) — ring was visual-only");
        }
      }, 600);
      setTimeout(() => {
        ringtoneRef.current?.stop();
        setRinging(false);
      }, 20_000);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [addLog]);

  const subscribe = useCallback(async () => {
    // Prime the ringtone inside this click (Gate-3.0 pattern).
    if (!audioRef.current) {
      const audio = new Audio("/sounds/ring.mp3");
      audio.loop = true;
      audio.preload = "auto";
      audioRef.current = audio;
      ringtoneRef.current = createRingtone(audio);
    }
    const audio = audioRef.current;
    if (audio.paused) {
      void Promise.resolve(audio.play())
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {});
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      addLog("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set in this env");
      return;
    }
    const sub = await ensurePushSubscription(publicKey);
    if (!sub) {
      addLog("Subscribe failed (permission denied or unsupported browser)");
      return;
    }
    setSubscription(sub);
    addLog(`Subscribed — audio primed. Endpoint …${sub.endpoint.slice(-16)}`);
  }, [addLog]);

  const schedule = useCallback(
    async (delaySeconds: number) => {
      if (!subscription) return;
      addLog(`Push scheduled in ${delaySeconds}s — minimize the browser NOW, put RustDesk fullscreen`);
      const res = await fetch("/api/push-spike", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription, delaySeconds }),
      }).catch(() => null);
      if (!res || !res.ok) addLog(`Schedule/send failed (${res ? res.status : "network"})`);
      else addLog("Server confirms the push was sent");
    },
    [addLog, subscription],
  );

  const copyReport = useCallback(async () => {
    const lines = [
      "Push-ring spike — Gate 3.1 report",
      `When: ${new Date().toString()}`,
      `Browser: ${navigator.userAgent}`,
      `Notification permission: ${typeof Notification !== "undefined" ? Notification.permission : "unsupported"}`,
      "",
      "Event log (oldest first):",
      ...[...log].reverse().map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.msg}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      addLog("Report copied to clipboard");
    } catch {
      addLog("Clipboard blocked — screenshot this panel instead");
    }
  }, [addLog, log]);

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Gate 3.1 — push ring
      </h2>
      {!pushSupported() && (
        <p className="mt-2 text-sm text-attention-text">This browser does not support Web Push.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void subscribe()}>
          {subscription ? "Re-subscribe" : "Subscribe + prime audio"}
        </Button>
        {[15, 60, 360].map((s) => (
          <Button
            key={s}
            variant="neutral"
            disabled={!subscription}
            onClick={() => void schedule(s)}
          >
            Push in {s >= 60 ? `${s / 60}m` : `${s}s`}
          </Button>
        ))}
        <Button variant="neutral" onClick={() => void copyReport()}>
          Copy report
        </Button>
        {ringing && (
          <span className="rounded-pill bg-live/15 px-3 py-1 text-sm font-medium text-live-foreground">
            RINGING (push)
          </span>
        )}
      </div>
      <ol className="mt-4 max-h-56 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
        {log.map((e) => (
          <li key={`${e.at}-${e.msg}`}>
            {new Date(e.at).toLocaleTimeString()} {e.msg}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 6: Mount the panel** in `apps/portal/components/duty-tile/duty-tile-prototype.tsx` — import `PushSpikePanel` and render it directly above the existing test-ring section (one `<PushSpikePanel />` line; no other changes to the prototype).

- [ ] **Step 7: Gate** — `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test && pnpm -F @lc/portal build` (build proves `public/push-sw.js` ships and the route compiles without the VAPID private key).

- [ ] **Step 8: Commit**

```bash
git add apps/portal/public/push-sw.js apps/portal/lib/push/sw-registration.ts apps/portal/app/api/push-spike/route.ts apps/portal/components/duty-tile/push-spike-panel.tsx apps/portal/components/duty-tile/duty-tile-prototype.tsx apps/portal/tests/lib/push/sw-registration.test.ts
git commit -m "feat(gate3.1): push-ring spike — SW skeleton, subscribe panel, delayed-send route (temporary)"
```

## Task 3: Gate 3.1 drill on staging (HUMAN GATE)

- [x] **Step 1:** Set the three VAPID env vars in Coolify (staging app) + Vercel. Merge `phase3-workspace` → `staging` branch and push (box auto-deploys).
- [x] **Step 2:** Kumar's drill on **both machines** (Windows PC first, then Mac), against `staging.lobby-connect.com/duty-tile-prototype`:
  1. Subscribe + prime audio (accept the notification permission prompt).
  2. Push in 15s → minimize the browser, RustDesk fullscreen → expect: loud ring within a few seconds of the scheduled time + OS toast naming "Push spike" + log line with delivery latency and `tab hidden`.
  3. Push in 60s → same drill.
  4. Push in 6m → the intensive-throttling case. Minimize immediately; do real RustDesk work for the wait.
  5. Click the toast once → portal focuses (observed, not gating).
  6. Copy report → paste back.
- [x] **Step 3: Judge.** **PASS** = loud ring within a few seconds on every drill on both machines (toast observed). Record the two reports in `docs/plans/2026-07-04-phase3-workspace.md` under this task (paste summaries) and proceed. **FAIL** = stop; the all-shift keepalive tile (Gate 3.0, proven) returns as Plan B — record the decision and re-plan Phase C around the tile before continuing.

**RESULT — GATE 3.1 = PASS on both machines (2026-07-04). Phase C is GO; Plan B not needed.**

- **Mac** (Chrome 149, ~15:14 CDT): 15s/60s/360s pushes all received tab-hidden; client-clock latencies **0.4/0.5/0.7s**; the 360s box delayed send fired exactly on schedule (the case Vercel cannot run).
- **Windows PC** (Win10/Chrome 149, ~17:53 CDT): same drill clean; latencies **0.4/0.4/0.6s**; the 360s push landed at 5:36:02 inside a tab-hidden stretch (5:30:09→5:36:09).
- **Throttling cross-proof (both machines):** the tile-prototype tab was open concurrently and logged **max tick gap 60.0s (THROTTLED)** during each 360s wait — the push still arrived sub-second. Push wake is independent of tab throttling, which is the thesis this gate existed to test.
- The Gate-3.0 tile also re-rang on time on the A+B build on both OSes (prototype intact post-refactor). The Windows 360s tile ring went unanswered (Kumar away from the desk) and timed out at the prototype's 45s — behavior correct, but it surfaced a product finding:
- **Product finding (Kumar): a ring-SILENCE control is needed on both agent and admin ringing surfaces** — mute the local ringer without rejecting; the ring stays visible and answerable. Logged under Task 10's fix loop; the Phase-D tile gets the same control.

---

# PHASE B — Property cards + ring-on-card (D1, D2 — highest daily value)

## Task 4: `propertyId` custom parameter on the audio dial (additive TwiML change, reviewed)

The cards need the ringing property's **id**; audio incoming currently carries only `callId` + `propertyName`. One additive `<Parameter>`. Routing semantics (targets, timeout, action, apology) byte-identical.

**Files:**
- Modify: `apps/portal/lib/voice/twiml.ts` (`IncomingTwimlOpts` + the `<Client>` block)
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts` (pass `propertyId: property.id`)
- Test: `apps/portal/tests/lib/voice/twiml.test.ts` (extend existing)

- [ ] **Step 1: Extend the existing TwiML test** — in the `buildIncomingTwiml` describe block, add:

```typescript
it("includes a propertyId Parameter on every Client noun", () => {
  const xml = buildIncomingTwiml({
    greeting: "g",
    timeoutSeconds: 120,
    actionUrl: "https://x/api/twilio/voice/dial-result",
    apologyMessage: "a",
    callId: "call-1",
    propertyName: "The Sample Hotel",
    propertyId: "prop-1",
    identities: ["lc_abc"],
  });
  expect(xml).toContain('<Parameter name="propertyId" value="prop-1"/>');
  // The existing params are untouched:
  expect(xml).toContain('<Parameter name="callId" value="call-1"/>');
  expect(xml).toContain('<Parameter name="propertyName" value="The Sample Hotel"/>');
});
```

(Match the real option/arg names in `twiml.ts` when writing this — the file's existing tests show the exact `buildIncomingTwiml` signature; add `propertyId: string` to its opts interface.)

- [ ] **Step 2: Run — FAIL.** Then implement: add `propertyId: string` to `IncomingTwimlOpts` and emit `<Parameter name="propertyId" value="${escapeXml(opts.propertyId)}"/>` beside the existing two Parameters (use the file's existing XML-escaping helper exactly as `callId` does).

- [ ] **Step 3:** In `app/api/twilio/voice/incoming/route.ts`, add `propertyId: property.id` to the `buildIncomingTwiml({...})` call. No other change in the route.

- [ ] **Step 4: Full voice test files green:** `pnpm -F @lc/portal test tests/lib/voice tests/app/twilio` (paths per repo layout).

- [ ] **Step 5: REVIEW STEP (voice-path discipline):** diff `lib/voice/twiml.ts` + `app/api/twilio/voice/incoming/route.ts` and confirm in the commit message: only the Parameter line + opts field + call-site arg changed; `<Dial>` attributes, greeting, apology, identity loop byte-identical.

- [ ] **Step 6: Commit** (`feat(voice): additive propertyId Parameter for card-scoped ringing — dial semantics unchanged`).

## Task 5: pure helpers — pod grouping, card live state, duty labels (TDD)

**Files:**
- Create: `apps/portal/lib/dashboard/pods.ts`
- Test: `apps/portal/tests/dashboard/pods.test.ts`

- [ ] **Step 1: Failing tests first** — write `tests/dashboard/pods.test.ts` covering every helper below: `groupPodsByAgent` (groups properties under their assigned agent, unassigned trail in a final group, agents ordered by name, properties ordered by name within a pod), `cardLiveState` precedence (`ringing` > `on-hold` > `on-call` > `quiet`), and `dutyLabel` (AVAILABLE+fresh → "On duty", ON_CALL+fresh → "On call", AWAY+fresh → "Away", OFFLINE or stale-anything → "Off duty" — reuse `effectivePresence` semantics with `PRESENCE_STALE_AFTER_MS`).

```typescript
// apps/portal/tests/dashboard/pods.test.ts
import { describe, expect, it } from "vitest";
import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";
import { cardLiveState, dutyLabel, groupPodsByAgent } from "@/lib/dashboard/pods";

const props = [
  { id: "p1", name: "Rosewood Inn", timezone: "America/Chicago" },
  { id: "p2", name: "Hilltop Suites", timezone: "America/Chicago" },
  { id: "p3", name: "The Sample Hotel", timezone: "America/New_York" },
];

describe("groupPodsByAgent", () => {
  it("groups assigned properties under their agent and trails unassigned", () => {
    const groups = groupPodsByAgent({
      properties: props,
      assignments: [
        { property_id: "p1", primary_agent_id: "a1" },
        { property_id: "p3", primary_agent_id: "a1" },
      ],
      agents: [{ id: "a1", full_name: "Dilnoza K", status: "AVAILABLE", last_seen_at: new Date().toISOString() }],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].agent?.full_name).toBe("Dilnoza K");
    expect(groups[0].properties.map((p) => p.name)).toEqual(["Rosewood Inn", "The Sample Hotel"]);
    expect(groups[1].agent).toBeNull(); // unassigned group
    expect(groups[1].properties.map((p) => p.id)).toEqual(["p2"]);
  });

  it("omits the unassigned group when every property is assigned", () => {
    const groups = groupPodsByAgent({
      properties: [props[0]],
      assignments: [{ property_id: "p1", primary_agent_id: "a1" }],
      agents: [{ id: "a1", full_name: "Dilnoza K", status: "OFFLINE", last_seen_at: null }],
    });
    expect(groups).toHaveLength(1);
  });
});

describe("cardLiveState", () => {
  it("ranks ringing above hold above on-call above quiet", () => {
    expect(cardLiveState({ ringing: true, onHold: true, onCall: true })).toBe("ringing");
    expect(cardLiveState({ ringing: false, onHold: true, onCall: true })).toBe("on-hold");
    expect(cardLiveState({ ringing: false, onHold: false, onCall: true })).toBe("on-call");
    expect(cardLiveState({ ringing: false, onHold: false, onCall: false })).toBe("quiet");
  });
});

describe("dutyLabel", () => {
  const now = Date.now();
  const fresh = new Date(now - 10_000).toISOString();
  const stale = new Date(now - PRESENCE_STALE_AFTER_MS - 1_000).toISOString();
  it("maps presence to duty labels", () => {
    expect(dutyLabel("AVAILABLE", fresh, now)).toBe("On duty");
    expect(dutyLabel("ON_CALL", fresh, now)).toBe("On call");
    expect(dutyLabel("AWAY", fresh, now)).toBe("Away");
    expect(dutyLabel("OFFLINE", fresh, now)).toBe("Off duty");
    expect(dutyLabel("AVAILABLE", stale, now)).toBe("Off duty");
  });
});
```

- [ ] **Step 2: Run — FAIL. Implement:**

```typescript
// apps/portal/lib/dashboard/pods.ts
// Pure pod/fleet helpers for the Phase-3 property-card dashboards (spec §3.1, D7).
import type { ProfileStatus } from "@lc/shared";
import { effectivePresence } from "@/lib/voice/presence";

export interface PodProperty {
  id: string;
  name: string;
  timezone: string;
}

export interface PodAgent {
  id: string;
  full_name: string;
  status: string;
  last_seen_at: string | null;
}

export interface PodGroup {
  agent: PodAgent | null; // null = unassigned trailing group
  properties: PodProperty[];
}

export function groupPodsByAgent(input: {
  properties: PodProperty[];
  assignments: Array<{ property_id: string; primary_agent_id: string }>;
  agents: PodAgent[];
}): PodGroup[] {
  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const propertyById = new Map(input.properties.map((p) => [p.id, p]));
  const byAgent = new Map<string, PodProperty[]>();
  const assigned = new Set<string>();

  for (const a of input.assignments) {
    const prop = propertyById.get(a.property_id);
    if (!prop) continue;
    assigned.add(prop.id);
    const list = byAgent.get(a.primary_agent_id) ?? [];
    list.push(prop);
    byAgent.set(a.primary_agent_id, list);
  }

  const byName = (a: PodProperty, b: PodProperty) => a.name.localeCompare(b.name);
  const groups: PodGroup[] = [...byAgent.entries()]
    .map(([agentId, properties]) => ({
      agent: agentById.get(agentId) ?? null,
      properties: properties.sort(byName),
    }))
    .sort((a, b) => (a.agent?.full_name ?? "").localeCompare(b.agent?.full_name ?? ""));

  const unassigned = input.properties.filter((p) => !assigned.has(p.id)).sort(byName);
  if (unassigned.length > 0) groups.push({ agent: null, properties: unassigned });
  return groups;
}

export type CardLiveState = "ringing" | "on-hold" | "on-call" | "quiet";

export function cardLiveState(s: { ringing: boolean; onHold: boolean; onCall: boolean }): CardLiveState {
  if (s.ringing) return "ringing";
  if (s.onHold) return "on-hold";
  if (s.onCall) return "on-call";
  return "quiet";
}

export type DutyLabel = "On duty" | "On call" | "Away" | "Off duty";

export function dutyLabel(status: string, lastSeenAt: string | null, nowMs: number): DutyLabel {
  const effective = effectivePresence(status as ProfileStatus, lastSeenAt, nowMs);
  if (effective === "AVAILABLE") return "On duty";
  if (effective === "ON_CALL") return "On call";
  if (effective === "AWAY") return "Away";
  return "Off duty";
}
```

(If `effectivePresence`'s real signature differs, adapt to it — it lives in `apps/portal/lib/voice/presence.ts`; do not re-implement staleness.)

- [ ] **Step 3: PASS + typecheck + commit** (`feat(dashboard): pod grouping, card live-state, duty-label helpers (TDD)`).

## Task 6: `CallSurfaceProvider` — one client source of truth for incoming/active call state

**Files:**
- Create: `apps/portal/components/dashboard/call-surface-provider.tsx`
- Modify: `apps/portal/components/app-shell.tsx` (wrap inside `LineStatusProvider`)
- Test: `apps/portal/tests/components/call-surface-provider.test.tsx` (jsdom)

- [ ] **Step 1: The contract.** Publishers (Softphone, video host) register imperative handles; consumers (cards, tile, second-ring banner) read one snapshot:

```tsx
// apps/portal/components/dashboard/call-surface-provider.tsx
"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / Agora machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export interface IncomingRing {
  key: string; // audio: twilio callId (or "audio"), video: calls.id
  channel: "AUDIO" | "VIDEO";
  callId: string | null;
  propertyId: string | null;
  propertyName: string;
  since: number; // client ms when the ring surfaced
}

export interface ActiveCallInfo {
  callId: string;
  channel: "AUDIO" | "VIDEO";
  propertyId: string | null;
  propertyName: string;
  onHold: boolean;
  answeredAt: number;
  /** Hotel-local timezone (audio: from the answered route) — the tile's clock face. */
  timeZone: string | null;
}

export interface CallSurfaceSnapshot {
  rings: IncomingRing[];
  active: ActiveCallInfo | null;
}

export interface CallSurfaceActions {
  /** Accept the (single) ringing audio call. Registered by Softphone. */
  acceptAudio: (() => void) | null;
  /** Accept a ringing video call by calls.id. Registered by the video host. */
  acceptVideo: ((callId: string) => void) | null;
}

interface CallSurfaceValue extends CallSurfaceSnapshot {
  actions: CallSurfaceActions;
  publishRings: (source: "audio" | "video", rings: IncomingRing[]) => void;
  publishActive: (active: ActiveCallInfo | null) => void;
  registerAcceptAudio: (fn: (() => void) | null) => void;
  registerAcceptVideo: (fn: ((callId: string) => void) | null) => void;
}

const CallSurfaceContext = createContext<CallSurfaceValue | null>(null);

export function CallSurfaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [audioRings, setAudioRings] = useState<IncomingRing[]>([]);
  const [videoRings, setVideoRings] = useState<IncomingRing[]>([]);
  const [active, setActive] = useState<ActiveCallInfo | null>(null);
  const acceptAudioRef = useRef<(() => void) | null>(null);
  const acceptVideoRef = useRef<((callId: string) => void) | null>(null);
  // Bump to re-render consumers when a handler registers/unregisters.
  const [, setHandlerVersion] = useState(0);

  const publishRings = useCallback((source: "audio" | "video", rings: IncomingRing[]) => {
    (source === "audio" ? setAudioRings : setVideoRings)(rings);
  }, []);
  const publishActive = useCallback((a: ActiveCallInfo | null) => setActive(a), []);
  const registerAcceptAudio = useCallback((fn: (() => void) | null) => {
    acceptAudioRef.current = fn;
    setHandlerVersion((v) => v + 1);
  }, []);
  const registerAcceptVideo = useCallback((fn: ((callId: string) => void) | null) => {
    acceptVideoRef.current = fn;
    setHandlerVersion((v) => v + 1);
  }, []);

  const value = useMemo<CallSurfaceValue>(
    () => ({
      rings: [...audioRings, ...videoRings],
      active,
      actions: { acceptAudio: acceptAudioRef.current, acceptVideo: acceptVideoRef.current },
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
    }),
    [audioRings, videoRings, active, publishRings, publishActive, registerAcceptAudio, registerAcceptVideo],
  );

  return <CallSurfaceContext.Provider value={value}>{children}</CallSurfaceContext.Provider>;
}

export function useCallSurface(): CallSurfaceValue {
  const ctx = useContext(CallSurfaceContext);
  if (!ctx) throw new Error("useCallSurface must be used inside CallSurfaceProvider");
  return ctx;
}

/** Safe variant for components that may render outside the shell (returns null). */
export function useCallSurfaceOptional(): CallSurfaceValue | null {
  return useContext(CallSurfaceContext);
}
```

- [ ] **Step 2: jsdom test** — a publisher child pushes a ring + registers an accept spy; a consumer child renders `rings.length` and a button wired to `actions.acceptVideo`; assert the consumer sees the ring and the click reaches the spy. Follow the render/act patterns of `tests/components/incoming-video-banner.test.tsx`.

- [ ] **Step 3:** Wrap in `app-shell.tsx`: `<LineStatusProvider><CallSurfaceProvider>…` (one line each side). Gate: typecheck + full jsdom suite. Commit (`feat(dashboard): CallSurfaceProvider context`).

## Task 7: publishers — Softphone + video host feed the provider; incoming UI extracted

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Create: `apps/portal/lib/hooks/use-incoming-video-calls.ts` (logic moved from `incoming-video-banner.tsx`)
- Modify: `apps/portal/components/video-call/video-call-host.tsx`
- Delete (UI only, after extraction): `apps/portal/components/video-call/incoming-video-banner.tsx`
- Tests: `apps/portal/tests/components/softphone.test.tsx` (extend), migrate `incoming-video-banner.test.tsx` → `tests/lib/hooks/use-incoming-video-calls.test.tsx`

- [ ] **Step 1: Softphone publishes.** Inside `Softphone`, after the existing `report(phase)` effect, add (using `useCallSurfaceOptional` so softphone tests without the provider keep passing).

**⚠ DEP-HYGIENE RULE (Task-6 review finding — the original snippet here LOOPED):** registering a handler changes the context value, so a publisher effect must NEVER depend on the whole `surface` object — depend on the **stable dispatcher functions** (they are `useCallback([])`-stable) and on stable callbacks (no fresh inline closures in `register*`).

```tsx
const surface = useCallSurfaceOptional();
const publishRings = surface?.publishRings;
const publishActive = surface?.publishActive;
const registerAcceptAudio = surface?.registerAcceptAudio;

// Publish the audio incoming ring (id comes from the new propertyId Parameter, Task 4).
useEffect(() => {
  if (!publishRings) return;
  publishRings(
    "audio",
    phase === "incoming"
      ? [{
          key: callIdRef.current ?? "audio",
          channel: "AUDIO",
          callId: callIdRef.current,
          propertyId: incomingPropertyIdRef.current,
          propertyName: incomingProperty ?? "Unknown property",
          since: incomingSinceRef.current,
        }]
      : [],
  );
}, [publishRings, phase, incomingProperty]);

// Publish active-call info while in-call.
useEffect(() => {
  if (!publishActive) return;
  publishActive(
    phase === "in-call" && callIdRef.current
      ? {
          callId: callIdRef.current,
          channel: "AUDIO",
          propertyId: incomingPropertyIdRef.current,
          propertyName: incomingProperty ?? "Unknown property",
          onHold: false, // dormant seam — hold is deferred out of Phase 3 (spec §3.6)
          answeredAt: answeredAtRef.current,
          timeZone: callTimeZone, // captured from the answered route today
        }
      : null,
  );
}, [publishActive, phase, incomingProperty, callTimeZone]);

// Expose accept to the cards — via a STABLE wrapper (acceptCall is already useCallback-stable).
const acceptAudioForCards = useCallback(() => {
  void acceptCall();
}, [acceptCall]);
useEffect(() => {
  if (!registerAcceptAudio) return;
  registerAcceptAudio(phase === "incoming" ? acceptAudioForCards : null);
  return () => registerAcceptAudio(null);
}, [registerAcceptAudio, phase, acceptAudioForCards]);
```

Supporting edits in the same file: in the `Device.on("incoming")` handler capture `incomingPropertyIdRef.current = call.customParameters.get("propertyId") ?? null` and `incomingSinceRef.current = Date.now()`; in `acceptCall` set `answeredAtRef.current = Date.now()`. Add the three refs beside the existing `callIdRef`.

- [ ] **Step 2: Retire the softphone's incoming block UI.** In the softphone card render, the `phase === "incoming"` branch (property name + Accept button block) is removed — the idle card now shows its existing ready/Accepting content in that phase (ringtone, tab-title flash, and all accept logic stay). Do NOT touch the `pendingNotes` banner or the Accepting toggle.

- [ ] **Step 3: Extract video incoming detection.** Create `use-incoming-video-calls.ts` by moving the banner's realtime-subscribe + `tick()` + 60s poll + focus-refetch code verbatim into a hook returning `{ calls }` (the `IncomingVideoCall[]` state). Keep `unlockAudioPlayback` + ringtone start/stop inside the hook (rings while `calls.length > 0` — behavior identical). The hook signature: `useIncomingVideoCalls(operatorId: string): { calls: IncomingVideoCall[] }`.

- [ ] **Step 4: Video host publishes.** Rewrite `video-call-host.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useIncomingVideoCalls } from "@/lib/hooks/use-incoming-video-calls";
import { VideoCall } from "@/components/video-call/video-call";
import { useState } from "react";
import type { IncomingVideoCall } from "@/lib/hooks/use-incoming-video-calls";

export function VideoCallHost({ operatorId }: { operatorId: string }) {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);
  const { calls } = useIncomingVideoCalls(operatorId);
  const surface = useCallSurfaceOptional();
  const publishRings = surface?.publishRings;
  const registerAcceptVideo = surface?.registerAcceptVideo;

  // ⚠ DEP-HYGIENE (Task-6 review): depend on the stable dispatchers, never on
  // `surface` — registering mutates the context value and would loop.
  useEffect(() => {
    if (!publishRings) return;
    publishRings(
      "video",
      active
        ? []
        : calls.map((c) => ({
            key: c.id,
            channel: "VIDEO" as const,
            callId: c.id,
            propertyId: c.propertyId,
            propertyName: c.propertyName,
            since: Date.parse(c.ringStartedAt ?? "") || Date.now(),
          })),
    );
  }, [publishRings, calls, active]);

  // Registered callback must be identity-stable: read `calls` through a ref.
  const callsRef = useRef(calls);
  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);
  const acceptVideoForCards = useCallback((callId: string) => {
    const call = callsRef.current.find((c) => c.id === callId);
    if (call) setActive(call);
  }, []);
  useEffect(() => {
    if (!registerAcceptVideo) return;
    registerAcceptVideo(acceptVideoForCards);
    return () => registerAcceptVideo(null);
  }, [registerAcceptVideo, acceptVideoForCards]);

  return active ? (
    <VideoCall callId={active.id} propertyName={active.propertyName} onClose={() => setActive(null)} />
  ) : (
    <></>
  );
}
```

(`IncomingVideoCall` gains `propertyId` + `ringStartedAt` — the API already returns both; widen the type where it's declared. `VideoCall` publishes its own `publishActive` in Task 17 — for now cards derive on-call from `rings` emptiness + own overlay; acceptable because the overlay covers the screen while in-call.)

- [ ] **Step 5: Migrate tests.** The banner test's realtime/poll/resubscribe specs move to the hook test (render a probe component using the hook). Extend `softphone.test.tsx`: wrap renders in `CallSurfaceProvider` and assert a card-side consumer sees the audio ring appear when the mock Device fires `incoming` (add `propertyId` to the mocked `customParameters`). **MANDATORY loop-guard test (Task-6 review):** render Softphone AND VideoCallHost together inside `CallSurfaceProvider` and drive a phase change — assert no "Maximum update depth exceeded" error and that a register spy is NOT called more than a small bounded number of times (proves the publisher effects don't churn against the context).

- [ ] **Step 6: Gate + commit** (`refactor(calls): softphone + video host publish into CallSurfaceProvider; incoming detection extracted to a hook`).

## Task 8: `PropertyCard` + agent pod grid

**Files:**
- Create: `apps/portal/components/dashboard/property-card.tsx`
- Create: `apps/portal/components/dashboard/pod-card-grid.tsx`
- Modify: `apps/portal/app/(agent)/agent/page.tsx`
- Test: `apps/portal/tests/components/property-card.test.tsx` (jsdom)

- [ ] **Step 1: The card.** Shared by agent + admin scopes. Ringing = grows + mint ring vocabulary (`ring-2 ring-live` + `lc-seam-drift` accent, the Gate-3.0/softphone language); Answer only while ringing; blaze incident chip; tonight-at-a-glance passed in from the server component.

```tsx
// apps/portal/components/dashboard/property-card.tsx
"use client";
// Phase-3 property card (spec §3.1): one card per property, both dashboards.
// Ringing expands in place; Answer claims through the EXISTING accept flows
// via CallSurfaceProvider (D1/D2). Connect lands in Phase E (Task 19).

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCallSurface } from "@/components/dashboard/call-surface-provider";
import { cardLiveState, type CardLiveState } from "@/lib/dashboard/pods";
import { formatTimeOnly } from "@/lib/owner/format";

export interface PropertyCardData {
  id: string;
  name: string;
  timezone: string;
  callsTonight: number;
  lastCallAt: string | null;
  openIncidents: number;
}

const STATE_LINE: Record<CardLiveState, string> = {
  ringing: "Ringing",
  "on-hold": "On hold",
  "on-call": "On a call",
  quiet: "Quiet",
};

export function PropertyCard({
  property,
  canAnswer = true,
  connectSlot = null,
}: {
  property: PropertyCardData;
  /** Admins: gated by covering (D11). Agents: always true. */
  canAnswer?: boolean;
  /** Phase E injects the Connect button here; null until then. */
  connectSlot?: React.ReactNode;
}): React.JSX.Element {
  const { rings, active, actions } = useCallSurface();
  const ring = rings.find((r) => r.propertyId === property.id) ?? null;
  const onCallHere = active?.propertyId === property.id;
  const state = cardLiveState({
    ringing: !!ring,
    onHold: !!active?.onHold && onCallHere,
    onCall: onCallHere,
  });

  // Elapsed ring time, ticking while ringing.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ring) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [ring]);
  const elapsed = ring ? Math.max(0, Math.floor((nowMs - ring.since) / 1_000)) : 0;

  const answer = () => {
    if (!ring) return;
    if (ring.channel === "AUDIO") actions.acceptAudio?.();
    else if (ring.callId) actions.acceptVideo?.(ring.callId);
  };

  const ringing = state === "ringing";
  return (
    <div
      data-live-state={state}
      className={`rounded-[var(--radius-card)] border bg-card p-4 shadow-sm transition-all duration-[var(--duration-standard)] ${
        ringing ? "scale-[1.02] border-live ring-2 ring-live shadow-lg" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">{property.name}</h3>
          <p className={`text-sm ${ringing ? "font-medium text-live-foreground" : "text-muted-foreground"}`}>
            {STATE_LINE[state]}
            {ringing && ring
              ? ` · ${ring.channel === "AUDIO" ? "phone" : "video"} · ${elapsed}s`
              : ""}
          </p>
        </div>
        {property.openIncidents > 0 && (
          <Badge variant="attention">
            {property.openIncidents} open incident{property.openIncidents > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {property.callsTonight} call{property.callsTonight === 1 ? "" : "s"} tonight
        {property.lastCallAt ? ` · last ${formatTimeOnly(property.lastCallAt, property.timezone)}` : ""}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {ringing && canAnswer && (
          <Button onClick={answer} className="animate-pulse">
            Answer
          </Button>
        )}
        {connectSlot}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: The grid** (`pod-card-grid.tsx`) — a thin client component: `{ properties: PropertyCardData[]; canAnswerByProperty?: Record<string, boolean>; connectFor?: (propertyId: string) => React.ReactNode }` → responsive grid (`grid gap-4 sm:grid-cols-2 xl:grid-cols-3`) of `PropertyCard`s.

- [ ] **Step 3: jsdom test** — render `CallSurfaceProvider` + a probe publisher + two `PropertyCard`s: assert (a) quiet card shows "Quiet" and no Answer; (b) publishing a video ring for `p1` makes only that card show "Ringing", elapsed seconds, and Answer; (c) clicking Answer calls the registered `acceptVideo` spy with the callId; (d) `canAnswer={false}` hides Answer while still showing the ringing treatment.

- [ ] **Step 4: Agent page.** In `app/(agent)/agent/page.tsx`: compute per-property tonight stats from the ALREADY-FETCHED agent calls (RLS = her own calls; label honesty: cards show *her* activity) + coverage properties:

```typescript
const cards: PropertyCardData[] = coverage.properties.map((p) => {
  const propCalls = calls.filter((c) => c.property_id === p.id);
  const today = propCalls.filter((c) => isToday(c.ring_started_at, p.timezone, now)); // reuse the page's existing today-window helper style (lib/dashboard/calls.ts countToday internals)
  return {
    id: p.id,
    name: p.name,
    timezone: p.timezone,
    callsTonight: today.length,
    lastCallAt: propCalls[0]?.ring_started_at ?? null,
    openIncidents: 0, // agent RLS has no incident read; admin scope fills this (Task 9)
  };
});
```

Render `<PodCardGrid properties={cards} />` as the FIRST bento card (full-width, above the stat row), titled "Your pod". Keep stats/chart/recent-calls/"your pod tonight" cards unchanged for now (the old "your pod" channel-bars card is replaced by this grid — remove that one card block).

Exact today-filter: reuse `countToday`'s semantics by exporting a `isTodayInZone(iso, timeZone, now)` helper from `lib/dashboard/calls.ts` if not already exported — add it beside `countToday` with a one-line unit test, and have `countToday` use it internally (pure refactor, no behavior change).

- [ ] **Step 5: Gate + commit** (`feat(dashboard): shared PropertyCard + agent pod grid with ring-on-card answering`).

## Task 9: admin pod-grouped fleet + retire the right-rail placements

**Files:**
- Modify: `apps/portal/app/(admin)/admin/page.tsx`
- Create: `apps/portal/components/dashboard/fleet-board.tsx`
- Modify: `apps/portal/components/dashboard-workspace.tsx`
- Delete: `apps/portal/components/dashboard/incoming-call-toast.tsx` (+ its test)
- Tests: extend `tests/components/property-card.test.tsx`; update any dashboard-workspace tests

- [ ] **Step 1: Admin fleet data.** The admin page already fetches properties, assignments, agent profiles, availability map, calls (48h), incidents count. Add a per-property open-incident count (one extra grouped query) and build:

```typescript
const groups = groupPodsByAgent({ properties, assignments, agents: assignedAgentProfiles });
// per-property tonight stats from the operator-wide calls array (same isTodayInZone filter),
// canAnswerByProperty from the admin's own availability map (covering),
// openIncidents per property from a `.from("incidents").select("property_id").eq("status","OPEN")` grouped client-side.
```

- [ ] **Step 2: `FleetBoard`** (client component): for each `PodGroup`, an agent header row — name, presence dot (`presenceDotClass(effectivePresence(...))`), `dutyLabel`, property count — then a `PodCardGrid` of that pod's cards (`canAnswerByProperty` = covering map; unassigned group header: "Unassigned"). Replace the admin page's properties ops `<Table>` card with `<FleetBoard …/>`; **move the Covering `AvailabilityToggle` onto the admin card** (pass `coveringSlot` per property rendering the existing `AvailabilityToggle` component — import and reuse as-is). Command strip, Tonight, team-on-now, recent-calls cards stay.

- [ ] **Step 3: Retire the static placements.** In `dashboard-workspace.tsx`: the `<aside>` no longer renders a visible softphone card column on home — `Softphone` and `VideoCallHost` stay MOUNTED but move to an always-`hidden` div (they are now headless engines + overlay mounts; the softphone card's remaining idle UI — line pill, Accepting toggle, pendingNotes banner — moves in Task 14 into `DutyControls`; until then keep the softphone card VISIBLE on home to not lose the toggle: concretely, this task only deletes `IncomingCallToast` usage + the persistent "Video" card wrapper around `VideoCallHost`, and drops the aside to a single softphone card). Delete `incoming-call-toast.tsx` + its test. Home grid: main column becomes full-width (`lg:grid-cols-[1fr_340px]` stays until Task 14 removes the aside entirely).

- [ ] **Step 4: Sanity in jsdom** — update workspace/dashboard tests that referenced the toast or video card; run the FULL portal suite.

- [ ] **Step 5: Gate (`typecheck`, `test`, `lint`, `check:routes`, `build`) + commit** (`feat(admin): pod-grouped fleet cards replace ops table; retire video card + off-home toast`).

## Task 10: Phase B staging + prod smoke (HUMAN)

- [ ] Push to `staging`, then: kiosk video call → agent card expands + rings + Answer opens today's overlay; audio call → same on the audio card; admin with covering ON sees Answer, OFF sees ring-only; other placements gone; second browser answering first → loser card stops ringing (claim 409 path). Then PR → `main`, repeat the two-call smoke on prod. Record results in this file.

**Staging scope note (2026-07-04):** staging receives NO Twilio webhooks (the number points at prod until Phase 5, and the staging front door has no `/api/twilio/*` basic-auth carve-out) → the **audio-card ring and the Decline-gone feel are PROD smoke items** after the merge. Staging covers: the video ring-on-card path, covering gates, toggle round-trip, and the two-browser race. Staging prep required first: the staging DB has only Staging Admin + Staging Test Hotel — provision a staging AGENT (`/admin/users`) and assign it as the hotel's primary agent (`/admin/properties` → detail) or no card will ring.

**Fix-loop item (from the Gate-3.1 drill, Kumar 2026-07-04): ring-silence control** on ringing cards — agent + admin (and the Phase-D tile later): stops the LOCAL ringer only; the card keeps ringing visually and stays answerable; resets on the next ring. Build AFTER the staging smoke passes so the deploy does not move under the test, then re-smoke just the ring beat.

**Fix-loop item 2 (staging smoke attempt 1, 2026-07-04, systematic-debugging): kiosk setup-failure catch leaks the call row.** `apps/kiosk/src/App.tsx` `onStartCall`'s catch (~line 149) tears down and shows the apology but never closes the row it already created (`callIdRef.current` is set once `startCall()` returns) → any post-create setup failure (e.g. Agora token 500) leaves a live ring under an apology screen; if someone answers it, the call sticks IN_PROGRESS (the guest can never join) and 0016's one-active-per-property index 409-blocks the property for up to 30 min (reaper IN_PROGRESS cutoff). Fix: in the catch, `if (callIdRef.current) void endCall(callIdRef.current, "failed")` — mirrors the existing terminal-connection path. Latent on prod `main` too (predates Phase 3); surfaced on staging because `AGORA_APP_CERTIFICATE` was missing there. Ship in the same fix loop as the silence control.

**Staging environment corrections applied during that debug (2026-07-04):** stuck IN_PROGRESS row finalized reaper-style via MCP (FAILED + real duration; presence self-corrected on the next heartbeat, proving the S3 inference) · **migration 0018 applied to staging via MCP** (staging was built 2026-06-21, v1.2/0018 landed 06-28 and was never back-applied → the realtime subscribe was authz-denied, so rings surfaced only via the 60s fallback poll / refetch-on-focus) · `AGORA_APP_CERTIFICATE` identified as MISSING on the Coolify staging portal env (`AGORA_APP_ID` present; token route 500s without it) — Kumar adds the env + redeploys before the retest.

---

# PHASE C — Push productionized + duty controls (D3, D5, D6, D7)

## Task 11: migration 0019 + push send module + subscription route

**Files:**
- Create: `supabase/migrations/0019_push_subscriptions.sql`
- Create: `apps/portal/lib/push/targets.ts`, `apps/portal/lib/push/send.ts`
- Create: `apps/portal/app/api/push/subscription/route.ts`
- Modify: `packages/shared/src/protocol.ts` (+`PUSH_TTL_SECONDS`)
- Tests: `tests/lib/push/targets.test.ts`, `tests/lib/push/send.test.ts`, `tests/app/push-subscription.test.ts`

- [ ] **Step 1: Migration** (0016/0018 house format):

```sql
-- 0019_push_subscriptions.sql
-- Phase 3 (spec §3.7): Web Push subscriptions, one row per browser endpoint.
-- Inserts/updates go through the session-authed route (service role); RLS
-- gives users read/delete on their own rows only.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operator_id uuid not null references public.operators(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions(user_id);
create index push_subscriptions_operator on public.push_subscriptions(operator_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE policies: writes are service-role only (route-validated).
```

Apply to staging via MCP (`cgtvqjxhbojztzumshca`), prod when Phase C merges (`ztunzdpmazwwwkxcpyfp`). Run `pnpm gen:types`, commit the regenerated file.

- [ ] **Step 2: Targets helper (TDD).** `lib/push/targets.ts` — the send-side inverse of `resolveTargetPropertyIds` (which is poll-side): given a property, who should be pushed?

```typescript
// apps/portal/lib/push/targets.ts
// Who gets a push for an incoming call at this property? Mirrors the
// incoming-video poll scope (assigned primary agent + admins covering with
// accepting_calls=true) — see resolveTargetPropertyIds in
// app/api/calls/incoming-video/route.ts. Presence NOT gated: push IS the
// wake-up path.
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export async function resolveTargetUserIds(admin: Admin, propertyId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: assigned } = await admin
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null);
  for (const r of (assigned ?? []) as Array<{ primary_agent_id: string }>) ids.add(r.primary_agent_id);

  const { data: covering } = await admin
    .from("admin_call_availability")
    .select("profile_id")
    .eq("property_id", propertyId)
    .eq("accepting_calls", true);
  for (const r of (covering ?? []) as Array<{ profile_id: string }>) ids.add(r.profile_id);

  return [...ids];
}
```

Test with the house Supabase mock-builder pattern (see `tests/lib/auth/api-actor.test.ts`): assigned agent + two covering admins → 3 deduped ids; nobody → [].

- [ ] **Step 3: Send module (TDD).** `lib/push/send.ts`:

```typescript
// apps/portal/lib/push/send.ts
// Server-side Web Push send. Fire-and-forget from route `after()` blocks —
// never throws into the caller; failures go to Sentry; 404/410 endpoints are
// pruned (expired subscriptions).
import * as Sentry from "@sentry/nextjs";
import webpush from "web-push";
import { PUSH_TTL_SECONDS } from "@lc/shared";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getVapidConfig } from "@/lib/push/vapid";
import { resolveTargetUserIds } from "@/lib/push/targets";

type Admin = ReturnType<typeof createAdminClient>;

export interface CallPushPayload {
  type: "incoming-call" | "call-cleared";
  callId: string;
  channel: "AUDIO" | "VIDEO";
  propertyId: string;
  propertyName: string;
}

export async function sendCallPush(admin: Admin, payload: CallPushPayload): Promise<void> {
  try {
    const userIds = await resolveTargetUserIds(admin, payload.propertyId);
    if (userIds.length === 0) return;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", userIds);
    if (!subs || subs.length === 0) return;

    const vapid = getVapidConfig();
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    const body = JSON.stringify(payload);

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: PUSH_TTL_SECONDS },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else {
            Sentry.captureMessage(`sendCallPush failed: ${status ?? "unknown"}`, {
              extra: { propertyId: payload.propertyId, status },
            });
          }
        }
      }),
    );
  } catch (err) {
    Sentry.captureException(err);
  }
}
```

Protocol constant (in `packages/shared/src/protocol.ts`, beside the ring window):

```typescript
/** Web Push TTL: a push older than the ring window is a stale ring — drop it. */
export const PUSH_TTL_SECONDS = RING_WINDOW_SECONDS;
```

Tests (mock `web-push` with `vi.mock`): sends to every subscription of every target user; 410 → row deleted + no Sentry; other error → Sentry message + no delete; zero targets → no web-push calls; never rejects.

- [ ] **Step 4: Subscription route.** `POST` upsert (endpoint-keyed, multiple devices per user), `DELETE` by endpoint:

```typescript
// apps/portal/app/api/push/subscription/route.ts
import { NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  };
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: actor.userId,
      operator_id: actor.operatorId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: "Could not save subscription" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("user_id", actor.userId);
  return new NextResponse(null, { status: 204 });
}
```

Route test (house pattern): 401 unauthenticated, 400 missing fields, 204 upsert with actor's user/operator ids, DELETE scoped to own user_id.

- [ ] **Step 5: Gate + commit** (`feat(push): 0019 push_subscriptions + send module + subscription route (TDD)`).

## Task 12: production SW behaviors + client subscription manager + tab ring wiring

**Files:**
- Modify: `apps/portal/public/push-sw.js` (already production-shaped; verify copy)
- Create: `apps/portal/lib/push/client.ts`
- Modify: `apps/portal/lib/hooks/use-incoming-video-calls.ts` (SW message → `tick()`)
- Test: extend `tests/lib/hooks/use-incoming-video-calls.test.tsx`

- [ ] **Step 1: `lib/push/client.ts`** — thin manager used by Go on duty + silent re-sync:

```typescript
// apps/portal/lib/push/client.ts
import { ensurePushSubscription, pushSupported, registerPushServiceWorker, serializeSubscription } from "@/lib/push/sw-registration";

/** Full arm: permission prompt allowed (call from a user gesture). */
export async function armPush(): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;
  const sub = await ensurePushSubscription(publicKey);
  if (!sub) return false;
  const res = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  }).catch(() => null);
  return !!res && res.ok;
}

/** Silent re-sync on load: no permission prompt; refreshes last_seen_at. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registerPushServiceWorker();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const keys = sub ? serializeSubscription(sub) : null;
  if (!keys) return;
  void fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(keys),
  }).catch(() => {});
}

export function pushArmed(): boolean {
  return pushSupported() && Notification.permission === "granted";
}
```

- [ ] **Step 2: SW message → the existing nudge.** In `use-incoming-video-calls.ts`, beside the realtime subscription, add:

```typescript
useEffect(() => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string };
    if (data?.source !== "lc-push") return;
    if (data.type === "incoming-call" || data.type === "call-cleared") void tick();
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}, [tick]);
```

(The push path deliberately converges on `tick()` — ring start AND stop both derive from `/api/calls/incoming-video` truth, so push/realtime/poll can never disagree. The `focus-home` message is handled separately in `dashboard-workspace.tsx` via its own tiny `useEffect` listener that calls `router.push(home)` — the hook doesn't know routes.)

- [ ] **Step 3: Also call `syncPushSubscription()`** once on mount in `dashboard-workspace.tsx` (`useEffect(() => { void syncPushSubscription(); }, [])`).

- [ ] **Step 4: Test:** in the hook test, dispatch a fake SW message event (mock `navigator.serviceWorker` with an EventTarget) → assert a refetch happened (fetch mock called again). Gate + commit (`feat(push): client subscription manager + SW-message ring wiring`).

## Task 13: send-side wiring + spike removal

**Files:**
- Modify: `apps/portal/app/api/kiosk/call-started/route.ts`, `app/api/calls/[id]/answer-video/route.ts`, `app/api/calls/[id]/end-video/route.ts`, `app/api/kiosk/call-ended/route.ts`
- Delete: `apps/portal/app/api/push-spike/route.ts`, `apps/portal/components/duty-tile/push-spike-panel.tsx` (+ its mount line)
- Tests: extend the four routes' existing tests

- [ ] **Step 1: call-started** — the ring moment. The route needs `property.name` (extend its property select to `"id, operator_id, active, name"`), then inside the existing `after()`:

```typescript
after(() => {
  void broadcastCallsChanged(property.operator_id);
  void sendCallPush(admin, {
    type: "incoming-call",
    callId: inserted.id,
    channel: "VIDEO",
    propertyId: property.id,
    propertyName: property.name,
  });
});
```

- [ ] **Step 2: the three cleared moments** (answer-video, end-video, call-ended): same pattern with `type: "call-cleared"` (each route already has the call row / property id in scope; fetch `properties.name` only if not already selected — a `call-cleared` push may send `propertyName: ""`, the SW doesn't render it).

- [ ] **Step 3: Tests:** mock `@/lib/push/send`; assert `sendCallPush` called with `incoming-call` on call-started and `call-cleared` on the other three; assert a `sendCallPush` rejection does NOT fail the route (it can't — the module never rejects — but keep the mock honest by resolving).

- [ ] **Step 4: Remove the spike** route + panel + mount line. Audio path: NOT wired (Twilio's own ring is layer C — record this in the commit body).

- [ ] **Step 5: Gate + commit** (`feat(push): send on kiosk ring + clear on answer/end; remove Gate-3.1 spike surface`).

## Task 14: Go on duty + duty controls card

**Files:**
- Create: `apps/portal/components/dashboard/duty-controls.tsx`
- Modify: `apps/portal/components/dashboard-workspace.tsx`, `apps/portal/components/softphone/softphone.tsx`
- Test: `apps/portal/tests/components/duty-controls.test.tsx`

- [ ] **Step 1: `DutyControls`** — the dashboard card that replaces the softphone card's visible chrome (D5): shows the line pill (`useLineStatus`), the Accepting/AWAY toggle + pendingNotes banner (MOVED from the softphone card render — the softphone becomes fully headless: its card render returns only the overlay + hidden engine; move the JSX blocks, do not rewrite their logic — lift the needed state via props from `Softphone` published through `CallSurfaceProvider`… simplest correct mechanics: `Softphone` keeps rendering the pendingNotes banner + toggle itself but inside `DutyControls`' card slot via a `renderDutyChrome` children-function prop passed down from `dashboard-workspace.tsx`; pick whichever keeps `softphone.test.tsx` green with minimal churn and record the choice in the commit). Plus the **Go on duty** button:

```tsx
const [armed, setArmed] = useState(false);
useEffect(() => setArmed(pushArmed()), []);
// Visible while un-armed; quiet (small "On duty · push armed" line) once armed.
<Button
  onClick={async () => {
    primeRingAudio();            // the Gate-3.0 play/pause priming, exported from a tiny lib/video/prime.ts wrapper reused by softphone + video hook
    const ok = await armPush();  // permission prompt inside this gesture
    setArmed(ok && pushArmed());
  }}
>
  Go on duty
</Button>
```

`primeRingAudio` = extract the existing priming snippet (softphone/banner use the same pattern) into `lib/video/prime.ts` with one export, reused everywhere it currently appears (pure move).

- [ ] **Step 2:** Mount `<DutyControls />` at the top of the home aside (agent + admin); the aside now contains DutyControls + the hidden engines. Push-denied browsers: the button shows a muted "Notifications blocked — rings still work in this tab" line after a failed arm (degradation честno per spec §3.2).

- [ ] **Step 3: jsdom test:** un-armed shows the button; clicking primes + arms (mock `armPush` true) → quiet state; failed arm shows the blocked line.

- [ ] **Step 4: Gate + commit** (`feat(duty): Go on duty — audio prime + push arm; duty card replaces softphone chrome`).

## Task 15: End shift (D6) + fleet duty labels (D7)

**Files:**
- Create: `apps/portal/app/api/presence/end-shift/route.ts`
- Modify: `apps/portal/components/softphone/softphone.tsx` (heartbeat arm/disarm)
- Modify: `apps/portal/components/dashboard/duty-controls.tsx` (button)
- Modify: `apps/portal/components/dashboard/fleet-board.tsx` (labels already via `dutyLabel` — verify)
- Tests: `tests/app/presence-end-shift.test.ts`, extend softphone test

- [ ] **Step 1: Route** — session-authed, service-role write (0012 guard pattern: presence writes must be service-role):

```typescript
// apps/portal/app/api/presence/end-shift/route.ts
import { NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .eq("id", actor.userId);
  if (error) return NextResponse.json({ error: "Could not end shift" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
```

Route test: 401/403 gates; 204 writes OFFLINE for the actor id. NOT audited (presence writes aren't — D6 note).

- [ ] **Step 2: Client semantics.** In `Softphone`, add an `onDuty` ref/state (default true). The 20s heartbeat effect early-returns while `!onDuty` (otherwise the next beat would flip her straight back to AVAILABLE). Expose `endShift()` + `resumeDuty()` through the provider (add `registerDutyHandlers` to `CallSurfaceProvider`, same pattern as accept registration): `endShift` = disabled while `phase === "in-call" || phase === "incoming"` → sets `onDuty=false` + `POST /api/presence/end-shift`; `resumeDuty` = `onDuty=true` + immediate heartbeat post. **Go on duty** (Task 14) also calls `resumeDuty()`.

- [ ] **Step 3: Button** in `DutyControls` ("End shift", `variant="neutral"`, confirm-free, disabled mid-call with a tooltip "Finish the call first"). After ending: card shows "Off duty — Go on duty to resume".

- [ ] **Step 4: Tests:** softphone test — after `endShift`, advancing timers past 20s posts NO presence beat; `resumeDuty` posts one immediately. Route test per Step 1.

- [ ] **Step 5: Gate + commit** (`feat(duty): End shift — immediate OFFLINE + heartbeat disarm; fleet duty labels live`).

Then Phase-C staging + prod smoke (HUMAN, record here): fresh browser → Go on duty → OS permission → kiosk call with browser minimized behind fullscreen RustDesk → **loud ring + OS toast** → toast click focuses home → answer from card. End shift → admin fleet shows Off duty immediately. `git push staging`, then PR to `main`, re-smoke on prod, **apply migration 0019 to prod before the PR merges**.

---

# PHASE D — the call tile (D4, D2)

## Task 16: call-tile manager — synchronous open inside the Answer gesture

**Files:**
- Create: `apps/portal/lib/duty-tile/call-tile-manager.tsx`
- Modify: `apps/portal/components/dashboard/property-card.tsx` (open tile in Answer click)
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx` (tile state: `tileOpen`, `openTile`, `closeTile`, `tileMount`)
- Test: `apps/portal/tests/components/call-tile-manager.test.tsx`

- [ ] **Step 1: Manager.** Reuses `preparePipDocument` verbatim; the DocPiP call MUST run synchronously in the click before any `await` (Gate-3.0 constraint, spec §8.4):

```tsx
// apps/portal/lib/duty-tile/call-tile-manager.tsx
"use client";
// Call-scoped Document-PiP tile (spec §3.3). requestWindow() must be invoked
// synchronously inside the user gesture — callers do: openCallTile() FIRST,
// then run their async accept flow. The tile is additive: every failure path
// leaves the call proceeding normally in the tab.
import { preparePipDocument } from "@/lib/duty-tile/pip-document";

const TILE_WIDTH = 380;
const TILE_HEIGHT = 300;

export interface CallTileHandle {
  mount: HTMLElement;
  close: () => void;
  window: Window;
}

export function docPipSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

/**
 * Open the PiP window synchronously-enough for the gesture: requestWindow is
 * called before this function returns control to awaiting code. onClosed fires
 * on user-close (the "reopen tile" affordance keys off it).
 */
export function openCallTile(onReady: (h: CallTileHandle) => void, onClosed: () => void): void {
  const docPip = window.documentPictureInPicture;
  if (!docPip) return;
  void docPip
    .requestWindow({ width: TILE_WIDTH, height: TILE_HEIGHT })
    .then((pip) => {
      const mount = preparePipDocument(pip.document);
      pip.addEventListener("pagehide", onClosed);
      onReady({ mount, window: pip, close: () => pip.close() });
    })
    .catch(() => {
      /* no tile — call continues in the tab */
    });
}
```

- [ ] **Step 2: Provider additions:** `tileMount: HTMLElement | null`, `tileRequested: boolean`, `openTileForCall()` (calls `openCallTile`, stores handle/mount, sets `tileRequested`), `closeTile()` (closes + clears), `tileClosedByUser: boolean` (set by `onClosed` while a call is active — drives the overlay's "Reopen tile" affordance; reopen = another user gesture → `openTileForCall()` again).

- [ ] **Step 3: Wire the gesture:** in `PropertyCard`'s `answer()` — FIRST `openTileForCall()`, THEN dispatch accept (both audio + video paths). Tile auto-closes when `active` transitions to null (hang-up) — a provider effect calls `closeTile()`.

- [ ] **Step 4: jsdom test:** mock `window.documentPictureInPicture.requestWindow` resolving a fake window (`document.implementation.createHTMLDocument`); assert Answer click calls `requestWindow` before the accept fetch resolves (spy order), `pagehide` sets the reopen flag, hang-up (publishActive(null)) closes the pip window.

- [ ] **Step 5: Gate + commit** (`feat(tile): call-scoped DocPiP manager, opened inside the Answer gesture`).

## Task 17: tile faces + overlay integration (guest-video-first)

**Files:**
- Create: `apps/portal/components/call-tile/call-tile.tsx`
- Modify: `apps/portal/components/video-call/video-call.tsx` (publish remote video track + active info + reopen affordance — ADDITIVE ONLY)
- Modify: `apps/portal/components/softphone/softphone.tsx` (register control handlers into provider: mute/hangup/911 already exist — expose)
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx` + `video-call.tsx` ("Reopen tile" button when `tileClosedByUser`)
- Test: `apps/portal/tests/components/call-tile.test.tsx`

- [ ] **Step 1: Track sharing without disturbing Agora:** `VideoCall` grabs the remote video `MediaStreamTrack` in its existing `user-published` handler (`user.videoTrack?.getMediaStreamTrack()` — same API family the captions use for audio) and publishes it via a new provider field `publishGuestVideoTrack(track | null)` (cleared on user-left/teardown). The tile renders its OWN `<video>` from `new MediaStream([track])` — Agora's overlay element is never re-parented:

```tsx
function GuestVideo({ track }: { track: MediaStreamTrack }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} muted playsInline className="h-full w-full rounded-md object-cover" />;
}
```

(Tile video is `muted` — call AUDIO keeps playing from the main tab exactly as today; no double-audio.)

- [ ] **Step 2: `CallTile`** — rendered by the provider into `tileMount` via `createPortal` (Gate-3.0 pattern). VIDEO face: `GuestVideo` filling the tile + compact bar (timer from `active.answeredAt` · mute · hang up · **911 two-tap arm/confirm** (5s arm window; NO Radix dialog in the PiP document) · room#/note input with ⏎-save reusing the provider-exposed `saveNotesNow` · Connect placeholder slot for Phase E). AUDIO face: property name + hotel-local time (the softphone's `callTimeZone`, published in `active`) + timer + same bar. All handlers come from provider registrations (`registerCallControls({ toggleMute, hangUp, triggerEmergency, saveNote })` — Softphone registers audio's, VideoCall registers video's; additive `useEffect` blocks in each, no logic changes).

- [ ] **Step 3: Reopen affordance:** in both overlays, when `tileClosedByUser && docPipSupported()`, render a small `variant="neutral"` button "Reopen tile" (calls `openTileForCall()`; a real click = valid gesture). Placement: beside the overlay's existing header controls (top area, non-destructive spot).

- [ ] **Step 4: jsdom tests:** tile renders audio face fields; video face mounts a `<video>` with a MediaStream from the published track; mute button calls the registered spy; 911 requires two taps (first shows "Confirm 911", second fires); second tap after 5s reverts to armed-off.

- [ ] **Step 5: Full gate incl. `build` + commit** (`feat(tile): guest-video-first call tile faces + reopen affordance; overlay changes additive`).

Phase-D staging/prod smoke (HUMAN): answer video from card → tile opens with guest video over fullscreen RustDesk → mute/hang-up from tile → tile dies at hang-up; close tile mid-call → overlay offers Reopen; non-Chromium (Safari) → no tile, call normal. Record here.

---

# PHASE E — remote access + Connect everywhere (D10, D11, D12)

## Task 18: migration 0020 + admin CRUD + audit actions

**Files:**
- Create: `supabase/migrations/0020_property_remote_access.sql`
- Modify: `apps/portal/lib/audit/actions.ts`
- Create: `apps/portal/lib/remote-access/validate.ts` + admin server actions in `app/(admin)/admin/properties/actions.ts`
- Create: `apps/portal/app/(admin)/admin/properties/[id]/remote-access-card.tsx`
- Tests: `tests/lib/remote-access/validate.test.ts`, server-action tests per house pattern

- [ ] **Step 1: Migration** — **RLS enabled with NO client policies at all** (service-role only, spec §3.5):

```sql
-- 0020_property_remote_access.sql
-- Phase 3 (spec §3.5): RustDesk unattended-access credentials per property.
-- Deliberately NO RLS policies: with RLS enabled and zero policies, no client
-- role can read or write anything — every access goes through service-role
-- code paths (admin server actions + the audited credential API).

create table public.property_remote_access (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  operator_id uuid not null references public.operators(id),
  peer_id text not null,
  unattended_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.property_remote_access enable row level security;
```

`pnpm gen:types` + commit generated file. Apply staging now, prod at phase merge.

- [ ] **Step 2: Audit actions** — add to `AUDIT_ACTIONS`: `REMOTE_ACCESS_UPDATED: "remote_access.updated"`, `REMOTE_ACCESS_ROTATED: "remote_access.rotated"`, `REMOTE_ACCESS_CREDENTIALS_ISSUED: "remote_access.credentials_issued"`.

- [ ] **Step 3: Validation helper (TDD)** `lib/remote-access/validate.ts`: `validatePeerId` (RustDesk ids: digits/word chars, 6–24 — trim + `/^[\w-]{6,24}$/`), `validateUnattendedPassword` (8–128 chars, no leading/trailing whitespace). Tests first.

- [ ] **Step 4: Server actions** (in the properties actions file, `requireRole("ADMIN")` + service client + `logAuditEvent`): `upsertRemoteAccessAction(propertyId, peerId, password)` — validates, upserts on `property_id`, audits `REMOTE_ACCESS_UPDATED` (details: `{ peer_id }` — NEVER the password) or `REMOTE_ACCESS_ROTATED` when only the password changed; `deleteRemoteAccessAction(propertyId)` audited as `REMOTE_ACCESS_UPDATED` with `{ removed: true }`.

- [ ] **Step 5: Admin card** on property detail: peer-id input + password input (`PasswordInput` component exists) + Save / Rotate password + "Credentials last issued" line (query `audit_logs` for the latest `remote_access.credentials_issued` on this entity — 2-query house pattern) + `updated_at`. Credentials are WRITE-ONLY in this UI: the password field never renders the stored value (placeholder "•••• saved").

- [ ] **Step 6: Gate + commit** (`feat(remote-access): 0020 credentials table (service-role only) + admin CRUD, audited`).

## Task 19: credential API + Connect client + card/in-call surfaces (D12)

**Files:**
- Create: `apps/portal/app/api/remote-access/[propertyId]/route.ts`
- Create: `apps/portal/lib/remote-access/connect.ts`
- Modify: `property-card.tsx` (fill `connectSlot`), `audio-call-overlay.tsx`, `video-call.tsx`, `components/call-tile/call-tile.tsx` (Connect button)
- Modify: `call-surface-provider.tsx` (pre-warm cache)
- Tests: `tests/app/remote-access-route.test.ts`, `tests/lib/remote-access/connect.test.ts`

- [ ] **Step 1: Route** — operator-scoped, audited issuance:

```typescript
// apps/portal/app/api/remote-access/[propertyId]/route.ts
import { NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const { propertyId } = await params;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("property_remote_access")
    .select("peer_id, unattended_password, operator_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  // Operator scoping (the v2 per-property tightening rides the existing seam).
  if (!row || row.operator_id !== actor.operatorId) {
    return NextResponse.json({ error: "No remote access configured" }, { status: 404 });
  }
  await logAuditEvent({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.REMOTE_ACCESS_CREDENTIALS_ISSUED,
    entityType: "property",
    entityId: propertyId,
    details: { peer_id: row.peer_id },
  });
  return NextResponse.json({ peerId: row.peer_id, password: row.unattended_password });
}
```

Route tests: 401/403; 404 wrong operator or unconfigured; 200 + audit row written (assert `logAuditEvent` mock called with `credentials_issued`).

- [ ] **Step 2: Client** `lib/remote-access/connect.ts` (TDD the pure part):

```typescript
export function buildRustdeskUrl(peerId: string, password: string): string {
  return `rustdesk://connection/new/${encodeURIComponent(peerId)}?password=${encodeURIComponent(password)}`;
}

export async function fetchRemoteCredentials(propertyId: string): Promise<{ peerId: string; password: string } | null> {
  const res = await fetch(`/api/remote-access/${propertyId}`).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as { peerId: string; password: string };
}

/** Launch the native client. location.assign on a custom scheme never unloads the page. */
export function launchRustdesk(creds: { peerId: string; password: string }): void {
  window.location.assign(buildRustdeskUrl(creds.peerId, creds.password));
}
```

Tests: URL encoding (peer with spaces/`?`/unicode password), 404 → null.

- [ ] **Step 3: Pre-warm (D10):** provider gains `prewarm: Map<string, {peerId,password}>` — in the Answer dispatch (after accept fires), `void fetchRemoteCredentials(propertyId).then(cache)`. `connectToProperty(propertyId)` = cache hit → `launchRustdesk` sync; miss → fetch then launch; failure → small inline error state ("No remote access configured — ask an admin").

- [ ] **Step 4: Surfaces:** `connectSlot` on every property card (`Button variant="neutral"` "Connect" — NEVER gated, admins + agents, quiet + ringing + on-call alike); a Connect button in `audio-call-overlay.tsx` controls row, `video-call.tsx` control bar, and the tile bar — all calling `connectToProperty(active.propertyId)`. Overlay/`video-call` changes are these buttons only (D2/D12 discipline — state in the diff review).

- [ ] **Step 5: Gate + commit** (`feat(remote-access): audited credential API + Connect from card, overlays, and tile (D12) with pre-warm`).

## Task 20: Phase E smoke + pilot provisioning (HUMAN)

- [ ] Apply 0020 to prod at merge; Kumar enters the pilot hotel PC's peer id + unattended password via the new admin card (moves it out of the PM vault as the runtime source of truth; PM keeps a backup copy). Smoke on prod: Connect from the card (Mac, RustDesk installed) → session opens with no password prompt; answer a kiosk call → Connect from the overlay AND from the tile mid-call; audit log shows `credentials_issued` rows; agent role sees Connect but no admin CRUD. Record results.

---

# PHASE F — DEFERRED: hold (all of it) is out of Phase 3

**Plan-gate edit (Kumar, 2026-07-04): "lets simplify things here and push it to when we have more than one property."** The full choreography that was planned here (hold-<callId> conference mirroring 6c, agent leg `endConferenceOnExit=true`, dial-result guest routing, participant `hold=true`, 911-after-hold guest-first REST redirect, byte-review discipline) is **recorded in spec §3.6** as the design of record for the multi-property moment — likely riding Phase 4/LiveKit so audio + video hold land together. Consequences absorbed into the tasks above: no migration 0021; no hold controls anywhere; the `on-hold` state name in `cardLiveState`/`ActiveCallInfo` stays as a dormant seam nothing sets; the video overlay's existing greyed "Hold — coming soon" button stays as-is. With hold gone, **nothing in Phase 3 touches dial-result or the 911 route** — the only voice-path change is Task 4's additive TwiML Parameter.

## Task 21: Phase-3 close-out (HUMAN + docs)

- [ ] **Retire the prototype:** delete `app/duty-tile-prototype/` + `components/duty-tile/duty-tile-prototype.tsx` + `tile-window.tsx` + the Gate-3.0 test route surface (keep `pip-document.ts` — the call tile imports it; keep `tick-stats.ts` + its test only if something still imports it, else delete) + prod route gone. Full suite green after deletion.
- [ ] **Done-when checklist (migration plan Phase 3, hold line removed):** answer on expanded card (agent + covering admin) ✓ · one-click Connect from card AND from inside a live call ✓ · admin-connect to a non-covered property ✓ · loud ring with browser minimized behind fullscreen RustDesk (push) + toast observed ✓ · tile opens on Answer and carries the call over RustDesk ✓.
- [ ] **Docs sync:** stamp the migration plan Phase-3 STATUS + done-when (hold moved to the deferred list); CLAUDE.md current-focus; `MEMORY.md` + `memory/project-status.md`; tag `plan-phase3-workspace-complete` after Kumar's final nod.
- [ ] **Whole-branch review:** opus-tier subagent over the full Phase-3 diff (house pattern) before the final PR.

---

## Verification note

Voice/video/push only fully work on deployed environments (Twilio/kiosk point at prod; box staging for Gate 3.1's 360s case). Dev-server-under-sandbox is a known hazard (`memory/dev-server-sandbox-hazard.md`) — per-task gates are typecheck + tests + build; live verification happens at the phase-end staging/prod smokes listed above. `pnpm gen:types` needs local `supabase start` + CLI 2.101.0.

## Execution

Subagent-driven (house pattern): fresh subagent per task, per-task spec + quality review, the BYTE-REVIEW step (Task 4) uses a dedicated reviewer subagent with the voice-path context, opus whole-branch review at the end. Human gates: Task 3 (Gate 3.1 drill), Task 10, Phase-C smoke, Phase-D smoke, Task 20, Task 21 (close-out).
