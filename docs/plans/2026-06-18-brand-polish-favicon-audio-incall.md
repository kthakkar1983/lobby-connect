# Brand polish — favicon + audio in-call overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brand favicon/app-icon and redesign the audio in-call overlay to the brand-revision polish bar (911 to the top-right corner, reorganized control bar, navy call card with hotel local time, press-Enter-to-save notes, live call timer).

**Architecture:** Pure portal change. Favicon via Next App Router file conventions (`app/icon.svg`, `app/apple-icon.tsx`). The audio overlay (`components/softphone/audio-call-overlay.tsx`) stays a controlled presentational component; all call/Twilio/emergency logic stays in `softphone.tsx`. Hotel local time rides the existing `/api/twilio/voice/answered` response (one enriched field, **no voice/TwiML change**). Enter-to-save reuses the existing `saveNotes` endpoint + durability banner. Video overlay untouched.

**Tech Stack:** Next 15 App Router, React 19, Tailwind v4 tokens, lucide-react, Vitest + Testing Library, `next/og` ImageResponse.

**Spec:** `docs/specs/2026-06-18-brand-polish-favicon-audio-incall-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `apps/portal/app/icon.svg` | **new** — navy-tile reversed-mark favicon (all browsers) |
| `apps/portal/app/apple-icon.tsx` | **new** — 180×180 iOS icon via `next/og` ImageResponse |
| `apps/portal/app/layout.tsx` | add `viewport.themeColor` (navy mobile chrome) |
| `apps/portal/app/api/twilio/voice/answered/route.ts` | return `{ timeZone }` (200) on the winning claim |
| `apps/portal/tests/app/twilio/answered.test.ts` | update winner expectation to 200 `{timeZone}` |
| `apps/portal/components/softphone/audio-call-overlay.tsx` | redesigned layout + local time + Enter-to-save + timer |
| `apps/portal/components/softphone/softphone.tsx` | capture `timeZone`; `saveNotes` returns boolean; `onSaveNotes`; pass new props |
| `apps/portal/tests/components/audio-call-overlay.test.tsx` | update props + add local-time / save tests |

No migrations, no new routes, no RLS, no service-role changes. `softphone.tsx` has no unit test (SDK-coupled) — verified by typecheck + the overlay tests + the prod audio smoke.

---

## Task 1: Favicon + app icon

**Files:**
- Create: `apps/portal/app/icon.svg`
- Create: `apps/portal/app/apple-icon.tsx`
- Modify: `apps/portal/app/layout.tsx`

- [ ] **Step 1: Create `app/icon.svg`**

Navy rounded tile (`#0F2D4B`, `rx=14` ≈ 22%) with the **reversed** mark (near-white door `#f4f7f7`, teal `#2ea6aa`, mint `#06d6a0`) centered at ~62% height. Transform: `scale = 0.62*64/969.7 ≈ 0.0409`, centered at `translate(16.23 12.16)`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0F2D4B"/>
  <g transform="translate(16.23 12.16) scale(0.0409)">
    <path fill="#f4f7f7" d="M186 909.1c0 32.8-32.2 48.9-55.7 51.2l-93.7 9.3C23.4 970.9.7 951.2.7 933.9L0 47.1C0 19.7 23.2-2.8 51.5.3l522.7 56.8-362.1 119.8c-16.6 8.4-26.1 23.4-25.8 43.5l-.3 688.8Z"/>
    <path fill="#2ea6aa" d="M610.9 919.5c-17.1 1.5-35.3-11.5-35.3-29.4l-.6-652c0-22.5-16.3-40.4-36.2-45.3L393.1 180l331-108.4c11.1-3.6 19.8-9.2 28.1-5.1 7.4 3.6 18.3 13.1 18.3 26.1l-1.1 789.3c0 17.6-26.4 26.1-37 27.1l-121.5 10.6Z"/>
    <path fill="#06d6a0" d="M338.5 940.9c-14 1.6-28.2-15.8-28.1-29.2l1.3-254c.2-43.7 47-64 81.3-58.7 44.5 6.9 59.2 44 58.9 88.2l-1.5 228.6c0 7.2-5.5 13.2-12.6 14L338.4 941Z"/>
    <circle cx="380.8" cy="497" r="66.8" fill="#06d6a0"/>
  </g>
