# In-Call Kiosk⇄Agent Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ephemeral, bidirectional text chat between the kiosk (guest) and the agent during video calls, for the speech-failure exception path — with no storage, client-side PCI card-number redaction, an animated typing indicator, and an agent-side chime.

**Architecture:** Chat rides the existing LiveKit call room via data channels (`publishData`/`DataReceived`). Pure protocol + redaction helpers live in `@lc/shared`. The portal mirrors the live-captions pattern exactly — a non-memoized relay on `CallSurfaceProvider`, `sendChat` as a registered call-control, and one `ChatDock` reused by the tile and the overlay; `video-call.tsx` owns the actual publish/subscribe. The kiosk keeps chat in local `App.tsx` state plumbed into `Connected`/`CallControls`. Nothing persists; no migration, no RLS change.

**Tech Stack:** TypeScript, `livekit-client`, Next.js (portal), Vite/React (kiosk), Vitest + Testing Library, Tailwind + CSS custom properties.

**Spec:** `docs/specs/2026-07-13-in-call-kiosk-agent-chat-design.md` (decision log D1–D12).

**Discipline:** TDD throughout. **Byte-review** any task touching a live-call path (marked `[BYTE-REVIEW]`). Tasks touching the guest video/audio experience need a **staging smoke** (marked `[SMOKE]`). Follow the captions feature as the reference implementation — file:line pointers are given per task.

---

## File structure

**Shared (`packages/shared/`)**
- `src/chat-redact.ts` — `redactCardNumbers` + `luhnValid` (pure). Test: `tests/chat-redact.test.ts`.
- `src/chat-protocol.ts` — envelope types, `encodeChat`/`decodeChat`, `newMessageId`, typing throttle/expiry predicates (pure). Test: `tests/chat-protocol.test.ts`.
- `src/index.ts` — re-export both.

**Portal (`apps/portal/`)**
- `app/api/video/token/route.ts` — add `canPublishData` to the grant.
- `lib/video/livekit-session.ts` — extend `LiveKitCallSession` with `sendData`/`onData`.
- `components/dashboard/call-surface-provider.tsx` — chat relay + `sendChat`/typing on `RegisteredCallControls`.
- `components/video-call/video-call.tsx` — owns publish/subscribe; overlay Playbook⇄Chat tab. `[BYTE-REVIEW][SMOKE]`
- `components/call/chat-dock.tsx` (new) — thread + input + typing bubble. Test: `tests/components/chat-dock.test.tsx`.
- `components/call/typing-indicator.tsx` (new) — pure-CSS animated dots.
- `components/call-tile/call-tile.tsx` — Video⇄Chat toggle + badge + chime. `[BYTE-REVIEW]`
- `public/sounds/chat-message.mp3` — bundled asset.

**Kiosk (`apps/kiosk/`)**
- `src/lib/video/livekit.ts` + `src/lib/video/types.ts` — extend `KioskVideoSession` with `sendData`/`onData`.
- `src/App.tsx` — chat state + plumbing + auto-open. `[BYTE-REVIEW][SMOKE]`
- `src/screens/Connected.tsx` + `src/screens/CallControls.tsx` — Type button + Option A split + chat column. `[SMOKE]`
- `src/components/TypingIndicator.tsx` (new) — mirror of the portal dots.

---

## Phase A — Shared pure core (no UI, no LiveKit)

### Task 1: Card-number redactor

**Files:**
- Create: `packages/shared/src/chat-redact.ts`
- Test: `packages/shared/tests/chat-redact.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/chat-redact.test.ts
import { describe, it, expect } from "vitest";
import { redactCardNumbers, luhnValid } from "../src/chat-redact";

describe("luhnValid", () => {
  it("accepts a valid PAN and rejects a mistyped one", () => {
    expect(luhnValid("4111111111111111")).toBe(true);   // Visa test
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("redactCardNumbers", () => {
  const MASK = "•••• (card number hidden)";

  it("masks card numbers (with and without separators)", () => {
    expect(redactCardNumbers("my card is 4111111111111111")).toBe(`my card is ${MASK}`);
    expect(redactCardNumbers("4111 1111 1111 1111")).toBe(MASK);
    expect(redactCardNumbers("4111-1111-1111-1111")).toBe(MASK);
    expect(redactCardNumbers("378282246310005 amex")).toBe(`${MASK} amex`); // 15-digit Amex
  });

  it("leaves normal front-desk input untouched", () => {
    for (const s of [
      "1425 Oak Street, Apt 3",   // house number
      "ZIP 94103",                // ZIP-5
      "94103-1425",               // ZIP+4
      "call me at 415 555 1234",  // phone
      "room 237",                 // room
      "reservation 8825519",      // conf number
      "checkout is 07/13/2026",   // date
    ]) {
      expect(redactCardNumbers(s)).toBe(s);
    }
  });

  it("does not mask a 16-digit run that fails Luhn", () => {
    expect(redactCardNumbers("1234 5678 9012 3456")).toBe("1234 5678 9012 3456");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm -F @lc/shared test chat-redact`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/chat-redact.ts

