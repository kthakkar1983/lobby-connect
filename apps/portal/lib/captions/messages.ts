/**
 * Parse a Speechmatics realtime `receiveMessage` payload into a caption update.
 * Source-confirmed shape (docs.speechmatics.com/rt-api-ref):
 *   message: "AddPartialTranscript" (interim) | "AddTranscript" (final)
 *   metadata.transcript: the complete formatted transcript string.
 */
export type CaptionUpdate =
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "ignore" };

interface TranscriptMessage {
  message?: string;
  metadata?: { transcript?: string };
}

export function parseTranscriptMessage(data: unknown): CaptionUpdate {
  if (typeof data !== "object" || data === null) return { kind: "ignore" };
  const msg = data as TranscriptMessage;
  const text = (msg.metadata?.transcript ?? "").trim();
  if (msg.message === "AddPartialTranscript") return { kind: "partial", text };
  if (msg.message === "AddTranscript") return { kind: "final", text };
  return { kind: "ignore" };
}
