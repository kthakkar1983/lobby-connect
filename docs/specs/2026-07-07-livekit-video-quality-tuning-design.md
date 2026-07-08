# LiveKit video-quality tuning — design

**Date:** 2026-07-07 · **Status:** APPROVED (Kumar's gate, 2026-07-07) · **Type:** pre-cutover spike (migration plan Phase 5, step 5 — "video-quality tuning spike"). Code-light, security-neutral, zero DB.

## Why

The Phase-4 LiveKit swap left video-publish parameters at the SDK defaults. On the 2026-07-06 staging call, `chrome://webrtc-internals` showed a **healthy** pipeline — 3-layer simulcast (720/360/180), receiver on the full 720p layer, UDP via srflx (no TCP fallback, no relay) — so the perceived softness is **not** a transport problem. It is the defaults:

- Both adapters call `new Room()` and `createLocalVideoTrack()` with **zero options** ([`apps/portal/lib/video/livekit-session.ts`](../../apps/portal/lib/video/livekit-session.ts) L70/L100; [`apps/kiosk/src/lib/video/livekit.ts`](../../apps/kiosk/src/lib/video/livekit.ts) L53/L102).
- Default publish = **VP8 software encode** at the `h720` preset's default bitrate (**1.7 Mbps**, source: livekit-client 2.20.0 `VideoPresets.h720`), and that budget is **split three ways** across the 720/360/180 simulcast layers. On a large rendered stage the top layer is bitrate-starved → soft.

This is a 1:1 call (exactly one subscriber), and the constrained path is the **India ↔ NYC3** leg (the ~95%-India agent workforce; the pilot kiosk is on a US hotel connection). The done-when for Phase 4 — "real-night video quality ≥ Agora at $0 marginal cost" — gates on this tuning.

## Decision (locked)

Tune for **sharpness with long-haul resilience**, symmetric across both adapters:

| Knob | Default (today) | Tuned (round 1) | Rationale |
|---|---|---|---|
| `videoCodec` | vp8 (software) | **h264** | Hardware encode on the kiosk tablet + agent machine; attacks the software-VP8 softness at *lower* CPU |
| Primary-layer `maxBitrate` | ~1.7 Mbps | **2,500,000 bps** | The main sharpness lever — feed the top layer |
| Primary-layer `maxFramerate` | 30 | 30 | Unchanged |
| Capture resolution | SDK default (1080 non-Safari) | **1280×720** (on `createLocalVideoTrack`) | Deterministic 720p; the camera/publish reality observed on staging |
| Simulcast layers | 3 (720/360/180) | **2 (720 + 360)** — `videoSimulcastLayers: [h360]` | One fallback rung for the long-haul; drops the wasted 180 so the encoder splits its budget two ways, not three |
| `degradationPreference` | balanced (default) | **maintain-resolution** | Check-in is low-motion but detail-critical (faces, IDs) — shed framerate under stress, keep sharpness |
| `adaptiveStream` / `dynacast` | defaults | **unchanged** | Isolate the codec+bitrate+layers effect this round |

Good-link upstream ≈ 2.5M (720) + 0.45M (360) ≈ **~3 Mbps**, degrading to the 360 rung when the India leg chokes.

**Rejected:** 1080p capture + 3 Mbps (fragile over India↔US — can adaptive-downscale to *worse* than a clean 720p); killing simulcast entirely (trades all long-haul resilience for peak sharpness — a bad bet on a lossy leg). Both remain round-2 levers if evidence invites them.

## Architecture

One shared source of the numbers so the two adapters can never drift, and a pure, unit-testable builder:

- **`packages/shared/src/video.ts`** (new) — `LIVEKIT_VIDEO_TUNING` plain-data constant (all knobs above) + pure `buildLiveKitVideoOptions(VideoPreset)` returning `{ roomOptions, captureOptions }`. `VideoPreset` is **dependency-injected** (passed in) so `@lc/shared` keeps its zero-runtime-dependency contract — it never imports `livekit-client` (mirrors `protocol.ts`). Re-exported from the package index.
  - `roomOptions.publishDefaults` = `{ videoCodec, videoEncoding: { maxBitrate, maxFramerate }, simulcast: true, videoSimulcastLayers: [ new VideoPreset(640, 360, 450_000, 20) ], degradationPreference: "maintain-resolution" }`.
  - `roomOptions.videoCaptureDefaults` + `captureOptions` both = `{ resolution: { width: 1280, height: 720 } }` (belt-and-suspenders: `createLocalVideoTrack` ignores the room's capture defaults, so the resolution must also be passed to it directly; setting the room default too covers any future `setCameraEnabled` path).

- **Both adapters** — add `VideoPreset` to the existing dynamic `import("livekit-client")` destructure, call the builder once, then:
  - `new Room(roomOptions)` instead of `new Room()`.
  - `createLocalVideoTrack(captureOptions)` instead of `createLocalVideoTrack()`.
  - `publishTrack(video)` is unchanged — `LocalParticipant.publishTrack` already merges `room.options.publishDefaults`, so the codec/bitrate/simulcast/degradation settings apply without touching the publish call.
  - **Nothing else moves.** Mic-first ordering, independent device acquisition (portal's audio-only fallback), captions tap, teardown, connection-state mapping — all untouched.

### Interfaces / boundaries

- `buildLiveKitVideoOptions(VideoPreset)` — *does:* maps the tuning constant to LiveKit `RoomOptions` + capture options. *Used by:* both adapters. *Depends on:* the injected `VideoPreset` ctor only.
- The constant is the single knob-board; retuning is a one-line edit reflected in both apps and covered by one test.

## Testing

- **New unit test** (`packages/shared`) for `buildLiveKitVideoOptions` with a stub `VideoPreset`: asserts `videoCodec === "h264"`, `videoEncoding.maxBitrate === 2_500_000`, `maxFramerate === 30`, exactly **one** `videoSimulcastLayers` entry at 640×360, `degradationPreference === "maintain-resolution"`, and `captureOptions.resolution === { width: 1280, height: 720 }`.
- **Both adapter test mocks** need a `VideoPreset` class stub added to their `vi.mock("livekit-client", …)` (the adapters now destructure it — without the stub the dynamic import yields `undefined` and `new VideoPreset()` throws). Optionally assert `Room`/`createLocalVideoTrack` received the built options. Existing assertions are unaffected (the mock factory ignores constructor args today).
- Full portal + kiosk + shared suites, typecheck, lint, `check:routes`, both builds stay green.

## Acceptance (live — Kumar runs it; the sandbox can't place a video call)

Deploy to staging → place a video call → read `chrome://webrtc-internals`:

1. Sender **outbound-rtp**: `codec` = H264; **2** encodings present (simulcast held under H.264); top encoding ~2.5 Mbps and 1280×720; `encoderImplementation` = a hardware name (not `libvpx` / `OpenH264`); `qpSum/framesEncoded` (QP) trending lower than the default-config call.
2. Receiver **inbound-rtp**: 720p, H264, no excess `freezeCount`/`totalFreezesDuration`.
3. Subjective: sharper than the default-LiveKit call, no new stutter.

Then iterate the numbers from evidence. The **real** gate is Phase-5 night-1 (Dilnoza's deliberate India→NYC3 test calls) — staging only proves the config produces the intended H.264 / bitrate / layer shape.

## Risk pre-flagged

**H.264 simulcast may collapse to a single layer** in some Chrome/Edge builds (hardware H.264 encoders don't always emit spatial layers). If webrtc-internals shows only 1 outbound encoding, decide at that point — **(a)** accept single-layer H.264 (`simulcast: false`, richer single stream, no in-codec fallback) or **(b)** revert the codec to VP8 for a reliable 2-layer simulcast. This is a measured branch, not a pre-commitment; the shared constant makes either a one-line change.

## Blue-green / standby safety

Zero DB, zero migration, zero route change — pure client-side video-publish config on the LiveKit-only trunk. The frozen Vercel/Agora standby is untouched; additive-only invariants and `agora_channel_name` are irrelevant here. Ships whenever; lands ahead of the Phase-5 cutover window.