const MASK = "•••• (card number hidden)";

/** Luhn (mod-10) checksum over a pure-digit string. */
export function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const c = digits.charCodeAt(i) - 48; // '0' === 48
    if (c < 0 || c > 9) return false;
    let d = c;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Mask card-number-like runs from user-typed chat text BEFORE it is published.
 * A run of digits (optionally separated by single spaces/hyphens) is masked iff,
 * after stripping separators, it is 13–19 digits AND passes Luhn. The length
 * floor keeps addresses, ZIPs, phones, room and confirmation numbers untouched;
 * Luhn adds specificity. Prefix (IIN) is intentionally NOT required so no real
 * card slips through an incomplete issuer table.
 */
export function redactCardNumbers(text: string): string {
  // A digit, then 11+ chars of [digit|space|hyphen], ending on a digit → 13+ chars.
  return text.replace(/\d[\d -]{11,}\d/g, (run) => {
    const digits = run.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return MASK;
    return run;
  });
}
```

- [ ] **Step 4: Export**

In `packages/shared/src/index.ts` add:
```ts
export { redactCardNumbers, luhnValid } from "./chat-redact";
```

- [ ] **Step 5: Run and confirm pass**

Run: `pnpm -F @lc/shared test chat-redact`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/chat-redact.ts packages/shared/tests/chat-redact.test.ts packages/shared/src/index.ts
git commit -m "feat(chat): shared card-number redactor (length + Luhn)"
```

---

### Task 2: Chat wire protocol + typing predicates

**Files:**
- Create: `packages/shared/src/chat-protocol.ts`
- Test: `packages/shared/tests/chat-protocol.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/chat-protocol.test.ts
import { describe, it, expect } from "vitest";
import {
  encodeChat, decodeChat, newMessageId,
  shouldSendTyping, typingExpired,
  CHAT_PROTOCOL_VERSION, TYPING_THROTTLE_MS, TYPING_TIMEOUT_MS,
} from "../src/chat-protocol";

describe("encode/decode", () => {
  it("round-trips a message", () => {
    const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: "a", text: "hi", ts: 5 };
    expect(decodeChat(encodeChat(env))).toEqual(env);
  });
  it("round-trips a typing signal", () => {
    const env = { v: CHAT_PROTOCOL_VERSION, type: "typing" as const, state: "start" as const, ts: 5 };
    expect(decodeChat(encodeChat(env))).toEqual(env);
  });
  it("tolerantly rejects junk and unknown types", () => {
    expect(decodeChat(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeChat(new TextEncoder().encode(JSON.stringify({ v: 1, type: "wat", ts: 1 })))).toBeNull();
    expect(decodeChat(new TextEncoder().encode(JSON.stringify({ v: 1, type: "msg", ts: 1 })))).toBeNull(); // no text/id
  });
  it("ignores unknown extra fields (forward-compat)", () => {
    const wire = JSON.stringify({ v: 2, type: "msg", id: "a", text: "hi", ts: 5, lang: "es" });
    expect(decodeChat(new TextEncoder().encode(wire))).toEqual({ v: 2, type: "msg", id: "a", text: "hi", ts: 5 });
  });
});

describe("typing predicates", () => {
  it("throttles sends", () => {
    expect(shouldSendTyping(null, 0)).toBe(true);
    expect(shouldSendTyping(0, TYPING_THROTTLE_MS - 1)).toBe(false);
    expect(shouldSendTyping(0, TYPING_THROTTLE_MS)).toBe(true);
  });
  it("expires stale typing", () => {
    expect(typingExpired(0, TYPING_TIMEOUT_MS - 1)).toBe(false);
    expect(typingExpired(0, TYPING_TIMEOUT_MS)).toBe(true);
  });
});

describe("newMessageId", () => {
  it("returns distinct ids", () => {
    expect(newMessageId()).not.toBe(newMessageId());
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm -F @lc/shared test chat-protocol`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/chat-protocol.ts

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
```

- [ ] **Step 4: Export**

In `packages/shared/src/index.ts` add:
```ts
export * from "./chat-protocol";
```

- [ ] **Step 5: Run and confirm pass**

Run: `pnpm -F @lc/shared test chat-protocol`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/chat-protocol.ts packages/shared/tests/chat-protocol.test.ts packages/shared/src/index.ts
git commit -m "feat(chat): shared wire protocol + typing predicates"
```

