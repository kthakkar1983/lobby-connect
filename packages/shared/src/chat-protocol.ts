export const CHAT_PROTOCOL_VERSION = 1;
export const TYPING_THROTTLE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;

export type ChatMsg = { v: number; type: "msg"; id: string; text: string; ts: number };
export type ChatTyping = { v: number; type: "typing"; state: "start" | "stop"; ts: number };
export type ChatEnvelope = ChatMsg | ChatTyping;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function newMessageId(): string {
  return crypto.randomUUID();
}

export function encodeChat(env: ChatEnvelope): Uint8Array {
  return enc.encode(JSON.stringify(env));
}

/** Tolerant decode: unknown/malformed payloads return null and are ignored. */
export function decodeChat(bytes: Uint8Array): ChatEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.v !== "number" || typeof o.ts !== "number") return null;
  if (o.type === "msg" && typeof o.id === "string" && typeof o.text === "string") {
    return { v: o.v, type: "msg", id: o.id, text: o.text, ts: o.ts };
  }
  if (o.type === "typing" && (o.state === "start" || o.state === "stop")) {
    return { v: o.v, type: "typing", state: o.state, ts: o.ts };
  }
  return null;
}

export function shouldSendTyping(lastSentMs: number | null, nowMs: number): boolean {
  return lastSentMs === null || nowMs - lastSentMs >= TYPING_THROTTLE_MS;
}

export function typingExpired(lastReceivedMs: number, nowMs: number): boolean {
  return nowMs - lastReceivedMs >= TYPING_TIMEOUT_MS;
}
