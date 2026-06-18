# Kiosk Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose every guest kiosk screen in the brand layout language (login-style split, drifting connection-lines, the seam), make Home a single "tap anywhere to connect" target, and fold the recording-consent screen into Ringing — with all Agora/call logic intact.

**Architecture:** `apps/kiosk/` is a Vite SPA driven by a small reducer (`call-machine.ts`) and an Agora session in `App.tsx`. This plan (1) adds CSS motion + a `ConnectionLines` component (no new dependency — the portal's `motion`-based floating-paths is **not** added), (2) collapses the `disclosure` state so a tap starts the call directly, (3) rewrites Home/Ringing and adjusts Connected/Apology/Loading, and (4) hides the now-dead owner CTA-style picker. Tasks are ordered so every commit type-checks and builds.

**Tech Stack:** React 19, Vite, Tailwind v4 (`@theme` tokens in `index.css`), Agora RTC SDK, Vitest, lucide-react. Spec: `docs/specs/2026-06-18-kiosk-redesign-design.md`.

**Conventions:** No hardcoded hex in TSX — use Tailwind tokens (`bg-primary`, `text-live`, `stroke-accent`) or the existing CSS-var gradients via inline `style`. Light mode only. No red on the kiosk. Honor `prefers-reduced-motion` (the net already exists in `index.css`).

**Verification note:** The kiosk dev server is fragile under the sandbox (see `memory/dev-server-sandbox-hazard.md`) and voice/video only work on the Vercel deploy (`memory/deploy-and-smoke-workflow.md`). Per-task gates are `pnpm -F @lc/kiosk typecheck` + `test` + `build`; live visual/flow verification happens on the kiosk Vercel deploy in Task 9.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `apps/kiosk/src/index.css` | Brand tokens + motion keyframes + reduced-motion net | 1 |
| `apps/kiosk/src/components/brand.tsx` | `SeamTop`/`SeamShimmer` (keep), `ConnectionLines` (add), `LogoMark` (remove) | 1, 3 |
| `apps/kiosk/src/state/call-machine.ts` | Reducer — collapse `disclosure` | 2 |
| `apps/kiosk/tests/state/call-machine.test.ts` | Reducer tests | 2 |
| `apps/kiosk/src/App.tsx` | Orchestration — tap→start, drop RecordingNotice, Loading logo-drop | 2 |
| `apps/kiosk/src/lib/copy.ts` | Guest copy — add `ringing`, drop `recording` | 2 |
| `apps/kiosk/src/screens/RecordingNotice.tsx` | **Deleted** | 2 |
| `apps/kiosk/src/screens/Home.tsx` | Tap-anywhere 50/50 split | 3 |
| `apps/kiosk/src/screens/Ringing.tsx` | Connecting field + seam ring + PiP + recording line | 4 |
| `apps/kiosk/src/screens/Connected.tsx` | PiP → top-right | 5 |
| `apps/kiosk/src/screens/Apology.tsx` | Restyle | 6 |
| `apps/kiosk/src/screens/CallControls.tsx` | **No change** (shared, already on-brand) | — |
| `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx` | Hide CTA-style picker | 7 |

---

## Task 1: Motion tokens + `ConnectionLines` (additive)

Additive only — nothing is removed yet, so the build stays green.

**Files:**
- Modify: `apps/kiosk/src/index.css`
- Modify: `apps/kiosk/src/components/brand.tsx`

- [ ] **Step 1: Add the two gradient tokens** inside the `@theme { … }` block in `index.css`, right after the `--color-call` line:

```css
  /* Brand-revision layout phase — kiosk redesign 2026-06-18 */
  --gradient-brand-panel: linear-gradient(157deg, #15405A 0%, #0E2A45 55%, #0B2036 100%);
  --gradient-call-stage: radial-gradient(120% 130% at 30% 10%, #16384F, #0E2A45 60%, #0B1F33);
```

- [ ] **Step 2: Add the motion keyframes + classes** at the end of `index.css`, immediately **before** the `@media (prefers-reduced-motion: reduce)` block:

```css
/* Connection-lines (kiosk-local, CSS — the dependency-free echo of the portal floating-paths) */
@keyframes lc-cl-breathe { 0%, 100% { opacity: 0.28; } 50% { opacity: 0.55; } }
@keyframes lc-cl-drift  { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(8px, -6px); } }
.lc-cl-layer { animation: lc-cl-drift 9s ease-in-out infinite; transform-origin: center; }
.lc-cl-path  { animation: lc-cl-breathe 6s ease-in-out infinite; }

/* Connect beacon — expanding pulse rings on the Home invitation */
@keyframes lc-beacon { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(1.7); opacity: 0; } }
.lc-beacon-pulse { animation: lc-beacon 2.6s ease-out infinite; }
```

- [ ] **Step 3: Extend the reduced-motion net.** In the `@media (prefers-reduced-motion: reduce)` block, replace the existing selector list line so the new classes are covered:

```css
  .lc-anim-spin, .lc-anim-spin-fast, .lc-anim-pulse, .lc-anim-shimmer, .lc-seam-drift,
  .lc-cl-layer, .lc-cl-path, .lc-beacon-pulse {
    animation: none !important;
  }
```

- [ ] **Step 4: Add `ConnectionLines` to `brand.tsx`** (append; do not touch `LogoMark` yet):

```tsx
/** Drifting connection-lines field (CSS-animated; the kiosk's dependency-free
 *  echo of the portal floating-paths). Honors prefers-reduced-motion via index.css. */
export function ConnectionLines({ className = "" }: { readonly className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 260 280"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <g className="lc-cl-layer" strokeWidth="1.1">
        <path className="lc-cl-path stroke-accent" style={{ animationDelay: "0s" }}
          d="M-10 70 C60 40 110 120 190 88 S300 84 340 108" />
        <path className="lc-cl-path stroke-live" style={{ animationDelay: "-2s" }}
          d="M-10 150 C70 120 120 200 210 160 S300 158 345 176" />
        <path className="lc-cl-path stroke-accent" style={{ animationDelay: "-4s" }}
          d="M-10 220 C80 192 130 250 220 214 S300 220 345 232" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 5: Verify typecheck + build pass**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk build`
Expected: both PASS (ConnectionLines is exported but not yet used — that's fine; it's a named export, not flagged as unused).

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/index.css apps/kiosk/src/components/brand.tsx
git commit -m "feat(kiosk): connection-lines + brand-panel tokens (no new dep)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Flow change — collapse the `disclosure` state (TDD)

Removes the blocking recording screen. Tap → connecting (Ringing) directly. Machine + App.tsx + copy + RecordingNotice deletion move together so the build stays green. **TDD the reducer first.**

**Files:**
- Modify: `apps/kiosk/tests/state/call-machine.test.ts`
- Modify: `apps/kiosk/src/state/call-machine.ts`
- Modify: `apps/kiosk/src/App.tsx`
- Modify: `apps/kiosk/src/lib/copy.ts`
- Delete: `apps/kiosk/src/screens/RecordingNotice.tsx`

- [ ] **Step 1: Rewrite the reducer tests.** Replace the whole body of `tests/state/call-machine.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  initialState,
  reduce,
  shouldFireRingTimeout,
  type KioskState,
} from "@/state/call-machine";

describe("kiosk call machine", () => {
  it("starts at home", () => {
    expect(initialState().screen).toBe("home");
  });

  it("home → ringing on tap (start connecting)", () => {
    const s = reduce(initialState(), { type: "TAP_CALL" });
    expect(s.screen).toBe("ringing");
  });

  it("TAP_CALL is a no-op when not on home", () => {
    const s: KioskState = { screen: "connected", callId: "c1", channelName: "call_abc" };
    expect(reduce(s, { type: "TAP_CALL" }).screen).toBe("connected");
  });

  it("CALL_STARTED records callId + channel and stays on ringing", () => {
    let s = reduce(initialState(), { type: "TAP_CALL" });
    s = reduce(s, { type: "CALL_STARTED", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });

  it("ringing → connected when the agent joins", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "AGENT_JOINED" });
    expect(s.screen).toBe("connected");
  });

  it("ringing → apology on 120s timeout", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "RING_TIMEOUT" });
    expect(s.screen).toBe("apology");
  });

  it("connected → home on end", () => {
    let s: KioskState = { screen: "connected", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "END_CALL" });
    expect(s.screen).toBe("home");
  });

  it("ringing → home on cancel", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "CANCEL" });
    expect(s.screen).toBe("home");
  });

  it("apology → home on dismiss", () => {
    let s: KioskState = { screen: "apology", callId: null, channelName: null };
    s = reduce(s, { type: "DISMISS_APOLOGY" });
    expect(s.screen).toBe("home");
  });

  it("any → apology on error", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "ERROR" });
    expect(s.screen).toBe("apology");
  });
});

describe("shouldFireRingTimeout (no-answer cutoff guard)", () => {
  it("fires while the call is still ringing", () => {
    expect(shouldFireRingTimeout("ringing")).toBe(true);
  });

  // Regression: the 120s ring timer is armed at ringing and must be inert once the
  // agent has joined, or it tears down a live call.
  it("does NOT fire once the call has connected", () => {
    expect(shouldFireRingTimeout("connected")).toBe(false);
  });

  it("does NOT fire on home or apology", () => {
    expect(shouldFireRingTimeout("home")).toBe(false);
    expect(shouldFireRingTimeout("apology")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests — expect failures**

Run: `pnpm -F @lc/kiosk test -- call-machine`
Expected: FAIL — the old machine still has `disclosure`/`ACCEPT_DISCLOSURE`/`CLOSE_DISCLOSURE`; `CALL_STARTED` and `home → ringing` don't exist yet (type errors / assertion failures).

- [ ] **Step 3: Rewrite the reducer.** Replace `apps/kiosk/src/state/call-machine.ts` with:

```ts
export type KioskScreen =
  | "home"
  | "ringing"
  | "connected"
  | "apology";

export interface KioskState {
  screen: KioskScreen;
  callId: string | null;
  channelName: string | null;
}

export type KioskAction =
  | { type: "TAP_CALL" }
  | { type: "CALL_STARTED"; callId: string; channelName: string }
  | { type: "AGENT_JOINED" }
  | { type: "RING_TIMEOUT" }
  | { type: "CANCEL" }
  | { type: "END_CALL" }
  | { type: "DISMISS_APOLOGY" }
  | { type: "ERROR" };

export function initialState(): KioskState {
  return { screen: "home", callId: null, channelName: null };
}

/**
 * The 120s ring timer is a *no-answer* cutoff: it only means anything while the
 * call is still ringing. It is armed when ringing begins and must be cancelled
 * on connect — but if it ever fires after the agent has joined, this guard keeps
 * it inert so a live call is never torn down out from under the kiosk.
 */
export function shouldFireRingTimeout(screen: KioskScreen): boolean {
  return screen === "ringing";
}

function home(): KioskState {
  return initialState();
}

export function reduce(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "TAP_CALL":
      // Tap starts connecting immediately; the async call setup follows and
      // reports its ids via CALL_STARTED. No blocking consent screen.
      return state.screen === "home" ? { ...state, screen: "ringing" } : state;
    case "CALL_STARTED":
      return { ...state, callId: action.callId, channelName: action.channelName };
    case "AGENT_JOINED":
      return state.screen === "ringing" ? { ...state, screen: "connected" } : state;
    case "RING_TIMEOUT":
      return state.screen === "ringing" ? { ...state, screen: "apology" } : state;
    case "CANCEL":
      return home();
    case "END_CALL":
      return home();
    case "DISMISS_APOLOGY":
      return home();
    case "ERROR":
      return { ...state, screen: "apology" };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `pnpm -F @lc/kiosk test -- call-machine`
Expected: PASS (all cases).

- [ ] **Step 5: Add `ringing` copy, drop `recording`.** In `apps/kiosk/src/lib/copy.ts`, replace the `recording: { … },` block with:

```ts
  ringing: {
    title: "Ringing the front desk…",
    subtitle: "Someone's almost there",
    recordingNote: "Calls may be recorded for quality",
  },
```

- [ ] **Step 6: Rewire `App.tsx`.** Make these four edits:

  (a) Update the brand + screen imports (drop `LogoMark` and `RecordingNotice`):

```tsx
import { SeamShimmer } from "./components/brand";
```
  (delete the `import { RecordingNotice } from "./screens/RecordingNotice";` line entirely; keep `Home`, `Ringing`, `Connected`, `Apology` imports.)

  (b) Replace the `onAccept` callback with `onStartCall` — same body, but it dispatches `TAP_CALL` first and uses `CALL_STARTED`:

```tsx
  const onStartCall = useCallback(async () => {
    dispatch({ type: "TAP_CALL" }); // → ringing immediately (connecting); async setup follows
    try {
      const { callId, channelName } = await startCall();
      callIdRef.current = callId;
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchAgoraToken(channelName, uid);
      const session = await joinChannel({
        appId: tok.appId, channel: tok.channelName, token: tok.token, uid: tok.uid,
        onRemoteVideo: (t) => setRemoteVideo(t ?? null),
        onAgentJoined: () => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          dispatch({ type: "AGENT_JOINED" });
        },
        onAgentLeft: () => {
          void teardown();
          void endCall(callIdRef.current!, "completed");
          dispatch({ type: "END_CALL" });
        },
        onConnectionStateChange: (cur, _prev, reason) => {
          const outcome = interpretConnectionState(cur, reason);
          if (outcome === "lost") {
            setReconnecting(true);
          } else if (outcome === "restored") {
            setReconnecting(false);
          } else if (outcome === "terminal") {
            setReconnecting(false);
            const id = callIdRef.current;
            void teardown();
            if (id) void endCall(id, "failed");
            dispatch({ type: "ERROR" });
          }
        },
      });
      sessionRef.current = session;
      localAudioRef.current = session.localAudio;
      setLocalVideo(session.localVideo);
      dispatch({ type: "CALL_STARTED", callId, channelName });
      timeoutRef.current = setTimeout(() => {
        if (!shouldFireRingTimeout(screenRef.current)) return;
        if (callIdRef.current) void endCall(callIdRef.current, "no-answer");
        void teardown();
        dispatch({ type: "RING_TIMEOUT" });
      }, RING_WINDOW_MS);
    } catch {
      await teardown();
      dispatch({ type: "ERROR" });
    }
  }, [teardown]);
```

  (c) In the Loading branch, remove the `LogoMark`:

```tsx
  if (!config) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-5"
        role="status"
        aria-live="polite"
      >
        <SeamShimmer />
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }
```

  (d) In the `screen` switch, wire Home to `onStartCall` and delete the `disclosure` case:

```tsx
      case "home":
        return <Home config={config} onCall={onStartCall} />;
      case "ringing":
        return <Ringing localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onCancel={onCancel} />;
      case "connected":
        return <Connected remoteVideo={remoteVideo} localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onEnd={onEnd} />;
      case "apology":
        return <Apology message={config.apologyMessage} onDone={() => dispatch({ type: "DISMISS_APOLOGY" })} />;
```

- [ ] **Step 7: Delete the RecordingNotice screen**

```bash
git rm apps/kiosk/src/screens/RecordingNotice.tsx
```

- [ ] **Step 8: Verify the whole kiosk type-checks, tests, builds**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test && pnpm -F @lc/kiosk build`
Expected: all PASS. (If typecheck flags an unused `copy.recording` reference anywhere, there should be none — RecordingNotice was its only consumer.)

- [ ] **Step 9: Commit**

```bash
git add apps/kiosk/src/state/call-machine.ts apps/kiosk/tests/state/call-machine.test.ts apps/kiosk/src/App.tsx apps/kiosk/src/lib/copy.ts
git commit -m "feat(kiosk): collapse disclosure state — tap connects directly

Recording-consent screen removed (no recording in v1); folded into Ringing.
TAP_CALL now starts connecting; CALL_STARTED records ids. Loading drops the
LC logo. All Agora/call logic and the 120s no-answer cutoff unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Home — tap-anywhere 50/50 split

**Files:**
- Modify (rewrite): `apps/kiosk/src/screens/Home.tsx`
- Modify: `apps/kiosk/src/components/brand.tsx` (remove now-unused `LogoMark`)

- [ ] **Step 1: Rewrite `Home.tsx`** entirely:

```tsx
import { Video } from "lucide-react";
import type { KioskConfig } from "../types";
import { ConnectionLines } from "../components/brand";
import { greetingForHour } from "@lc/shared";

function InfoItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const hasInfo =
    config.checkinTime || config.checkoutTime || config.wifiNetwork ||
    config.wifiPassword || config.breakfastHours;

  return (
    <button
      type="button"
      onClick={onCall}
      aria-label="Tap to connect with the front desk"
      className="relative flex h-full w-full text-left transition-transform active:scale-[0.997]"
    >
      {/* LEFT — navy, animated invitation (50%) */}
      <div
        className="relative flex flex-[0_0_50%] flex-col overflow-hidden px-12 py-11 text-white"
        style={{ background: "var(--gradient-brand-panel)" }}
      >
        <ConnectionLines />

        {/* Hotel name — text only, no logo (brand §2: never on the kiosk) */}
        <span className="relative z-10 font-display text-xs font-semibold uppercase tracking-[0.14em] text-white/85">
          {config.welcomeHeading}
        </span>

        <div className="relative z-10 mt-auto flex flex-col items-start">
          <div className="relative mb-7 grid size-[88px] place-items-center">
            <span className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55" aria-hidden />
            <span
              className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55"
              style={{ animationDelay: "-1.3s" }}
              aria-hidden
            />
            <span className="grid size-16 place-items-center rounded-pill bg-live/15 text-live">
              <Video className="size-8" strokeWidth={1.8} />
            </span>
          </div>
          <h1 className="max-w-[15ch] font-display text-[2.4rem] font-semibold leading-[1.08] tracking-tight">
            Tap anywhere to connect with the <span className="text-live">front desk</span>
          </h1>
        </div>

        {/* seam down the join */}
        <div
          className="absolute inset-y-0 right-0 z-10 w-[3px]"
          style={{ background: "var(--gradient-seam)" }}
          aria-hidden
        />
      </div>

      {/* RIGHT — light, greeting + small box (50%) */}
      <div className="flex flex-1 flex-col justify-center gap-6 px-11 py-10">
        <div>
          <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-foreground">
            {greetingForHour(new Date().getHours())}.
          </h2>
          {config.welcomeMessage ? (
            <p className="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">
              {config.welcomeMessage}
            </p>
          ) : null}
        </div>

        {hasInfo ? (
          <div className="relative overflow-hidden rounded-card border border-border bg-card p-6 shadow-md">
            <span
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: "var(--gradient-seam)" }}
              aria-hidden
            />
            <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Good to know
            </span>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoItem label="Check-in" value={config.checkinTime} />
              <InfoItem label="Check-out" value={config.checkoutTime} />
              <InfoItem label="Wi-Fi" value={config.wifiNetwork} />
              <InfoItem label="Password" value={config.wifiPassword} />
              <InfoItem label="Breakfast" value={config.breakfastHours} />
            </div>
          </div>
        ) : null}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Remove `LogoMark` from `brand.tsx`.** Delete the entire `LogoMark` function (the `/** The "LC" seam mark … */ export function LogoMark(...) { … }` block). Keep `SeamTop`, `SeamShimmer`, and `ConnectionLines`.

- [ ] **Step 3: Verify typecheck + build** (confirms no remaining `LogoMark` importer)

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk build`
Expected: PASS. (If it fails on a missing `LogoMark` import, grep `apps/kiosk/src` for `LogoMark` — App.tsx and Home should both be clean after Tasks 2–3.)

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/screens/Home.tsx apps/kiosk/src/components/brand.tsx
git commit -m "feat(kiosk): tap-anywhere Home — 50/50 split, connection-lines, no logo

Whole screen is one call button. Navy animated invitation (connection-lines +
connect beacon + 'tap anywhere to connect with the front desk') | seam | light
greeting over a small Good-to-know card. CTA-style picker dropped; hotel name is
text only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Ringing — connecting field + seam ring + PiP + recording line

**Files:**
- Modify (rewrite): `apps/kiosk/src/screens/Ringing.tsx`

- [ ] **Step 1: Rewrite `Ringing.tsx`** entirely:

```tsx
import { useEffect, useRef } from "react";
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";
import { Phone, ShieldCheck } from "lucide-react";
import { ConnectionLines } from "../components/brand";
import { CallControls } from "./CallControls";
import { copy } from "../lib/copy";

export function Ringing({
  localVideo, muted, cameraOff, onMute, onCamera, onCancel,
}: {
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (localVideo && ref.current) localVideo.play(ref.current);
  }, [localVideo]);

  return (
    <div className="relative h-full overflow-hidden" style={{ background: "var(--gradient-call-stage)" }}>
      <ConnectionLines />

      {/* self-view PiP — top-right (consistent across every call stage) */}
      <div className="absolute right-5 top-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/40">
        <div ref={ref} className="absolute inset-0" />
        <span className="absolute bottom-1.5 left-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
          You
        </span>
      </div>

      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 px-10 text-center text-white">
        <div className="relative mb-2 grid size-32 place-items-center">
          <div className="seam-ring lc-anim-spin size-32 rounded-pill p-1" aria-hidden />
          <div className="absolute grid size-24 place-items-center rounded-pill bg-white/10">
            <Phone className="size-9" strokeWidth={1.6} />
          </div>
        </div>
        <div className="font-display text-3xl font-semibold">{copy.ringing.title}</div>
        <div className="font-mono text-sm text-white/65">{copy.ringing.subtitle}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
          <ShieldCheck className="size-3.5" strokeWidth={1.8} />
          {copy.ringing.recordingNote}
        </div>
      </div>

      <CallControls
        muted={muted}
        cameraOff={cameraOff}
        onMute={onMute}
        onCamera={onCamera}
        primary={{ label: "Cancel", onClick: onCancel }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Ringing.tsx
git commit -m "feat(kiosk): rebrand Ringing — connecting field, seam ring, PiP, recording line

Self-view demoted to a top-right PiP on a branded connection-lines field;
spinning seam ring; folded-in 'calls may be recorded' line. Controls unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Connected — self-view PiP to top-right

**Files:**
- Modify: `apps/kiosk/src/screens/Connected.tsx`

- [ ] **Step 1: Move the local PiP to top-right and add a "You" label.** Replace the existing `localRef` PiP `<div>` (currently `className="absolute bottom-24 right-5 …"`) with:

```tsx
      <div className="absolute right-5 top-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/45">
        <div ref={localRef} className="absolute inset-0" />
        <span className="absolute bottom-1.5 left-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
          You
        </span>
      </div>
```

  Everything else in `Connected.tsx` (remote video, seam-drift frame, the top-left "Connected" badge, `CallControls` with the `End` primary) stays exactly as-is. The badge is top-left and the PiP is now top-right, so they don't collide.

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Connected.tsx
git commit -m "feat(kiosk): Connected self-view PiP → top-right (consistent placement)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Apology — restyle

**Files:**
- Modify (rewrite): `apps/kiosk/src/screens/Apology.tsx`

- [ ] **Step 1: Rewrite `Apology.tsx`** entirely (logic identical — 10s auto-return; only chrome changes):

```tsx
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { SeamTop } from "../components/brand";
import { copy } from "../lib/copy";

export function Apology({ message, onDone }: { message: string | null; onDone: () => void }) {
  const [left, setLeft] = useState(10);
  useEffect(() => {
    const tick = setInterval(() => setLeft((s) => s - 1), 1000);
    const done = setTimeout(onDone, 10_000);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, [onDone]);

  return (
    <div className="relative h-full">
      <SeamTop />
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <span className="mb-5 grid size-14 place-items-center rounded-pill bg-accent/10 text-accent">
          <Clock className="size-7" strokeWidth={1.6} />
        </span>
        <h1 className="max-w-[80%] font-display text-3xl font-semibold leading-tight text-foreground">
          {copy.apology.heading}
        </h1>
        <p className="mt-3.5 max-w-[60ch] text-base leading-relaxed text-muted-foreground">
          {message ?? copy.apology.fallback}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Returning to the welcome screen in {Math.max(0, left)}s…
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Apology.tsx
git commit -m "feat(kiosk): restyle Apology (seam hairline + clock mark)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Owner portal — hide the dead CTA-style picker

The new Home ignores `kiosk_cta_style`. Remove the picker UI; keep the column, action signature, API, and helpers intact (dormant re-enable seam). The save call passes the unchanged `initialStyle` through.

**Files:**
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx`

- [ ] **Step 1: Trim the imports.** Change the `@/lib/owner/kiosk` import to drop `KIOSK_CTA_STYLES` (keep the `KioskCtaStyle` type, still used by the `Props` type):

```tsx
import { KIOSK_FIELDS, type KioskContentInput, type KioskCtaStyle } from "@/lib/owner/kiosk";
```

- [ ] **Step 2: Delete the `STYLE_META` constant** (the whole `const STYLE_META: Record<KioskCtaStyle, …> = { … };` block).

- [ ] **Step 3: Remove the `style` state and its reset.** Delete the line `const [style, setStyle] = useState<KioskCtaStyle>(initialStyle);` and, in `cancel()`, delete the `setStyle(initialStyle);` line. Keep the `initialStyle` prop on `Props` and in the destructure (it's still passed in and used by save).

- [ ] **Step 4: Pass `initialStyle` through on save.** In `save()`, change the action call to:

```tsx
      const result = await updateKioskContentAction(propertyId, values, initialStyle);
```

- [ ] **Step 5: Delete the Appearance picker block.** Remove the entire `<div className="flex flex-col gap-1.5"><Label>Appearance</Label> … </div>` block (the one that maps over the styles into preview buttons). The `KIOSK_FIELDS.map(...)` block directly below it becomes the first child of the content column.

- [ ] **Step 6: Verify portal typecheck + lint + tests**

Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal lint && pnpm -F @lc/portal test`
Expected: PASS. No unused-var errors (`style`/`setStyle`/`STYLE_META`/`KIOSK_CTA_STYLES` are all gone). The `kiosk-cta-style` helper test and the `config` API test are untouched and still green (helper/column/API unchanged).

- [ ] **Step 7: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx"
git commit -m "feat(owner): hide kiosk CTA-style picker (superseded by kiosk redesign)

The new kiosk Home ignores kiosk_cta_style. Picker UI removed; column, save
action, API, and helpers left dormant as a re-enable seam.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full repo verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gates from the repo root**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm check:routes`
Expected: all PASS. (`gen:types:check` is unaffected — no schema change.)

- [ ] **Step 2: Build both apps**

Run: `pnpm build`
Expected: portal + kiosk builds succeed.

- [ ] **Step 3: Commit** (only if any lint/format autofix changed files; otherwise skip)

```bash
git add -A
git commit -m "chore(kiosk): lint/format pass for redesign

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Live visual + flow verification (on the Vercel kiosk deploy)

The dev server is unreliable under the sandbox and Twilio/Agora only work on prod — verify on the deploy (`memory/deploy-and-smoke-workflow.md`). This task is a checklist, not code.

- [ ] **Step 1:** Push the branch and let Vercel build the kiosk preview/prod (per the deploy workflow). Open the kiosk URL on a tablet-sized viewport (landscape).
- [ ] **Step 2: Home** — confirm the 50/50 split, drifting connection-lines + pulsing beacon (and that they *stop* under OS "reduce motion"), the greeting weight reads present (not thin), the Good-to-know card shows only the fields that are set, **no LC logo anywhere**, and tapping **anywhere** starts a call.
- [ ] **Step 3: Connecting/Ringing** — tap goes straight to the connecting field (no recording interstitial); seam ring spins; self-view PiP is **top-right**; the "calls may be recorded" line shows; Cancel returns Home.
- [ ] **Step 4: Connected** — answer from an agent; confirm remote full-bleed, seam frame, top-left "Connected" badge, self-view PiP **top-right**, Mute/Camera/End work, End returns Home.
- [ ] **Step 5: Apology** — let a call ring out (no answer) and confirm the restyled apology + auto-return; **Loading** splash shows the seam shimmer with no logo; **Reconnecting** overlay still appears on a dropped connection.
- [ ] **Step 6: Owner portal** — open a property's kiosk-content card and confirm the Appearance picker is gone and Save still works.

---

## Self-review notes (for the implementer)

- **Green-commit ordering:** `LogoMark` is removed only in Task 3, after its last importer (Home) stops using it; App.tsx drops its `LogoMark` import in Task 2. Don't delete `LogoMark` earlier.
- **No new dependency:** the kiosk must NOT gain `motion`. Connection-lines are the CSS `ConnectionLines` component only.
- **`copy.recording` is fully removed** in Task 2 (its only consumer, RecordingNotice, is deleted in the same task). If a later task references `copy.recording`, that's a bug — use `copy.ringing`.
- **Action rename:** the reducer action is `CALL_STARTED` (not `ACCEPT_DISCLOSURE`). App.tsx must dispatch `CALL_STARTED`.
- **Hotel logo:** Home renders the hotel **name only** — do not add an `<img src={config.logoUrl}>`.
- **Reconnecting overlay** (in `App.tsx`) needs **no change** — it already uses the seam ring
  (`seam-ring lc-anim-spin-fast`) over the dimmed dark stage, which is on-brand. Spec §6 "align styling"
  is already satisfied; Task 9 just verifies it still appears.