</svg>
```

- [ ] **Step 2: Create `app/apple-icon.tsx`** (full navy square; iOS rounds the corners itself)

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Reversed mark (near-white door + teal + mint) — same artwork as /brand/mark-on-dark.svg.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 770.5 969.7"><path fill="#f4f7f7" d="M186 909.1c0 32.8-32.2 48.9-55.7 51.2l-93.7 9.3C23.4 970.9.7 951.2.7 933.9L0 47.1C0 19.7 23.2-2.8 51.5.3l522.7 56.8-362.1 119.8c-16.6 8.4-26.1 23.4-25.8 43.5l-.3 688.8Z"/><path fill="#2ea6aa" d="M610.9 919.5c-17.1 1.5-35.3-11.5-35.3-29.4l-.6-652c0-22.5-16.3-40.4-36.2-45.3L393.1 180l331-108.4c11.1-3.6 19.8-9.2 28.1-5.1 7.4 3.6 18.3 13.1 18.3 26.1l-1.1 789.3c0 17.6-26.4 26.1-37 27.1l-121.5 10.6Z"/><path fill="#06d6a0" d="M338.5 940.9c-14 1.6-28.2-15.8-28.1-29.2l1.3-254c.2-43.7 47-64 81.3-58.7 44.5 6.9 59.2 44 58.9 88.2l-1.5 228.6c0 7.2-5.5 13.2-12.6 14L338.4 941Z"/><circle cx="380.8" cy="497" r="66.8" fill="#06d6a0"/></svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F2D4B",
        }}
      >
        {/* mark at ~62% height; aspect 770.5/969.7 → 89×112 */}
        <img width={89} height={112} src={`data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`} />
      </div>
    ),
    size,
  );
}
```

> If `next build` reports the SVG data-URI img doesn't rasterize under Satori, fall back to a committed static `app/apple-icon.png` (180×180 navy square + centered mark) — render the same tile in a headless browser at 180×180 and save the screenshot. Primary path is the ImageResponse above.

- [ ] **Step 3: Add navy `themeColor`** to `app/layout.tsx` (mobile browser chrome). Add the import + a `viewport` export alongside the existing `metadata`:

```tsx
import type { Metadata, Viewport } from "next";
```

```tsx
export const viewport: Viewport = {
  themeColor: "#0F2D4B",
};
```

- [ ] **Step 4: Build to validate the icon routes**

Run: `pnpm -F @lc/portal build`
Expected: build succeeds; `/icon.svg` and `/apple-icon` appear among the generated routes (Next compiles `apple-icon.tsx`).

- [ ] **Step 5: Visual check** (favicon SVG renders as a navy tile + mark). Open `apps/portal/app/icon.svg` in a browser, or screenshot via the Playwright harness used in the brand-asset verification. Confirm: navy rounded tile, reversed mark legible.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/app/icon.svg apps/portal/app/apple-icon.tsx apps/portal/app/layout.tsx
git commit -m "feat(brand): add favicon + iOS app icon (navy tile + reversed mark)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `answered` route returns the property timezone

**Files:**
- Modify: `apps/portal/app/api/twilio/voice/answered/route.ts`
- Test: `apps/portal/tests/app/twilio/answered.test.ts`

- [ ] **Step 1: Update the winner test** to expect `200` + `{ timeZone }`, and give the mocked call an embedded property. In `answered.test.ts`:

Change the `callRow` type and the winner test. Replace the type declaration:

```ts
let callRow:
  | { id: string; state: string; operator_id: string; properties: { timezone: string } | null }
  | null = null;
```

Replace the winner test body (the `it("marks the call IN_PROGRESS ...")` block) so the row carries a timezone and the response is asserted:

```ts
  it("marks the call IN_PROGRESS + handled_by, self ON_CALL, and returns the property timeZone (winner)", async () => {
    callRow = {
      id: "c1",
      state: "RINGING",
      operator_id: "op1",
      properties: { timezone: "America/New_York" },
    };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timeZone: "America/New_York" });
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "IN_PROGRESS", handled_by_user_id: "u1" }),
    );
    expect(callUpdateSpy.mock.calls[0]?.[0]).toHaveProperty("answered_at");
    expect(profileUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });
```