---

## Phase B — Transport wiring

### Task 3: Grant `canPublishData` on the video token

**Files:**
- Modify: `apps/portal/app/api/video/token/route.ts` (grant, ~line 29)
- Test: `apps/portal/tests/app/video-token.test.ts` (extend if present; else add a focused test)

- [ ] **Step 1: Find the grant.** Read `app/api/video/token/route.ts`; the grant is `at.addGrant({ roomJoin: true, room: channel, canPublish: true, canSubscribe: true })`.

- [ ] **Step 2: Add `canPublishData: true`.**

```ts
at.addGrant({
  roomJoin: true,
  room: channel,
  canPublish: true,
  canPublishData: true, // chat data channel (in-call kiosk<->agent chat)
  canSubscribe: true,
});
```

- [ ] **Step 3: Test.** If a token-route test exists, add an assertion that the decoded grant includes `canPublishData: true`. If not, add a minimal test that constructs the route’s token and asserts the claim. Run: `pnpm -F @lc/portal test video-token`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/api/video/token/route.ts apps/portal/tests/app/video-token.test.ts
git commit -m "feat(chat): grant canPublishData on video token"
```

---

### Task 4: Extend the portal LiveKit session with data send/receive `[BYTE-REVIEW]`

**Files:**
- Modify: `apps/portal/lib/video/livekit-session.ts`

Reference the shape at `livekit-session.ts:12-18` (`LiveKitCallSession`) and `:65-129` (`joinLiveKitCall`, where `room` is in scope).

- [ ] **Step 1: Extend the interface.**

```ts
export interface LiveKitCallSession {
  localVideo: PortalVideoHandle | null;
  localAudioMediaTrack: MediaStreamTrack | null;
  mediaWarning: "camera" | "mic" | "both" | null;
  setMicMuted(muted: boolean): Promise<void>;
  sendData(bytes: Uint8Array, reliable: boolean): void; // chat
  leave(): Promise<void>;
}
```

- [ ] **Step 2: Add an `onData` callback** to `LiveKitCallCallbacks` (near `:27-34`):

```ts
onData?(bytes: Uint8Array, fromIdentity: string): void;
```

- [ ] **Step 3: Wire inside `joinLiveKitCall`** (where `room` exists). Subscribe to data and expose send:

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  callbacks.onData?.(payload, participant?.identity ?? "");
});
// in the returned session object:
sendData: (bytes, reliable) =>
  void room.localParticipant.publishData(bytes, { reliable }),
```
Ensure `RoomEvent` is already imported (it is — used for `TrackSubscribed`).

