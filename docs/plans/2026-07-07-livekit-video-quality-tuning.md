# LiveKit video-quality tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LiveKit default video-publish params (VP8 software encode, ~1.7 Mbps split three ways) with tuned values (H.264 hardware encode, 2.5 Mbps top layer, 2-layer simulcast, maintain-resolution, deterministic 720p capture), sourced from one shared constant applied identically in both adapters.

**Architecture:** A dependency-free tuning constant + pure builder in `@lc/shared` (`VideoPreset` dependency-injected so the package never imports `livekit-client`). Each adapter destructures `VideoPreset` from its existing dynamic `import("livekit-client")`, calls the builder once, and passes `roomOptions` to `new Room(...)` and `captureOptions` to `createLocalVideoTrack(...)`. Nothing else in the adapters moves. Zero DB / route / migration change — blue-green safe.

**Tech Stack:** TypeScript, livekit-client 2.20.0, Vitest, pnpm workspace (`@lc/shared`, `@lc/portal`, `@lc/kiosk`).

**Spec:** `docs/specs/2026-07-07-livekit-video-quality-tuning-design.md`

---

## File Structure

- **Create** `packages/shared/src/video.ts` — `LIVEKIT_VIDEO_TUNING` constant + pure `buildLiveKitVideoOptions(VideoPreset)`. One responsibility: the single source of video-publish tuning.
- **Modify** `packages/shared/src/index.ts` — re-export `./video`.
- **Create** `packages/shared/tests/video.test.ts` — builder unit tests (stub `VideoPreset`).
- **Modify** `apps/portal/lib/video/livekit-session.ts` — destructure `VideoPreset`, build options, pass them to `new Room` + `createLocalVideoTrack`.
- **Modify** `apps/portal/tests/lib/video/livekit-session.test.ts` — add `VideoPreset` stub to the `livekit-client` mock; expose the `Room` ctor spy; assert the tuned options flow.
- **Modify** `apps/kiosk/src/lib/video/livekit.ts` — same adapter change as portal.
- **Modify** `apps/kiosk/tests/lib/video/livekit.test.ts` — same mock change as portal.

Only these two test files mock `livekit-client` directly and execute the adapter; every other video test mocks the adapter *module* and is unaffected.

---

## Task 1: Shared tuning constant + builder

**Files:**
- Create: `packages/shared/src/video.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/video.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/video.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLiveKitVideoOptions, LIVEKIT_VIDEO_TUNING } from "../src/video";

// Minimal stand-in for livekit-client's VideoPreset (records ctor args).
class StubVideoPreset {
  constructor(
    public width: number,
    public height: number,
    public maxBitrate: number,
    public maxFramerate: number,
  ) {}
}

describe("buildLiveKitVideoOptions", () => {
  it("produces H.264 publish defaults at the tuned bitrate", () => {
    const { roomOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    expect(roomOptions.publishDefaults.videoCodec).toBe("h264");
    expect(roomOptions.publishDefaults.videoEncoding).toEqual({
      maxBitrate: 2_500_000,
      maxFramerate: 30,
    });
    expect(roomOptions.publishDefaults.degradationPreference).toBe("maintain-resolution");
    expect(roomOptions.publishDefaults.simulcast).toBe(true);
  });

  it("emits exactly one lower simulcast layer (2 total) at h360", () => {
    const { roomOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    const layers = roomOptions.publishDefaults.videoSimulcastLayers as StubVideoPreset[];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      width: 640,
      height: 360,
      maxBitrate: 450_000,
      maxFramerate: 20,
    });
  });

  it("pins 720p capture on both the room defaults and the standalone track options", () => {
    const { roomOptions, captureOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    expect(captureOptions.resolution).toEqual({ width: 1280, height: 720 });
    expect(roomOptions.videoCaptureDefaults.resolution).toEqual({ width: 1280, height: 720 });
  });

  it("keeps the tuning constant as the single retune point", () => {
    expect(LIVEKIT_VIDEO_TUNING.videoCodec).toBe("h264");
    expect(LIVEKIT_VIDEO_TUNING.primary.maxBitrate).toBe(2_500_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @lc/shared exec vitest run tests/video.test.ts`