Also update the three rows in the 409/404 tests that set `callRow = { id, state, operator_id }` to include `properties: null` (so the type matches), e.g.:

```ts
    callRow = { id: "c1", state: "IN_PROGRESS", operator_id: "op1", properties: null };
```
(apply to the "not RINGING", "another operator", and both 409 tests).

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm -F @lc/portal test -- answered`
Expected: FAIL — winner test gets `204`, not `200`.

- [ ] **Step 3: Update the route** to read the embedded timezone and return it. In `answered/route.ts`:

Change the `fetchOperatorCall` call to select the embedded timezone and widen the type:

```ts
  const call = await fetchOperatorCall<{
    id: string;
    state: CallState;
    properties: { timezone: string } | null;
  }>(actor, body.callId, "id, state, properties(timezone)");
  if (call instanceof NextResponse) return call;
```

Replace the final success return (`return new NextResponse(null, { status: 204 });`) with:

```ts
  return NextResponse.json({ timeZone: call.properties?.timezone ?? null });
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm -F @lc/portal test -- answered`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/twilio/voice/answered/route.ts apps/portal/tests/app/twilio/answered.test.ts
git commit -m "feat(voice): answered route returns the property timeZone

Enriches the existing answered response (was 204) with { timeZone } from
the call's property, so the in-call overlay can show hotel local time
without touching the voice/TwiML dial path. Loser/404/403 paths unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Audio overlay redesign + softphone wiring

Combined because the overlay's new props and the softphone's prop-passing are coupled (keeps every commit type-clean).

**Files:**
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx`
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Test: `apps/portal/tests/components/audio-call-overlay.test.tsx`

- [ ] **Step 1: Update the overlay test** — add the new props to `baseProps`, keep the existing assertions, and add local-time + Enter-to-save tests. Replace the file body with:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/call/playbook-panel", () => ({
  PlaybookPanel: ({ callId }: { callId: string }) => (
    <div data-testid="playbook" data-call-id={callId} />
  ),
}));

import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";

const baseProps = {
  propertyName: "The Sample Hotel",
  callId: "call-42",
  muted: false,
  roomNumber: "",
  notes: "",
  timeZone: null as string | null,
  emergencyActive: false,
  emergencyFailed: false,
  onToggleMute: vi.fn(),
  onHangUp: vi.fn(),
  onTriggerEmergency: vi.fn(),
  onRoomNumberChange: vi.fn(),
  onNotesChange: vi.fn(),
  onSaveNotes: vi.fn().mockResolvedValue(true),
};

afterEach(() => cleanup());