- [ ] **Step 4: Typecheck + existing tests.**

Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test livekit`
Expected: PASS (no behavior change to media path).

- [ ] **Step 5: Commit** (byte-review the diff first — media path untouched, additive only).

```bash
git add apps/portal/lib/video/livekit-session.ts
git commit -m "feat(chat): portal LiveKit session sendData/onData seam"
```

---

### Task 5: Extend the kiosk LiveKit session with data send/receive `[BYTE-REVIEW]`

**Files:**
- Modify: `apps/kiosk/src/lib/video/types.ts` (`KioskVideoSession` ~`:21-25`, `JoinCallbacks` ~`:27-32`)
- Modify: `apps/kiosk/src/lib/video/livekit.ts` (`joinLiveKit` ~`:48-123`, `room` in scope ~`:55`)

- [ ] **Step 1: Extend types.**

```ts
// types.ts
export interface KioskVideoSession {
  localVideo: VideoTrackHandle | null;
  localAudioTrack: MediaStreamTrack | null;
  sendData(bytes: Uint8Array, reliable: boolean): void;
  leave(): Promise<void>;
}
export interface JoinCallbacks {
  // ...existing...
  onData?(bytes: Uint8Array, fromIdentity: string): void;
}
```

- [ ] **Step 2: Wire in `joinLiveKit`** (mirror Task 4):

```ts
room.on(RoomEvent.Data ? RoomEvent.Data : RoomEvent.DataReceived, () => {}); // (use RoomEvent.DataReceived)
room.on(RoomEvent.DataReceived, (payload, participant) => {
  callbacks.onData?.(payload, participant?.identity ?? "");
});
// returned session:
sendData: (bytes, reliable) => void room.localParticipant.publishData(bytes, { reliable }),
```
(Delete the guard line; it’s just to note the correct event is `RoomEvent.DataReceived`.)

- [ ] **Step 3: Typecheck + tests.**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test`
Expected: PASS.

- [ ] **Step 4: Commit** (byte-review: media path untouched).

```bash
git add apps/kiosk/src/lib/video/types.ts apps/kiosk/src/lib/video/livekit.ts
git commit -m "feat(chat): kiosk LiveKit session sendData/onData seam"
```

---

## Phase C — Portal state + controls (mirror the captions relay)

### Task 6: Chat relay + call-controls on `CallSurfaceProvider`

**Files:**
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx`
- Test: `apps/portal/tests/components/call-surface-provider-chat.test.tsx`

Mirror the caption relay verbatim: store + listeners + publish/subscribe/snapshot kept OUT of the memoized value (`:168-180`, `:126-133`), reset per `active.callId` (`:372-376`).

- [ ] **Step 1: Define the chat message shape (local to the provider).**

```ts
export interface ChatLine { id: string; from: "guest" | "agent"; text: string; ts: number }
export interface ChatSnapshot { lines: ChatLine[]; peerTyping: boolean }
```

- [ ] **Step 2: Add the relay** (mirror `captionStoreRef`/`publishCaptions`/`subscribeCaptions`/`getCaptionSnapshot`): `chatStoreRef` holding `ChatSnapshot`, `chatListenersRef`, and `appendChatLine(line)`, `setPeerTyping(bool)`, `subscribeChat`, `getChatSnapshot`. A module-level stable empty snapshot for the `useSyncExternalStore` server/fallback value. Reset to `{ lines: [], peerTyping: false }` in the same per-`active.callId` effect that resets captions.

- [ ] **Step 3: Extend `RegisteredCallControls`** (`:59-64`) with:

```ts
sendChat?: (text: string) => void;
sendTyping?: (state: "start" | "stop") => void;
```

- [ ] **Step 4: Expose relay methods** via the provider (as non-memoized functions like the caption ones), NOT inside the memoized context `value`.

- [ ] **Step 5: Test** (mirror any caption-relay test): appending lines notifies subscribers; snapshot reflects appends; reset clears on `callId` change; `peerTyping` toggles. Run: `pnpm -F @lc/portal test call-surface-provider-chat`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/dashboard/call-surface-provider.tsx apps/portal/tests/components/call-surface-provider-chat.test.tsx
git commit -m "feat(chat): chat relay + sendChat/sendTyping controls on CallSurfaceProvider"
```

---

### Task 7: `video-call.tsx` owns publish/subscribe `[BYTE-REVIEW][SMOKE]`

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx` (session at `:129`, `registerCallControls` at `:279-291`)

- [ ] **Step 1: Pass `onData` into `joinLiveKitCall`.** On each payload: `const env = decodeChat(payload)`; if `env?.type === "msg"` → `appendChatLine({ id: env.id, from: fromIdentity === "kiosk" ? "guest" : "agent", text: env.text, ts: env.ts })` (sender derived from identity, never the payload); if `env?.type === "typing"` → `setPeerTyping(env.state === "start")` and stamp `lastPeerTypingRef` for the watchdog.

- [ ] **Step 2: Register `sendChat`/`sendTyping`** in the existing `registerCallControls({...})` call:

```ts
sendChat: (text) => {
  const clean = redactCardNumbers(text);
  const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: newMessageId(), text: clean, ts: Date.now() };
  session.sendData(encodeChat(env), true);
  appendChatLine({ id: env.id, from: "agent", text: clean, ts: env.ts }); // local echo
},
sendTyping: (state) => session.sendData(encodeChat({ v: CHAT_PROTOCOL_VERSION, type: "typing", state, ts: Date.now() }), false),
```

- [ ] **Step 3: Watchdog** — a small effect using `typingExpired(lastPeerTypingRef.current, Date.now())` on an interval clears `peerTyping` if a `stop` was dropped.

- [ ] **Step 4: Typecheck + tests.** Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test video-call`. Expected: PASS (media/end/notes paths byte-identical).

