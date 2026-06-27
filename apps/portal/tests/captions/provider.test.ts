import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Speechmatics realtime client (intercepts the dynamic import too).
const sm = vi.hoisted(() => {
  let messageHandler: ((e: { data: unknown }) => void) | null = null;
  const client = {
    addEventListener: vi.fn((event: string, cb: (e: { data: unknown }) => void) => {
      if (event === "receiveMessage") messageHandler = cb;
    }),
    start: vi.fn().mockResolvedValue(undefined),
    sendAudio: vi.fn(),
    stopRecognition: vi.fn(),
  };
  return {
    client,
    RealtimeClient: vi.fn(() => client),
    emit: (data: unknown) => messageHandler?.({ data }),
  };
});
vi.mock("@speechmatics/real-time-client", () => ({ RealtimeClient: sm.RealtimeClient }));

// Web Audio + MediaStream do not exist in the node test env — stub the minimum.
const audioCtxClose = vi.fn().mockResolvedValue(undefined);
const audioCtxArgs: Array<{ sampleRate?: number } | undefined> = [];
// Shared across instances so a test can assert the buffer size the provider requests.
const scriptProcessorSpy = vi.fn((_bufferSize?: number, _inCh?: number, _outCh?: number) => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onaudioprocess: null,
}));
class FakeAudioContext {
  sampleRate: number;
  constructor(opts?: { sampleRate?: number }) {
    audioCtxArgs.push(opts);
    // Emulate a browser honoring the requested rate; native (no opts) is 48k.
    this.sampleRate = opts?.sampleRate ?? 48000;
  }
  destination = {};
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createScriptProcessor = scriptProcessorSpy;
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
  close = audioCtxClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  audioCtxArgs.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaStream", vi.fn());
});

import { createCaptionStream } from "@/lib/captions/provider";

describe("createCaptionStream", () => {
  it("starts the client with the token + partials enabled and routes transcripts", async () => {
    const onPartial = vi.fn();
    const onFinal = vi.fn();
    const stream = createCaptionStream("jwt-123");
    await stream.start({} as MediaStreamTrack, onPartial, onFinal);

    expect(sm.RealtimeClient).toHaveBeenCalled();
    expect(sm.client.start).toHaveBeenCalledWith(
      "jwt-123",
      expect.objectContaining({
        transcription_config: expect.objectContaining({ enable_partials: true }),
      }),
    );

    sm.emit({ message: "AddPartialTranscript", metadata: { transcript: "hel" } });
    expect(onPartial).toHaveBeenCalledWith("hel");

    sm.emit({ message: "AddTranscript", metadata: { transcript: "Hello." } });
    expect(onFinal).toHaveBeenCalledWith("Hello.");

    // Empty / non-transcript messages are dropped (no spurious callbacks).
    sm.emit({ message: "EndOfTranscript" });
    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it("captures at 16 kHz (cuts uplink bandwidth) and tightens the final-transcript delay", async () => {
    const stream = createCaptionStream("jwt");
    await stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());

    // Requests a 16 kHz context so the browser resamples once at the source —
    // speech STT gains nothing above 16 kHz and the native 48 kHz tripled the
    // upstream bandwidth competing with the live Agora/Twilio media.
    expect(audioCtxArgs[0]).toEqual({ sampleRate: 16000 });
    expect(sm.client.start).toHaveBeenCalledWith(
      "jwt",
      expect.objectContaining({
        audio_format: expect.objectContaining({ sample_rate: 16000 }),
        transcription_config: expect.objectContaining({
          operating_point: "enhanced",
          max_delay: expect.any(Number),
        }),
      }),
    );
    // The speedup must not sacrifice accent robustness.
    const cfg = sm.client.start.mock.calls[0]?.[1]?.transcription_config;
    expect(cfg?.max_delay).toBeLessThan(4);
  });

  it("sends audio in small chunks so captions appear sooner", async () => {
    const stream = createCaptionStream("jwt");
    await stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());
    // A small ScriptProcessor buffer = a short capture cadence. At 16 kHz the
    // old 4096-sample buffer spanned ~256ms before any audio was sent; a
    // 1024-sample buffer is ~64ms, trimming local latency before the engine.
    const bufferSize = scriptProcessorSpy.mock.calls[0]?.[0];
    expect(bufferSize).toBeLessThanOrEqual(2048);
  });

  it("falls back to a native-rate context if the browser rejects the requested rate", async () => {
    // Some browsers throw on an unsupported explicit sampleRate — captions must
    // still start (sending whatever rate the native context reports).
    vi.stubGlobal(
      "AudioContext",
      class extends FakeAudioContext {
        constructor(opts?: { sampleRate?: number }) {
          if (opts?.sampleRate) throw new Error("unsupported sampleRate");
          super(undefined);
        }
      },
    );
    const stream = createCaptionStream("jwt");
    await stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());
    expect(sm.client.start).toHaveBeenCalledWith(
      "jwt",
      expect.objectContaining({ audio_format: expect.objectContaining({ sample_rate: 48000 }) }),
    );
  });

  it("stop() stops recognition and closes the audio context", async () => {
    const stream = createCaptionStream("jwt");
    await stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());
    stream.stop();
    expect(sm.client.stopRecognition).toHaveBeenCalled();
    expect(audioCtxClose).toHaveBeenCalled();
  });

  it("stop() during a pending start() resolves cleanly and never wires audio", async () => {
    // stop() lands synchronously, before the dynamic import of the SDK resolves;
    // start() must short-circuit, resolve cleanly, and never wire audio.
    const stream = createCaptionStream("jwt");
    const p = stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());
    stream.stop();           // stop arrives while start() is still pending
    await expect(p).resolves.toBeUndefined();
    expect(sm.client.sendAudio).not.toHaveBeenCalled();
  });

  it("propagates a connection failure (the hook treats it as captions-off)", async () => {
    sm.client.start.mockRejectedValueOnce(new Error("connect failed"));
    const stream = createCaptionStream("jwt");
    await expect(stream.start({} as MediaStreamTrack, vi.fn(), vi.fn())).rejects.toThrow("connect failed");
  });
});