describe("AudioCallOverlay", () => {
  it("shows the property name and the playbook (with the call id)", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.getByText(/On call · The Sample Hotel/i)).toBeTruthy();
    expect(screen.getByTestId("playbook").getAttribute("data-call-id")).toBe("call-42");
  });

  it("calls onToggleMute and onHangUp from the control bar", async () => {
    const user = userEvent.setup();
    const onToggleMute = vi.fn();
    const onHangUp = vi.fn();
    render(<AudioCallOverlay {...baseProps} onToggleMute={onToggleMute} onHangUp={onHangUp} />);
    await user.click(screen.getByText("Mute"));
    await user.click(screen.getByText("Hang up"));
    expect(onToggleMute).toHaveBeenCalledOnce();
    expect(onHangUp).toHaveBeenCalledOnce();
  });

  it("relays room-number edits via onRoomNumberChange", async () => {
    const user = userEvent.setup();
    const onRoomNumberChange = vi.fn();
    render(<AudioCallOverlay {...baseProps} onRoomNumberChange={onRoomNumberChange} />);
    await user.type(screen.getByPlaceholderText("Room #"), "5");
    expect(onRoomNumberChange).toHaveBeenCalledWith("5");
  });

  it("shows the emergency banner and locks the 911 button when active", () => {
    render(<AudioCallOverlay {...baseProps} emergencyActive />);
    expect(screen.getByText(/Emergency active/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /911 active/i })).toHaveProperty("disabled", true);
  });

  it("shows hotel local time only when a timezone is provided", () => {
    const { rerender } = render(<AudioCallOverlay {...baseProps} timeZone={null} />);
    expect(screen.queryByText(/hotel local time/i)).toBeNull();
    rerender(<AudioCallOverlay {...baseProps} timeZone="America/New_York" />);
    expect(screen.getByText(/hotel local time/i)).toBeTruthy();
  });

  it("hides local time for an invalid timezone (no crash)", () => {
    render(<AudioCallOverlay {...baseProps} timeZone="Not/AZone" />);
    expect(screen.queryByText(/hotel local time/i)).toBeNull();
  });

  it("saves notes on Enter and shows a saved indicator", async () => {
    const user = userEvent.setup();
    const onSaveNotes = vi.fn().mockResolvedValue(true);
    render(<AudioCallOverlay {...baseProps} notes="towels" onSaveNotes={onSaveNotes} />);
    await user.type(screen.getByPlaceholderText("Call notes"), "{Enter}");
    expect(onSaveNotes).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByLabelText(/saved/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run the test, verify the new cases fail**

Run: `pnpm -F @lc/portal test -- audio-call-overlay`
Expected: FAIL on the local-time and save tests (old component has neither).

- [ ] **Step 3: Rewrite `audio-call-overlay.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, AlertTriangle, CornerDownLeft, Check, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PlaybookPanel } from "@/components/call/playbook-panel";

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioCallOverlay({
  propertyName,
  callId,
  muted,
  roomNumber,
  notes,
  timeZone,
  emergencyActive,
  emergencyFailed,
  onToggleMute,
  onHangUp,
  onTriggerEmergency,
  onRoomNumberChange,
  onNotesChange,
  onSaveNotes,
}: {
  readonly propertyName: string;
  readonly callId: string;
  readonly muted: boolean;
  readonly roomNumber: string;
  readonly notes: string;
  readonly timeZone: string | null;
  readonly emergencyActive: boolean;
  readonly emergencyFailed: boolean;
  readonly onToggleMute: () => void;
  readonly onHangUp: () => void;
  readonly onTriggerEmergency: () => void;
  readonly onRoomNumberChange: (value: string) => void;
  readonly onNotesChange: (value: string) => void;
  readonly onSaveNotes: () => Promise<boolean>;
}) {
  // Call duration — self-tracked from mount (≈ answer time; not server-authoritative).
  const startRef = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startRef.current) / 1000));

  // Hotel local time — formatter memoized per timezone; invalid tz → null → hidden.
  const fmt = useMemo(() => {
    if (!timeZone) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [timeZone]);
  const localTime = fmt ? fmt.format(new Date(now)) : null;

  // Explicit in-call notes save (Enter). The post-call durability banner in the
  // softphone remains the backstop; here we give immediate in-field feedback.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  async function handleSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    const ok = await onSaveNotes();
    setSaveState(ok ? "saved" : "failed");
    if (ok) {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }
  }
  function onKeyDownSave(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* SHARED-CHROME SEAM: this overlay mirrors the video overlay's chrome
          (components/video-call/video-call.tsx). If they drift further, extract a
          shared <CallShell>. The audio card (left) replaces the video stage. */}

      {/* Header — live beacon + property; 911 alone, top-right corner. */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          On call{propertyName ? ` · ${propertyName}` : ""}
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={emergencyActive}
              className="flex items-center gap-1.5 rounded-button bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50"
            >
              <AlertTriangle size={15} /> {emergencyActive ? "911 active" : "Call 911"}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Call emergency services (911)?</AlertDialogTitle>
              <AlertDialogDescription>
                This conferences 911 into the live call — the guest, you, and the dispatcher on one line — and logs a high-priority incident.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Not life-threatening? Cancel and use the property&apos;s local non-emergency number instead. Only continue for a genuine emergency.
            </div>
            {/* FORWARD-COMPAT SEAM: when the on-call-manager notify feature lands (cut from v1), add an
                "also alerts the admin, owner, and property GM" line above. Don't render it until the
                backend actually sends those alerts. */}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onTriggerEmergency} className="bg-destructive text-destructive-foreground">
                Yes — call 911
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Emergency banners — unchanged. */}
      {emergencyActive && !emergencyFailed && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Emergency active — 911 is being conferenced in. Stay on the line and relay the property
          address and room number.
        </div>
      )}
      {emergencyFailed && (
        <div className="border-b border-destructive bg-destructive/15 px-4 py-2 text-sm font-medium text-destructive">
          911 dispatch failed. Relay the property address and room number verbally, and have the guest
          hang up and dial 911 directly.
        </div>
      )}

      {/* Body — call card (~37%) + playbook (~63%). */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex basis-[37%] flex-col bg-[var(--color-call)] px-4 pb-6 pt-4 text-white">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            On call · <span className="font-mono tracking-normal">{formatElapsed(elapsed)}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-center text-[15px] font-semibold">{propertyName}</p>
            {/* Calm presence pulse — decorative; honors reduced-motion via the global net. */}
            <span className="relative grid size-14 place-items-center" aria-hidden="true">
              <span className="lc-seam-drift absolute inset-0 rounded-full opacity-60 blur-[2px]" />
              <span className="relative size-6 rounded-full bg-live shadow-[0_0_18px_var(--color-live-glow)]" />
            </span>
            {localTime && (
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-live">Hotel local time</div>
                <div className="mt-0.5 font-mono text-2xl font-extrabold uppercase tracking-wide">{localTime}</div>
              </div>
            )}
          </div>
        </div>
        <PlaybookPanel callId={callId} basis="basis-[63%]" />
      </div>

      {/* Control bar — Room#/Notes (left, Enter-to-save) · Mute/Hang up (right). */}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card p-3">
        <div className="flex flex-1 items-center gap-2" style={{ maxWidth: 560 }}>
          <input
            value={roomNumber}
            onChange={(e) => onRoomNumberChange(e.target.value)}
            onKeyDown={onKeyDownSave}
            placeholder="Room #"
            className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <div className="relative flex flex-1 items-center">
            <input
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onKeyDown={onKeyDownSave}
              placeholder="Call notes"
              className="w-full rounded-input border border-border bg-background py-2 pl-3 pr-9 text-sm text-foreground"
            />
            <span
              className="pointer-events-none absolute right-2.5 flex items-center"
              aria-label={
                saveState === "saving" ? "Saving notes"
                : saveState === "saved" ? "Notes saved"
                : saveState === "failed" ? "Notes save failed — retries after the call"
                : "Press Enter to save notes"
              }
            >
              {saveState === "saving" ? (
                <Loader2 size={16} className="animate-spin text-text-muted motion-reduce:animate-none" />
              ) : saveState === "saved" ? (
                <Check size={16} className="text-live-foreground" />
              ) : saveState === "failed" ? (
                <AlertTriangle size={15} className="text-destructive" />
              ) : (
                <CornerDownLeft size={16} className="text-text-muted" />
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className="flex items-center gap-1 rounded-button border border-border px-3 py-2 text-sm text-foreground"
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={onHangUp}
            className="flex items-center gap-1.5 rounded-button bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <PhoneOff size={16} /> Hang up
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the overlay tests, verify they pass**

Run: `pnpm -F @lc/portal test -- audio-call-overlay`
Expected: PASS (all cases, incl. local-time + save).

- [ ] **Step 5: Wire `softphone.tsx`** — three edits.

(a) `saveNotes` returns a boolean. In its `useCallback`, replace the `if (res && res.ok) {…} else {…}` tail with:

```ts
      const ok = !!res && res.ok;
      if (ok) {
        setNotesSave("idle");
        setPendingNotes(null);
      } else {
        setNotesSave("failed");
        setPendingNotes(payload);
      }
      return ok;
```

…and widen the callback's type so the return is `Promise<boolean>` (it's inferred — no signature change needed; existing `void saveNotes(...)` callers are unaffected).

(b) Capture the timezone. Add state near the other `useState`s:

```ts
  const [callTimeZone, setCallTimeZone] = useState<string | null>(null);
```

In `acceptCall`, read the `answered` response body and store it (replace the existing `await reliableFetch(... "/api/twilio/voice/answered" ...)` call):

```ts
    const ans = await reliableFetch(
      "/api/twilio/voice/answered",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: callIdRef.current }),
      },
      { label: "calls.answered" },
    );
    if (ans && ans.ok) {
      const data = (await ans.json().catch(() => null)) as { timeZone?: string | null } | null;
      if (data && typeof data.timeZone === "string") setCallTimeZone(data.timeZone);
    }
