import { parseTranscriptMessage } from "@/lib/captions/messages";

/**
 * The caption adapter — the ONLY place the STT vendor appears. Swapping
 * providers means a new implementation of this file; nothing else changes.
 *
 * Speechmatics realtime, browser-direct via a short-lived JWT (minted by
 * /api/captions/token). Audio: tap the guest's remote MediaStreamTrack for raw
 * 16-bit PCM via the Web Audio API and stream it with client.sendAudio().
 *
 * SDK details verified against @speechmatics/real-time-client@8.5.0 types:
 *   - US endpoint via the `url` constructor option (default is EU).
 *   - sendAudio accepts the Int16Array directly (it is an ArrayBufferView).
 *   - Echo fallback: if the live smoke shows the guest audio double-playing, route the sink to audioCtx.createMediaStreamDestination() instead of audioCtx.destination (a throwaway MediaStream sink that still pulls the ScriptProcessor but never reaches the speakers).
 *   - start(jwt, { audio_format, transcription_config }); receiveMessage gives { data }.
 *
 * NOTE: ScriptProcessorNode is deprecated but universally supported and dead
 * simple. Upgrading to an AudioWorklet is a future seam (no interface change).
 */
export interface CaptionStream {
  start(
    track: MediaStreamTrack,
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
  ): Promise<void>;
  stop(): void;
}

// US realtime region (verified Task 0; default endpoint is EU).
const SPEECHMATICS_RT_URL = "wss://us.rt.speechmatics.com/v2";

export function createCaptionStream(token: string): CaptionStream {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let client: any = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let stopped = false;

  function cleanup() {
    stopped = true;
    try { if (processor) processor.onaudioprocess = null; } catch { /* ignore */ }
    try { processor?.disconnect(); } catch { /* ignore */ }
    try { source?.disconnect(); } catch { /* ignore */ }
    try { sink?.disconnect(); } catch { /* ignore */ }
    try { void audioCtx?.close(); } catch { /* ignore */ }
    try { client?.stopRecognition?.({ noTimeout: true }); } catch { /* ignore */ }
    client = null;
    audioCtx = null;
    source = null;
    processor = null;
    sink = null;
  }

  return {
    async start(track, onPartial, onFinal) {
      const { RealtimeClient } = await import("@speechmatics/real-time-client");
      if (stopped) return;
      client = new RealtimeClient({ url: SPEECHMATICS_RT_URL });

      client.addEventListener("receiveMessage", ({ data }: { data: unknown }) => {
        const update = parseTranscriptMessage(data);
        // drop ignore + empty-text (silence boundaries) regardless of kind
        if (update.kind === "ignore" || !update.text) return;
        (update.kind === "partial" ? onPartial : onFinal)(update.text);
      });

      // Build the audio graph BEFORE start() so we know the sample rate, but
      // connect it AFTER start() resolves so no audio is sent pre-session.
      audioCtx = new AudioContext();
      const sample_rate = audioCtx.sampleRate;
      source = audioCtx.createMediaStreamSource(new MediaStream([track]));
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      // Zero-gain sink: the processor must reach a destination to run, but the
      // guest audio is already played by Agora/Twilio — gain 0 prevents echo.
      sink = audioCtx.createGain();
      sink.gain.value = 0;

      try {
        await client.start(token, {
          audio_format: { type: "raw", encoding: "pcm_s16le", sample_rate },
          transcription_config: {
            language: "en",
            enable_partials: true,
            operating_point: "enhanced", // accent-robust; the whole point
          },
        });
      } catch (err) {
        cleanup();
        throw err;
      }
      if (stopped) {
        cleanup();
        return;
      }

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (stopped || !client) return;
        client.sendAudio(floatTo16BitPCM(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(audioCtx.destination);
    },
    stop() {
      cleanup();
    },
  };
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
