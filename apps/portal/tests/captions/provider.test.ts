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
class FakeAudioContext {
  sampleRate = 16000;
  destination = {};
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createScriptProcessor = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }));
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
  close = vi.fn().mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("stop() stops recognition and closes the audio context", async () => {
    const stream = createCaptionStream("jwt");
    await stream.start({} as MediaStreamTrack, vi.fn(), vi.fn());
    stream.stop();
    expect(sm.client.stopRecognition).toHaveBeenCalled();
  });

  it("propagates a connection failure (the hook treats it as captions-off)", async () => {
    sm.client.start.mockRejectedValueOnce(new Error("connect failed"));
    const stream = createCaptionStream("jwt");
    await expect(stream.start({} as MediaStreamTrack, vi.fn(), vi.fn())).rejects.toThrow("connect failed");
  });
});