```

In `endCall`, clear it alongside the other resets (next to `setEmergencyFailed(false);`):

```ts
    setCallTimeZone(null);
```

(c) Add the explicit-save handler (after `saveNotes` is defined) and pass the new props. Handler:

```ts
  const saveNotesNow = useCallback(async (): Promise<boolean> => {
    const id = callIdRef.current;
    const room = roomNumberRef.current;
    const note = notesRef.current;
    if (!id || (!room && !note)) return true;
    return saveNotes({ callId: id, roomNumber: room, notes: note });
  }, [saveNotes]);
```

Update the `<AudioCallOverlay … />` render to pass `timeZone` and `onSaveNotes`:

```tsx
        <AudioCallOverlay
          propertyName={incomingProperty}
          callId={callIdRef.current}
          muted={muted}
          roomNumber={roomNumber}
          notes={notes}
          timeZone={callTimeZone}
          emergencyActive={emergencyActive}
          emergencyFailed={emergencyFailed}
          onToggleMute={toggleMute}
          onHangUp={() => void endCall()}
          onTriggerEmergency={() => void triggerEmergency()}
          onRoomNumberChange={setRoomNumber}
          onNotesChange={setNotes}
          onSaveNotes={saveNotesNow}
        />
```

- [ ] **Step 6: Typecheck + full overlay test + lint**

Run: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test -- audio-call-overlay && pnpm -F @lc/portal lint`
Expected: all green.