- [ ] **Step 5: Commit** (byte-review the diff: only additive chat wiring; call/media/notes/emergency untouched).

```bash
git add apps/portal/components/video-call/video-call.tsx
git commit -m "feat(chat): video-call owns chat publish/subscribe + redaction"
```

---

## Phase D — Portal UI

### Task 8: `TypingIndicator` + `ChatDock`

**Files:**
- Create: `apps/portal/components/call/typing-indicator.tsx`
- Create: `apps/portal/components/call/chat-dock.tsx`
- Test: `apps/portal/tests/components/chat-dock.test.tsx`

- [ ] **Step 1: `TypingIndicator`** — pure CSS three-dot bubble; dots animate via a keyframe with staggered `animation-delay`; wrapped in a container that respects reduced motion (`motion-reduce:animate-none` Tailwind or a CSS `@media (prefers-reduced-motion: reduce)` rule). No props beyond optional `className`.

- [ ] **Step 2: Failing test for `ChatDock`.**

```tsx
// apps/portal/tests/components/chat-dock.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatDock } from "../../components/call/chat-dock";

const lines = [
  { id: "1", from: "guest" as const, text: "1425 Oak Street", ts: 1 },
  { id: "2", from: "agent" as const, text: "Got it", ts: 2 },
];

it("renders the thread and sends redacted text on Enter", () => {
  const onSend = vi.fn();
  render(<ChatDock lines={lines} peerTyping={false} onSend={onSend} onTyping={() => {}} />);
  expect(screen.getByText("1425 Oak Street")).toBeInTheDocument();
  const input = screen.getByPlaceholderText(/type/i);
  fireEvent.change(input, { target: { value: "card 4111 1111 1111 1111" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSend).toHaveBeenCalledWith("card 4111 1111 1111 1111"); // redaction happens in video-call sendChat
});

it("shows the typing indicator when peerTyping", () => {
  render(<ChatDock lines={[]} peerTyping onSend={() => {}} onTyping={() => {}} />);
  expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run — fails** (`ChatDock` missing). Run: `pnpm -F @lc/portal test chat-dock`.

- [ ] **Step 4: Implement `ChatDock`.** Props: `{ lines: ChatLine[]; peerTyping: boolean; onSend: (text: string) => void; onTyping: (state: "start"|"stop") => void; className?: string }`. Renders a scrollable thread (guest = received/left, agent = sent/right, brand tokens — `bg-primary` navy for the guest video chrome context, teal `bg-accent` for agent bubbles; never hardcode hex), the `TypingIndicator` when `peerTyping`, and an input that calls `onSend(value)` + clears on Enter, and drives `onTyping("start")` (throttled by the caller via `shouldSendTyping`) on change / `onTyping("stop")` on blur/submit. `data-testid="typing-indicator"` on the indicator.

- [ ] **Step 5: Run — passes.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/call/typing-indicator.tsx apps/portal/components/call/chat-dock.tsx apps/portal/tests/components/chat-dock.test.tsx
git commit -m "feat(chat): ChatDock + animated TypingIndicator (portal)"
```

---

### Task 9: Tile Video⇄Chat toggle + badge + chime `[BYTE-REVIEW]`

**Files:**
- Modify: `apps/portal/components/call-tile/call-tile.tsx` (VIDEO/AUDIO branch `:154`; caption band `:194-198`; control bar `:201-234`)
- Add asset: `apps/portal/public/sounds/chat-message.mp3` (copy from `~/Downloads/chat-message/chat-message.mp3`)

- [ ] **Step 1: Copy the asset.**

```bash
cp ~/Downloads/chat-message/chat-message.mp3 apps/portal/public/sounds/chat-message.mp3
```

