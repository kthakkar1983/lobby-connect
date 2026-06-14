# Audio In-Call Overlay + Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the property playbook during an audio call and unify the audio in-call screen across the agent and admin portals via one shared full-screen overlay (mirroring the existing video overlay).

**Architecture:** A new presentational `AudioCallOverlay` is rendered by the shared `Softphone` component when `phase === "in-call"` (replacing the inline in-call card section). Because the overlay is a document-level `fixed inset-0` element rendered by the one shared component, it is identical in both portals. It reuses the existing `PlaybookPanel` (moved to a neutral `components/call/` and given a width-override prop) and the existing `GET /api/calls/[id]/playbook` route. All call/notes/emergency state and handlers stay in `Softphone`, so the 6c emergency-conference control routing and the notes-durability mechanism are preserved unchanged. No migrations, no new routes.

**Tech Stack:** Next.js (App Router) + React 19, TypeScript, Tailwind v4 brand tokens, shadcn primitives (`alert-dialog`), lucide-react, Vitest + @testing-library/react (jsdom config for component tests), pnpm monorepo (`@lc/portal`).

**Reference files (read before starting):**
- Spec: `docs/specs/2026-06-13-audio-incall-overlay-playbook-design.md`
- Video overlay (chrome to mirror): `apps/portal/components/video-call/video-call.tsx`
- Current softphone in-call block to replace: `apps/portal/components/softphone/softphone.tsx:407-489`
- Test conventions + how `in-call` is reached: `apps/portal/tests/components/softphone.test.tsx`

**Commands (run from repo root):**
- Single component test: `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <path>`
- Portal tests (both configs): `pnpm --filter @lc/portal test`
- Typecheck: `pnpm --filter @lc/portal typecheck`
- Lint: `pnpm --filter @lc/portal lint`

---

## Task 1: Move `PlaybookPanel` to `components/call/` and add a width-override prop

The playbook viewer is no longer video-specific. Move it to a neutral home and let callers override its
flex-basis (video keeps 60%; audio will use 75%). Pure refactor — guarded by the existing suite +
typecheck (testing a className string is low-value, so no new unit test here).

**Files:**
- Move: `apps/portal/components/video-call/playbook-panel.tsx` → `apps/portal/components/call/playbook-panel.tsx`
- Modify: the moved `playbook-panel.tsx` (add `basis` prop)
- Modify: `apps/portal/components/video-call/video-call.tsx:12` (import path)

- [ ] **Step 1: Move the file with git**

Run: `git mv apps/portal/components/video-call/playbook-panel.tsx apps/portal/components/call/playbook-panel.tsx`

- [ ] **Step 2: Add the `basis` prop (default preserves current 60%)**

In `apps/portal/components/call/playbook-panel.tsx`, change the signature and apply `basis` to the root
`<div>` of **all four** return branches (`loading`, `no-playbook`, `error`, `ready`). Replace the
hardcoded `basis-3/5` with the prop.

Signature:

```tsx
export function PlaybookPanel({
  callId,
  basis = "basis-3/5",
}: {
  callId: string;
  basis?: string;
}) {
```

Each branch's root `<div>` changes from `className="flex basis-3/5 ...">` to a template literal. The four
roots become:

```tsx
// loading
<div className={`flex ${basis} flex-col gap-2 bg-background p-4 border-l border-border`}>
// no-playbook
<div className={`flex ${basis} items-center justify-center border-l border-border bg-card text-sm text-text-muted`}>
// error
<div className={`flex ${basis} items-center justify-center border-l border-border bg-card text-sm text-text-muted`}>
// ready
<div className={`flex ${basis} flex-col border-l border-border bg-card`}>
```

Leave the iframe `sandbox` comment + everything else untouched.

- [ ] **Step 3: Update the video overlay's import**

In `apps/portal/components/video-call/video-call.tsx`, change line 12 from:

```tsx
import { PlaybookPanel } from "./playbook-panel";
```

to:

```tsx
import { PlaybookPanel } from "@/components/call/playbook-panel";
```

Leave the `<PlaybookPanel callId={callId} />` usage as-is (it uses the default `basis-3/5` → video output unchanged).

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test`
Expected: PASS (same test count as before; video overlay output unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/call/playbook-panel.tsx apps/portal/components/video-call/video-call.tsx
git commit -m "refactor: move PlaybookPanel to components/call + add basis override prop"
```

---

## Task 2: Create the `AudioCallOverlay` presentational component (TDD)

A pure presentational overlay — all data and handlers come in as props (owned by `Softphone`). Mirrors
the video overlay's chrome; ~25% call-info rail / ~75% playbook.