Expected: FAIL — `Failed to resolve import "../src/video"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/video.ts`:

```ts
// LiveKit video-publish tuning (spec: docs/specs/2026-07-07-livekit-video-quality-tuning-design.md).
// The SINGLE source of the tunables so the portal + kiosk adapters can never
// drift. Round-1 spike values — retune here; both apps and the one test follow.
//
// @lc/shared stays dependency-free (mirrors protocol.ts): the livekit-client
// VideoPreset class is dependency-INJECTED by each adapter, never imported here.

/** Round-1 tuning knobs. See the spec's decision table for rationale. */
export const LIVEKIT_VIDEO_TUNING = {
  videoCodec: "h264",
  /** Primary (top) simulcast layer — the sharpness lever. */
  primary: { width: 1280, height: 720, maxBitrate: 2_500_000, maxFramerate: 30 },
  /** The single lower fallback rung (2 total layers) — standard h360. */
  lower: { width: 640, height: 360, maxBitrate: 450_000, maxFramerate: 20 },
  degradationPreference: "maintain-resolution",
} as const;

/** Ctor shape of livekit-client's VideoPreset, injected to keep this package livekit-free. */
type VideoPresetCtor<T> = new (
  width: number,
  height: number,
  maxBitrate: number,
  maxFramerate: number,
) => T;

export interface LiveKitVideoOptions<TPreset> {
  roomOptions: {
    videoCaptureDefaults: { resolution: { width: number; height: number } };
    publishDefaults: {
      videoCodec: "h264";
      videoEncoding: { maxBitrate: number; maxFramerate: number };
      simulcast: true;
      videoSimulcastLayers: TPreset[];
      degradationPreference: "maintain-resolution";
    };
  };
  captureOptions: { resolution: { width: number; height: number } };
}

/**
 * Build the LiveKit Room + capture options from the shared tuning constant.
 * `VideoPreset` is the livekit-client class (injected). Both adapters call this,
 * pass `roomOptions` to `new Room(...)`, and `captureOptions` to
 * `createLocalVideoTrack(...)`. Capture resolution is set BOTH on the room
 * defaults and returned as standalone `captureOptions` because
 * `createLocalVideoTrack` does not read the room's `videoCaptureDefaults`.
 */
export function buildLiveKitVideoOptions<TPreset>(
  VideoPreset: VideoPresetCtor<TPreset>,
): LiveKitVideoOptions<TPreset> {
  const { primary, lower, videoCodec, degradationPreference } = LIVEKIT_VIDEO_TUNING;
  const resolution = { width: primary.width, height: primary.height };
  return {
    roomOptions: {
      videoCaptureDefaults: { resolution },
      publishDefaults: {
        videoCodec,
        videoEncoding: { maxBitrate: primary.maxBitrate, maxFramerate: primary.maxFramerate },
        simulcast: true,
        videoSimulcastLayers: [
          new VideoPreset(lower.width, lower.height, lower.maxBitrate, lower.maxFramerate),
        ],
        degradationPreference,
      },
    },
    captureOptions: { resolution },
  };
}
```

Then add to `packages/shared/src/index.ts` (append after the existing `export * from "./protocol";` line):

```ts
export * from "./video";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @lc/shared exec vitest run tests/video.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm -F @lc/shared typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/video.ts packages/shared/src/index.ts packages/shared/tests/video.test.ts
git commit -m "feat(video): shared LiveKit video-tuning constant + builder"
```

---

## Task 2: Portal adapter — wire tuned options

**Files:**
- Modify: `apps/portal/lib/video/livekit-session.ts` (imports + lines 67-70, 100)
- Test: `apps/portal/tests/lib/video/livekit-session.test.ts`

- [ ] **Step 1: Update the test mock + add the integration assertions (the failing test)**

In `apps/portal/tests/lib/video/livekit-session.test.ts`:

(a) Inside the `vi.hoisted(() => { ... })` block, expose a `Room` ctor spy and a `VideoPreset` stub. Change the returned object so it includes them. Replace the `room` const's return usage by adding these two just before the `return { ... }` at the end of the hoisted block:

```ts
  const RoomCtor = vi.fn(function () {
    return room;
  });
  class VideoPreset {
    constructor(
      public width: number,
      public height: number,
      public maxBitrate: number,
      public maxFramerate: number,
    ) {}
  }
```

and add `RoomCtor,` and `VideoPreset,` to the object literal returned by `vi.hoisted`.

(b) Update the `vi.mock("livekit-client", ...)` factory to use the exposed ctor + stub:

```ts
vi.mock("livekit-client", () => ({
  Room: lk.RoomCtor,
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  VideoPreset: lk.VideoPreset,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));
```

(c) Add a test that asserts the tuned options flow (place it inside the existing `describe("joinLiveKitCall", ...)` block):

```ts
  it("applies the shared H.264 tuning to the room + capture", async () => {
    await joinLiveKitCall({ url: "u", token: "t", ...callbacks() });
    expect(lk.RoomCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        publishDefaults: expect.objectContaining({ videoCodec: "h264" }),
      }),
    );
    expect(lk.createLocalVideoTrack).toHaveBeenCalledWith({
      resolution: { width: 1280, height: 720 },
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @lc/portal exec vitest run tests/lib/video/livekit-session.test.ts`
Expected: FAIL — `RoomCtor` was called with `undefined` (adapter still calls `new Room()`), and `createLocalVideoTrack` called with `undefined`.

- [ ] **Step 3: Wire the adapter**

In `apps/portal/lib/video/livekit-session.ts`:

(a) Add the shared import near the top (after the existing `import type { RemoteTrack } from "livekit-client";`):

```ts
import { buildLiveKitVideoOptions } from "@lc/shared";
```

(b) Add `VideoPreset` to the dynamic-import destructure and build the options. Replace:

```ts
  const { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const room = new Room();
```

with:

```ts
  const { Room, RoomEvent, Track, VideoPreset, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const { roomOptions, captureOptions } = buildLiveKitVideoOptions(VideoPreset);
  const room = new Room(roomOptions);
```

(c) Pass the capture options to the camera acquisition. Replace:

```ts
    video = await createLocalVideoTrack();
```

with:

```ts
    video = await createLocalVideoTrack(captureOptions);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @lc/portal exec vitest run tests/lib/video/livekit-session.test.ts`
Expected: PASS (all prior tests + the new one).

- [ ] **Step 5: Typecheck the portal**