- [ ] **Step 2: Subscribe to the chat snapshot** in the tile via `useSyncExternalStore(surface.subscribeChat, surface.getChatSnapshot)` (mirror the caption subscription at `call-tile.tsx:113-116`, with module-level stable fallbacks like `:20-22`).

- [ ] **Step 3: Add a Video⇄Chat mode toggle** (local `useState<"video"|"chat">`). VIDEO mode = today's `GuestVideo`. CHAT mode = `<ChatDock lines onSend={callControls.sendChat} onTyping={callControls.sendTyping} />` with the guest video shrunk to a corner thumbnail. Keep the control bar (Mute/Connect/911/Hang up) in both modes.

- [ ] **Step 4: Badge + chime.** Track `lastSeenChatId`; when a new inbound (`from: "guest"`) line arrives while in VIDEO mode, show a badge on the Chat toggle and play the chime: an `<audio src="/sounds/chat-message.mp3">` ref, `.play()` (best-effort; audio context already unlocked mid-call). Clear the badge when switching to CHAT mode.

- [ ] **Step 5: Typecheck + tests.** Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test call-tile`. Expected: PASS.

- [ ] **Step 6: Commit** (byte-review: existing tile controls unchanged; additive chat mode + chime).

```bash
git add apps/portal/components/call-tile/call-tile.tsx apps/portal/public/sounds/chat-message.mp3
git commit -m "feat(chat): tile Video/Chat toggle + inbound badge + chime"
```

---

### Task 10: Overlay Playbook⇄Chat tab `[BYTE-REVIEW][SMOKE]`

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx` (body `:332-364`, where `PlaybookPanel` renders)

- [ ] **Step 1: Add a right-panel tab** (`useState<"playbook"|"chat">`) wrapping the existing `PlaybookPanel`. On "chat", render `<ChatDock lines onSend={...} onTyping={...} />` reading the chat snapshot (same subscription as the tile; the component already owns the relay + controls from Task 7). Badge the Chat tab on inbound while on "playbook".
- [ ] **Step 2: Guard the collapsed case.** When `collapsed` (tile up), the overlay is playbook-only today — leave that path exactly as-is (the tile owns chat). The tab only appears in the non-collapsed overlay.
- [ ] **Step 3: Typecheck + tests.** Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test video-call`. Expected: PASS.
- [ ] **Step 4: Commit** (byte-review: playbook/media untouched; additive tab).

```bash
git add apps/portal/components/video-call/video-call.tsx
git commit -m "feat(chat): overlay Playbook/Chat tab"
```

---

## Phase E — Kiosk UI + wiring

### Task 11: Kiosk chat state + wiring + auto-open `[BYTE-REVIEW][SMOKE]`

**Files:**
- Modify: `apps/kiosk/src/App.tsx` (session at `:30`, callbacks `:86-129`)
- Create: `apps/kiosk/src/components/TypingIndicator.tsx` (mirror the portal dots — small CSS component)

- [ ] **Step 1: Local chat state.** In `App.tsx`: `chatLines: {id,from,text,ts}[]`, `peerTyping: boolean`, `chatOpen: boolean`. Pass `onData` to `joinLiveKit`: decode with `decodeChat`; `msg` → append with `from: fromIdentity === "kiosk" ? "guest" : "agent"` (on the kiosk, `agent-*` identity = the agent) — i.e. `from = fromIdentity.startsWith("agent") ? "agent" : "guest"`; **auto-open chat (`setChatOpen(true)`) on the first inbound agent `msg`.** `typing` → set `peerTyping` + watchdog via `typingExpired`.
- [ ] **Step 2: Send path.** `sendChat(text)`: `const clean = redactCardNumbers(text); session.sendData(encodeChat({v:CHAT_PROTOCOL_VERSION,type:"msg",id:newMessageId(),text:clean,ts:Date.now()}), true);` then append locally as `from:"guest"`. `sendTyping(state)` mirrors Task 7 (lossy).
- [ ] **Step 3: Typecheck + tests.** Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test`. Expected: PASS.
- [ ] **Step 4: Commit** (byte-review: call setup/teardown untouched; additive chat state).

```bash
git add apps/kiosk/src/App.tsx apps/kiosk/src/components/TypingIndicator.tsx
git commit -m "feat(chat): kiosk chat state, wiring, auto-open on agent message"
```