**Files:**
- Create: `apps/portal/components/softphone/audio-call-overlay.tsx`
- Test: `apps/portal/tests/components/audio-call-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/components/audio-call-overlay.test.tsx`. `PlaybookPanel` is stubbed so this is a
true unit test of the overlay (no fetch).

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  emergencyActive: false,
  emergencyFailed: false,
  onToggleMute: vi.fn(),
  onHangUp: vi.fn(),
  onTriggerEmergency: vi.fn(),
  onRoomNumberChange: vi.fn(),
  onNotesChange: vi.fn(),
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/audio-call-overlay.test.tsx`
Expected: FAIL — cannot resolve `@/components/softphone/audio-call-overlay`.

- [ ] **Step 3: Implement the overlay**

Create `apps/portal/components/softphone/audio-call-overlay.tsx`:

```tsx
"use client";

import { Mic, MicOff, Phone, PhoneOff, AlertTriangle } from "lucide-react";
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

export function AudioCallOverlay({
  propertyName,
  callId,
  muted,
  roomNumber,
  notes,
  emergencyActive,
  emergencyFailed,
  onToggleMute,
  onHangUp,
  onTriggerEmergency,
  onRoomNumberChange,
  onNotesChange,
}: {
  readonly propertyName: string;
  readonly callId: string;
  readonly muted: boolean;
  readonly roomNumber: string;
  readonly notes: string;
  readonly emergencyActive: boolean;
  readonly emergencyFailed: boolean;
  readonly onToggleMute: () => void;
  readonly onHangUp: () => void;
  readonly onTriggerEmergency: () => void;
  readonly onRoomNumberChange: (value: string) => void;
  readonly onNotesChange: (value: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header strip — mirrors the video overlay's "On video · …". */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          On call · {propertyName}
        </span>
      </div>

      {/* Emergency banner — full-width, life-safety prominence. */}
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

      {/* Body — ~25% call-info rail (deep-navy --color-call) / ~75% playbook. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex basis-1/4 flex-col items-center justify-center gap-3 bg-[var(--color-call)] p-6 text-center text-white">
          <span
            aria-hidden="true"
            className="lc-seam-drift absolute h-20 w-20 rounded-full opacity-40 blur-md"
          />
          <span className="relative grid size-14 place-items-center rounded-full border-2 border-white/20 bg-white/5">
            <Phone size={22} />
          </span>
          <p className="relative text-lg font-medium">{propertyName}</p>
          <p className="relative text-sm text-white/70">On call</p>
        </div>
        <PlaybookPanel callId={callId} basis="basis-3/4" />
      </div>

      {/* Control bar — mirrors the video overlay's bottom bar. */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input
          value={roomNumber}
          onChange={(e) => onRoomNumberChange(e.target.value)}
          placeholder="Room #"
          className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <input
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Call notes"
          className="flex-1 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
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
          className="flex items-center gap-1.5 rounded-button bg-accent-strong px-3 py-2 text-[1.1875rem] font-bold leading-none text-accent-foreground"
        >
          <PhoneOff size={18} /> Hang up
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={emergencyActive}
              className="flex items-center gap-2 rounded-button bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              <AlertTriangle size={16} /> {emergencyActive ? "911 active" : "Call 911 — emergency"}
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
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onTriggerEmergency}
                className="bg-destructive text-destructive-foreground"
              >
                Yes — call 911
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/audio-call-overlay.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/softphone/audio-call-overlay.tsx apps/portal/tests/components/audio-call-overlay.test.tsx
git commit -m "feat: AudioCallOverlay — shared in-call surface with playbook"
```

---

## Task 3: Render `AudioCallOverlay` from `Softphone` on `in-call` (TDD)

Replace the inline in-call block with the overlay. State/handlers stay in `Softphone`, so mute/hang-up
keep routing through the existing handlers (preserving the 6c emergency-conference control path), and the
notes-durability `pendingNotes` banner (rendered above the phase blocks) is untouched. The two existing
softphone tests are regression guards — they keep finding `"Room #"` / `"Call notes"` because the overlay
reuses those exact placeholders.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx` (import, in-call block, remove now-unused imports)
- Modify: `apps/portal/tests/components/softphone.test.tsx` (handle playbook fetch in the shared mock + add an overlay-render test)

- [ ] **Step 1: Add the playbook URL to the shared fetch mock + write the failing test**

In `apps/portal/tests/components/softphone.test.tsx`, update the `beforeEach` `fetchMock` so the
`PlaybookPanel` fetch (fired when the overlay mounts) resolves cleanly. Change the implementation to:

```tsx
fetchMock = vi.fn().mockImplementation((url: string) => {
  if (url === "/api/twilio/token") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: "test-token" }),
    });
  }
  if (url.endsWith("/playbook")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ hasPlaybook: false }),
    });
  }
  // presence, answered, notes, emergency
  return Promise.resolve({ ok: true });
});
```

Then add a new test at the end of the `describe` block:

```tsx
it("renders the unified in-call overlay (with the playbook) after answering", async () => {
  const user = userEvent.setup();
  render(<Softphone role="AGENT" />);
  await waitFor(() => screen.getByText(/Ready — accepting calls/i));
  await act(async () => twilio.fireIncoming());
  await user.click(screen.getByText("Accept"));

  // Overlay chrome appears with the property name from the incoming call.
  await waitFor(() => screen.getByText(/On call · The Sample Hotel/i));
  // The in-call controls (now inside the overlay) are still present.
  expect(screen.getByPlaceholderText("Room #")).toBeTruthy();
  expect(screen.getByText("Hang up")).toBeTruthy();
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/softphone.test.tsx`
Expected: FAIL — `/On call · The Sample Hotel/` not found (overlay not wired yet).

- [ ] **Step 3: Import the overlay in `softphone.tsx`**

Add to the imports at the top of `apps/portal/components/softphone/softphone.tsx`:

```tsx
import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";
```

- [ ] **Step 4: Replace the inline in-call block**

In `apps/portal/components/softphone/softphone.tsx`, replace the entire `{phase === "in-call" && ( … )}`
block (currently lines ~407-489, from the opening `{phase === "in-call" && (` through its closing `)}`)
with:

```tsx
{phase === "in-call" && (
  <AudioCallOverlay
    propertyName={incomingProperty}
    callId={callIdRef.current}
    muted={muted}
    roomNumber={roomNumber}
    notes={notes}
    emergencyActive={emergencyActive}
    emergencyFailed={emergencyFailed}
    onToggleMute={toggleMute}
    onHangUp={() => void endCall()}
    onTriggerEmergency={() => void triggerEmergency()}
    onRoomNumberChange={setRoomNumber}
    onNotesChange={setNotes}
  />
)}
```

- [ ] **Step 5: Remove now-unused imports**

The in-call block was the only user of these imports in `softphone.tsx`. Remove them (keep `Phone` and
`PhoneOff` — still used by the idle/incoming states):
- From `lucide-react`: remove `Mic`, `MicOff`, `AlertTriangle`.
- Remove the entire `AlertDialog`/`AlertDialogAction`/`AlertDialogCancel`/`AlertDialogContent`/`AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogHeader`/`AlertDialogTitle`/`AlertDialogTrigger` import block.

(Lint in Step 6 will fail on any that are actually still referenced — if so, keep that one.)

- [ ] **Step 6: Run typecheck, lint, and the portal tests**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test`
Expected: PASS — the two original softphone tests still pass (placeholders preserved), plus the new
overlay test; no unused-import lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/softphone/softphone.tsx apps/portal/tests/components/softphone.test.tsx
git commit -m "feat: render unified AudioCallOverlay on in-call (agent + admin)"
```

---

## Task 4: Full verification + docs

- [ ] **Step 1: Full gate**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test && pnpm --filter @lc/portal build`
Expected: all green; `next build` succeeds.

- [ ] **Step 2: Update build status docs**

In `CLAUDE.md`, add a row to the build-status table for this feature (audio in-call overlay + playbook;
shared overlay across agent/admin; reused route + `PlaybookPanel`; zero migrations/routes; branch
`feat/audio-incall-overlay-playbook`). In `memory/project-status.md`, append a short session entry
recording what shipped and that prod voice smoke is pending (voice is prod-only).

- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md memory/project-status.md
git commit -m "docs: record audio in-call overlay + playbook"
```

- [ ] **Step 4: Hand off for review + merge**

Use `superpowers:finishing-a-development-branch` to choose merge/PR. Then the prod **voice smoke**
(voice is prod-only): answer an audio call as agent → overlay + playbook appear; repeat as admin →
identical overlay; 911 dialog still conferences; hang-up tears down and saves notes; a property with no
playbook shows "No playbook uploaded yet."

---

## Self-review notes

- **Spec coverage:** playbook on audio (Tasks 2-3, reuses route + `PlaybookPanel`); unified overlay both
  portals (Task 3, shared component); ~25/75 split (Task 1 `basis` prop + Task 2 rail); mirror video chrome
  / don't change video output (Task 1 import-only + Task 2 same tokens); emergency routing + notes
  durability preserved (Task 3 reuses handlers, leaves `pendingNotes` untouched); incoming stays inline
  (Task 3 only replaces the in-call block); tests (Tasks 2-3). All covered.
- **Spec correction:** the spec said `PlaybookPanel` is "reused unchanged" — it actually gains one
  backward-compatible `basis` prop (default = current 60%) so audio can request 75%. Video output is
  unchanged. (Spec wording updated to match.)
- **Type/name consistency:** prop names (`onToggleMute`/`onHangUp`/`onTriggerEmergency`/`onRoomNumberChange`/
  `onNotesChange`) match between Task 2's component and Task 3's call site; placeholders `"Room #"` /
  `"Call notes"` match the existing tests; `basis` default `"basis-3/5"` matches video's prior hardcoded value.