Run: `pnpm -F @lc/portal typecheck`
Expected: no errors. (If `new Room(roomOptions)` reports a structural mismatch, add a type-only `import type { RoomOptions } from "livekit-client";` and change the line to `const room = new Room(roomOptions as RoomOptions);` — the builder's shape is intentionally a subset of `RoomOptions`.)

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/video/livekit-session.ts apps/portal/tests/lib/video/livekit-session.test.ts
git commit -m "feat(video): apply LiveKit tuning in the portal adapter"
```

---

## Task 3: Kiosk adapter — wire tuned options

**Files:**
- Modify: `apps/kiosk/src/lib/video/livekit.ts` (imports + lines 50-53, 102)
- Test: `apps/kiosk/tests/lib/video/livekit.test.ts`

- [ ] **Step 1: Update the test mock + add the integration assertions (the failing test)**

In `apps/kiosk/tests/lib/video/livekit.test.ts`:

(a) Inside the `vi.hoisted(() => { ... })` block, add a `Room` ctor spy and a `VideoPreset` stub just before its `return { ... }`:

```ts
  const RoomCtor = vi.fn(function () {
    return room;
  });
  class VideoPreset {
    constructor(
      public width: number,
      public height: number,
      public maxBitrate: number,
      public maxFramerate: number,
    ) {}
  }
```

and add `RoomCtor,` and `VideoPreset,` to the object literal it returns.

(b) Update the `vi.mock("livekit-client", ...)` factory:

```ts
vi.mock("livekit-client", () => ({
  Room: lk.RoomCtor,
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  DisconnectReason: lk.DisconnectReason,
  VideoPreset: lk.VideoPreset,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));
```

(c) Add a test asserting the tuned options flow (inside the existing `describe(...)` for `joinLiveKit`, matching how the neighbouring tests invoke it — `const cb = callbacks(); await joinLiveKit({ url: "wss://x", token: "t", ...cb });`):

```ts
  it("applies the shared H.264 tuning to the room + capture", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    expect(lk.RoomCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        publishDefaults: expect.objectContaining({ videoCodec: "h264" }),
      }),
    );
    expect(lk.createLocalVideoTrack).toHaveBeenCalledWith({
      resolution: { width: 1280, height: 720 },
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @lc/kiosk exec vitest run tests/lib/video/livekit.test.ts`
Expected: FAIL — `RoomCtor`/`createLocalVideoTrack` called with `undefined`.

- [ ] **Step 3: Wire the adapter**

In `apps/kiosk/src/lib/video/livekit.ts`:

(a) Add the shared import near the top (after the existing type imports):

```ts
import { buildLiveKitVideoOptions } from "@lc/shared";
```

(b) Add `VideoPreset` to the dynamic-import destructure and build the options. Replace:

```ts
  const { Room, RoomEvent, Track, DisconnectReason, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const room = new Room();
```

with:

```ts
  const { Room, RoomEvent, Track, DisconnectReason, VideoPreset, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const { roomOptions, captureOptions } = buildLiveKitVideoOptions(VideoPreset);
  const room = new Room(roomOptions);
```

(c) Pass the capture options to the camera acquisition. Replace:

```ts
  const localVideo = await createLocalVideoTrack();
```

with:

```ts
  const localVideo = await createLocalVideoTrack(captureOptions);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @lc/kiosk exec vitest run tests/lib/video/livekit.test.ts`
Expected: PASS (all prior tests + the new one).

- [ ] **Step 5: Typecheck the kiosk**

Run: `pnpm -F @lc/kiosk typecheck`
Expected: no errors. (Same `as RoomOptions` fallback available as in Task 2 Step 5 if needed.)

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/lib/video/livekit.ts apps/kiosk/tests/lib/video/livekit.test.ts
git commit -m "feat(video): apply LiveKit tuning in the kiosk adapter"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm test`
Expected: all portal + kiosk + shared tests PASS (prior green count + 6 new tests: 4 shared, 1 portal, 1 kiosk).

- [ ] **Step 2: Typecheck + lint + route guard**

Run: `pnpm typecheck && pnpm lint && pnpm check:routes`
Expected: all pass, no errors.

- [ ] **Step 3: Build both apps**

Run: `pnpm -F @lc/portal build && pnpm -F @lc/kiosk build`
Expected: both builds succeed. (The portal build honors the env-gated `output:"standalone"`; a plain build is sufficient here.)

- [ ] **Step 4: Final commit (if any lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(video): verification pass — suites, typecheck, lint, builds green" || echo "nothing to commit"
```

---

## After the plan (not a code task — noted for the operator)

The automated suite proves the *shape* (H.264 / 2.5 Mbps / 2 layers / 720p flow through both adapters). The **quality** is proven live, per the spec's acceptance section: deploy the branch to staging, place a video call, read `chrome://webrtc-internals` (codec = H264, 2 outbound encodings, ~2.5 Mbps top layer, hardware `encoderImplementation`, QP trending down), then iterate the numbers in `LIVEKIT_VIDEO_TUNING`. If H.264 simulcast collapses to one encoding, take the spec's measured branch (single-layer H.264 `simulcast:false`, or revert `videoCodec` to `"vp8"`). Real gate = Phase-5 night-1 India→NYC3 calls. Do NOT merge to `main` yet — this ships in the Phase-5 window (blue-green: merging deploys nothing while Vercel is frozen).
```