---

### Task 12: Kiosk Connected Option A layout + Type button `[SMOKE]`

**Files:**
- Modify: `apps/kiosk/src/screens/Connected.tsx` (`:16-64`)
- Modify: `apps/kiosk/src/screens/CallControls.tsx` (`:35-62`)

- [ ] **Step 1: `CallControls` Type button.** Add an `onType` prop and a "Type" pill alongside Mute/Camera/End (`disabled` handling consistent with the others).
- [ ] **Step 2: Connected split layout.** New props `{ chatOpen, chatLines, peerTyping, onType, onSend, onTyping }`. When `chatOpen`, render Option A: agent remote video docks to a left column (~55%), a right chat column (~45%) with the thread + `TypingIndicator` + an input pinned above the keyboard, and the muted "Please don't type card numbers." notice under the input. When `!chatOpen`, today's full-bleed video + the new Type button in `CallControls`. Large, lobby-readable type; brand tokens only.
- [ ] **Step 3: Send/typing wiring.** Input Enter → `onSend(value)`; change → `onTyping("start")` (throttle via `shouldSendTyping` with a `useRef` last-sent stamp); blur/submit → `onTyping("stop")`.
- [ ] **Step 4: Typecheck + tests + build.** Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test && pnpm -F @lc/kiosk build`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/screens/Connected.tsx apps/kiosk/src/screens/CallControls.tsx
git commit -m "feat(chat): kiosk Connected side-by-side chat (Option A) + Type button"
```

---

## Phase F — Verify

### Task 13: Full-suite gates + staging smoke `[SMOKE]`

- [ ] **Step 1: All CI gates green.** Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm check:routes && pnpm gen:types:check`. Expected: all PASS (no migration → `gen:types:check` unaffected).
- [ ] **Step 2: Deploy the branch to staging** (Coolify auto-builds the `staging` branch — merge/rebase this branch onto `staging` per the staging runbook, or push to a staging preview). Confirm the video-token now issues `canPublishData`.
- [ ] **Step 3: Staging smoke** (from `docs/setup/2026-06-21-staging-runbook.md` + the cutover smoke section):
  - Video call connects (kiosk ⇄ agent) as today.
  - Guest taps **Type** → Option A split; type "1425 Oak Street" → appears on the agent tile + overlay.
  - Agent replies from the **tile** (Video⇄Chat toggle) → appears on the kiosk; agent-first message **auto-opens** the kiosk chat.
  - **Typing dots** show both directions; clear on send and after the watchdog.
  - Type a **test card number** on the kiosk → it is **masked** before it appears on the agent side (and vice-versa).
  - **Chime** plays on the agent side on inbound; the kiosk is silent.
  - Overlay **Playbook⇄Chat** tab works; tile-open collapses the overlay to playbook-only as before.
  - Call end / new call → thread resets (nothing persists).
- [ ] **Step 4: Record** the smoke result; update the spec/plan status and CLAUDE.md build-status row on merge.

---

## Self-review (done at authoring)

- **Spec coverage:** every spec section maps to a task — transport §5.1 → T3/T4/T5; portal relay §5.2 → T6/T7; kiosk §5.3 → T11/T12; typing §5.4 → T2/T8/T11/T12; PCI §6 → T1 (+ applied in T7/T11); attention §7 → T9; reliability §8 → T7/T11 watchdog + disabled-on-disconnect; UX §4 → T8/T9/T10/T12; sound §4.5 → T9; testing §10 → each task + T13. No gaps.
- **Placeholders:** none — pure-core tasks carry full code; integration tasks carry exact signatures, mirror file:line pointers, and concrete test assertions.
- **Type consistency:** `ChatEnvelope`/`ChatMsg`/`ChatTyping`, `encodeChat`/`decodeChat`, `newMessageId`, `redactCardNumbers`, `ChatLine`, `sendChat`/`sendTyping`, `sendData`/`onData` are used consistently across tasks. Sender is derived from identity in every receive path (T7, T11), never from the payload.

## Execution

Per Kumar, implementation happens in a **fresh chat**. Recommended method: **superpowers:subagent-driven-development** (a fresh subagent per task + two-stage review), matching this project's established build discipline. Start from the handoff: `docs/handoffs/2026-07-13-in-call-chat-plan-ready-handoff.md`.