- [ ] **Step 7: Visual verification** — render the overlay in a Playwright harness (reuse the brand-asset verification pattern: a standalone HTML served over a local static server, or a tiny Storybook-less mount). Confirm against the approved mockup: 911 top-right, navy card with small duration + hotel name + presence pulse + bold HOTEL LOCAL TIME, control bar Room#/Notes (in-field ⏎) + Mute/Hang up. Check the saved (✓ mint) and emergency-active states.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/components/softphone/audio-call-overlay.tsx apps/portal/components/softphone/softphone.tsx apps/portal/tests/components/audio-call-overlay.test.tsx
git commit -m "feat(softphone): redesign audio in-call overlay (brand polish)

911 to the top-right corner alone; Room#/Notes + Mute/Hang up
reorganized control bar; navy call card with self-tracked duration +
hotel local time (from the answered route) + press-Enter-to-save notes
with inline feedback. All call/emergency/notes-durability logic unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Full portal suite + checks**

Run: `pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal lint && pnpm -F @lc/portal build`
Expected: all green; build emits `/icon.svg` + `/apple-icon`.

- [ ] **Step 2: Repo-root checks** (CI parity)

Run: `pnpm lint && pnpm check:routes`
Expected: green (no new dynamic-route casts were added; `tests/` lints clean under the root `eslint .`).

- [ ] **Step 3: Confirm no out-of-scope diff** — `git diff main --stat` should touch only: the 6 brand SVGs + `wordmark.tsx` (Task 0, already committed), `app/icon.svg`, `app/apple-icon.tsx`, `app/layout.tsx`, `answered/route.ts` + its test, `audio-call-overlay.tsx` + its test, `softphone.tsx`, and the spec/plan docs. **No** `video-call.tsx`, no migrations, no RLS.

- [ ] **Step 4: Deploy + prod audio smoke (required, post-merge)** — place a real audio call to the pilot property and confirm:
  - Call connects; the overlay shows the navy card.
  - **Hotel local time** renders and ticks (matches the property's configured timezone).
  - The **call duration** ticks.
  - Type a note, press **Enter** → inline `✓ Saved`; verify the note row lands in the DB.
  - **Mute / Unmute** works; **Hang up** ends the call; the **Call 911** confirm dialog opens (do **not** complete it unless using the 933 test number).
  - No regression in the emergency/notes-durability banners.

---

## Self-review notes

- **Spec coverage:** favicon (Task 1), local time via answered route (Task 2 + 3b), Enter-to-save (Task 3), call timer (Task 3), layout reorg (Task 3), audio-only scope / video untouched (Task 4 step 3). ✓
- **No video changes**, no migrations, no new routes, no RLS — enforced by Task 4 step 3.
- **Type consistency:** `onSaveNotes: () => Promise<boolean>`, `timeZone: string | null`, `saveNotesNow`, `callTimeZone` used consistently across overlay + softphone. The `answered` route's `{ timeZone }` body shape matches what `acceptCall` reads.
