# Duty column + call-surface polish — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the dashboard's dead right column with a shift card and world clocks, make the softphone's decorative ring the go-on-duty control, empty the header of duty chrome, and rework both in-call control bars behind one shared `<CallShell>`.

**Architecture:** UI/composition only. Three new presentational cards in the existing 340px aside; one new prompt provider mounted in the app shell; one shared button component replacing five hand-rolled copies; one shared call shell replacing duplicated overlay chrome. No new API routes, no migrations, no RLS changes, and no change to duty semantics (`profiles.status` server-truth), call routing, or 911 machinery.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4 (`@theme` tokens in `apps/portal/app/globals.css`), shadcn primitives in `components/ui/`, Vitest (node + jsdom projects), Testing Library.

**Spec:** `docs/specs/2026-07-19-duty-column-and-call-surface-polish-design.md` — read it before starting. Section references below (§3.2, D16, …) point into it.

---

## Conventions for every task

**Test commands.** The portal has two Vitest projects:

| Tests | Location | Command |
|---|---|---|
| Node (pure logic) | `tests/**/*.test.ts`, excluding `tests/components/**` | `pnpm -F @lc/portal exec vitest run <path>` |
| jsdom (components) | `tests/components/**/*.test.tsx` | `pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts <path>` |

Full portal suite (both projects): `pnpm -F @lc/portal test`

**Gate before every commit:** `pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint`

**House rules** (from `CLAUDE.md`):
- **Never hardcode hex colors.** Use Tailwind tokens — `bg-primary`, `text-text-muted`, `border-border`, `bg-live`, `bg-accent`, `text-attention-text`.
- **No emojis** in code or commit messages.
- **Never `git add -A`** — `analysis-and-audit-2026_07_11/` is untracked on purpose (prior key leak). Stage explicit paths.
- Branch off `main`. Merging to `main` **auto-deploys prod** via Coolify — do not merge until the smoke pass in Task 17.

**Duty context API** (`components/dashboard/duty-provider.tsx`) — you will use this repeatedly:

```ts
type DutyState = {
  onDuty: boolean; onBreak: boolean; shiftStartedAt: string | null;
  accepting: boolean; canWork: boolean; hydrated: boolean; pushBlocked: boolean;
  goOnDuty: () => Promise<void>; endShift: () => Promise<void>;
  takeBreak: () => Promise<void>; resume: () => Promise<void>;
  setAccepting: (value: boolean) => void;
  // ...registerPrime, registerBeat, refreshFromServer, markOffDuty
};
useDuty(): DutyState          // throws outside the provider
useDutyOptional(): DutyState | null
```

`canWork === onDuty && !onBreak`.

---

## File structure

**New files**

| Path | Responsibility |
|---|---|
| `lib/clocks/zone-time.ts` | Pure: instant + IANA zone → `{hours, minutes, isNight}` and clock-hand angles |
| `components/dashboard/off-duty-prompt.tsx` | One provider + one dialog + `useDutyGuard()`; the only off-duty interception point |
| `components/dashboard/property-action-button.tsx` | The shared gated property-action button (5 call sites) |
| `components/dashboard/shift-card.tsx` | Shift clock + break/end-shift, three states |
| `components/dashboard/zone-clocks-card.tsx` | Four analog faces with day/night tinting |
| `components/call/call-shell.tsx` | Shared in-call chrome: header, stage slot, playbook slot, control bar |

**Modified files**

| Path | Change |
|---|---|
| `components/app-shell.tsx` | Mount `OffDutyPromptProvider` |
| `components/dashboard-workspace.tsx` | Remove `DutyControl` from the header; add the two new cards to the aside |
| `components/dashboard/connect-button.tsx` | Reimplement on `PropertyActionButton` |
| `components/dashboard/kiosk-call-button.tsx` | Reimplement on `PropertyActionButton` |
| `components/dashboard/property-card.tsx` | Drop the `answerGated` label swap; uniform button size; reserved action row; bottom-anchored actions |
| `components/dashboard/duty-control.tsx` | Delete — superseded by `shift-card.tsx` + the softphone ring |
| `components/softphone/softphone.tsx` | Ring becomes the duty control off duty; `Not accepting calls` |
| `components/softphone/audio-call-overlay.tsx` | Adopt `<CallShell>`; control-bar rework |
| `components/video-call/video-call.tsx` | Adopt `<CallShell>`; control-bar rework; round corner reopen button |
| `components/call-tile/call-tile.tsx` | Connect → `PropertyActionButton` |
| `lib/video/livekit-session.ts` | `RoomEvent.Disconnected` → Sentry on unexpected disconnect |

---

# Phase A — Shared primitives

No user-visible change lands in this phase. Both components are built and tested before anything consumes them.

---

### Task 1: Off-duty prompt provider and duty guard

Implements spec §3.4. One dialog for the whole app, not one per button.

**Files:**
- Create: `apps/portal/components/dashboard/off-duty-prompt.tsx`
- Create: `apps/portal/tests/components/off-duty-prompt.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/components/off-duty-prompt.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OffDutyPromptProvider, useDutyGuard } from "@/components/dashboard/off-duty-prompt";

afterEach(cleanup);

let dutyValue: { canWork: boolean; goOnDuty: () => Promise<void> } | null = null;
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDutyOptional: () => dutyValue,
}));

function Probe({ onRun }: { readonly onRun: () => void }) {
  const { gated, guard } = useDutyGuard();
  return (
    <button type="button" data-gated={gated} onClick={() => guard(onRun)}>
      act
    </button>
  );
}

function setup(canWork: boolean, goOnDuty = vi.fn().mockResolvedValue(undefined)) {
  dutyValue = { canWork, goOnDuty };
  const onRun = vi.fn();
  render(
    <OffDutyPromptProvider>
      <Probe onRun={onRun} />
    </OffDutyPromptProvider>,
  );
  return { onRun, goOnDuty };
}

describe("useDutyGuard", () => {
  it("runs the action straight through when on duty", () => {
    const { onRun } = setup(true);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("blocks the action and opens the prompt when off duty", () => {
    const { onRun } = setup(false);
    fireEvent.click(screen.getByText("act"));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("reports gated so callers can style the control", () => {
    setup(false);
    expect(screen.getByText("act").getAttribute("data-gated")).toBe("true");
  });

  it("starts the shift from the prompt without running the original action", async () => {
    const { onRun, goOnDuty } = setup(false);
    fireEvent.click(screen.getByText("act"));
    fireEvent.click(screen.getByRole("button", { name: "Start my shift" }));
    expect(goOnDuty).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("treats a missing duty provider as not gated", () => {
    dutyValue = null;
    const onRun = vi.fn();
    render(
      <OffDutyPromptProvider>
        <Probe onRun={onRun} />
      </OffDutyPromptProvider>,
    );
    fireEvent.click(screen.getByText("act"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/off-duty-prompt.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/dashboard/off-duty-prompt"`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/components/dashboard/off-duty-prompt.tsx`:

```tsx
"use client";

// One off-duty prompt for the whole shell (spec §3.4). Gated controls stay
// ENABLED and focusable -- a `disabled` button fires no click event, so it
// cannot be intercepted, and it gives touch users no feedback at all.
//
// This is PRESENTATION ONLY. The authoritative gates stay where they are:
// softphone.tsx's canWorkRef check and the server-side D13 duty check. Never
// let this become the only thing preventing an off-duty action.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDutyOptional } from "@/components/dashboard/duty-provider";

type PromptCtx = { readonly prompt: () => void };
const Ctx = createContext<PromptCtx | null>(null);

export function OffDutyPromptProvider({ children }: { readonly children: React.ReactNode }) {
  const duty = useDutyOptional();
  const [open, setOpen] = useState(false);

  const value = useMemo<PromptCtx>(() => ({ prompt: () => setOpen(true) }), []);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You&apos;re off duty</AlertDialogTitle>
            <AlertDialogDescription>
              That isn&apos;t available until your shift starts. Would you like to start it now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void duty?.goOnDuty();
              }}
            >
              Start my shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/** Gate an action on duty. `gated` is for styling; `guard` is for behaviour. */
export function useDutyGuard(): {
  readonly gated: boolean;
  readonly guard: (run: () => void) => void;
} {
  const duty = useDutyOptional();
  const ctx = useContext(Ctx);
  // No provider (e.g. owner portal) => nothing to gate.
  const gated = duty != null && !duty.canWork;

  const guard = useCallback(
    (run: () => void) => {
      if (gated) {
        ctx?.prompt();
        return;
      }
      run();
    },
    [gated, ctx],
  );

  return { gated, guard };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/off-duty-prompt.test.tsx
```

Expected: PASS, 5 tests.

If `getByRole("alertdialog")` fails, check what role the project's `AlertDialogContent` renders (Radix uses `alertdialog`); adjust the query, not the component.

- [ ] **Step 5: Mount the provider in the app shell**

In `apps/portal/components/app-shell.tsx`, add the import and wrap the existing tree. It must sit **inside** `DutyProvider` (it reads duty) and **outside** the workspace (every gated control is below it):

```tsx
import { OffDutyPromptProvider } from "@/components/dashboard/off-duty-prompt";
```

Then wrap the children of `DutyProvider` — i.e. `<DutyProvider><OffDutyPromptProvider>…existing…</OffDutyPromptProvider></DutyProvider>`.

- [ ] **Step 6: Run the gate**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/dashboard/off-duty-prompt.tsx \
        apps/portal/tests/components/off-duty-prompt.test.tsx \
        apps/portal/components/app-shell.tsx
git commit -m "feat(dashboard): off-duty prompt provider and duty guard

Gated controls stay enabled and focusable so a click can be intercepted;
a disabled button fires no click event and gives touch users no feedback.
Presentation only -- the softphone and server-side duty gates are
untouched. Spec 3.4."
```

---

### Task 2: Shared `PropertyActionButton`

Implements spec §7. Five call sites collapse onto this. Built and tested here; wired in Tasks 3 and 15.

**Files:**
- Create: `apps/portal/components/dashboard/property-action-button.tsx`
- Create: `apps/portal/tests/components/property-action-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/components/property-action-button.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";

afterEach(cleanup);

let gated = false;
const guard = vi.fn((run: () => void) => {
  if (!gated) run();
});
vi.mock("@/components/dashboard/off-duty-prompt", () => ({
  useDutyGuard: () => ({ gated, guard }),
}));

describe("PropertyActionButton", () => {
  it("runs onAction when not gated", () => {
    gated = false;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("routes the click through the duty guard instead of disabling", () => {
    gated = true;
    const onAction = vi.fn();
    render(<PropertyActionButton label="Connect" onAction={onAction} />);
    const btn = screen.getByRole("button", { name: "Connect" });
    // Critical: NOT disabled, or the guard could never intercept.
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalled();
  });

  it("stays genuinely disabled for a non-duty reason", () => {
    gated = false;
    const onAction = vi.fn();
    render(
      <PropertyActionButton
        label="Kiosk"
        unavailableLabel="Kiosk offline"
        unavailableReason="Kiosk offline"
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "Kiosk offline" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("title")).toBe("Kiosk offline");
  });

  it("renders an inline error", () => {
    gated = false;
    render(<PropertyActionButton label="Connect" onAction={vi.fn()} error="No remote access configured" />);
    expect(screen.getByRole("alert").textContent).toContain("No remote access configured");
  });

  it("keeps an accessible name when the label is visually hidden", () => {
    gated = false;
    render(<PropertyActionButton label="Reopen tile" hideLabel onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reopen tile" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/property-action-button.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/components/dashboard/property-action-button.tsx`:

```tsx
"use client";

// One button for every gated action performed against a property: Connect (to
// the hotel PC), Kiosk (outbound video to the lobby), and the in-call Connects
// on the tile and both overlays. Five hand-rolled copies previously disagreed on
// colour, icon, duty gating and error surfacing (spec §7).
//
// Two distinct kinds of unavailability, and they must not be conflated (§3.4):
//   - DUTY: stays enabled, intercepts, offers to start the shift.
//   - REAL (kiosk offline, request in flight): genuinely disabled + a reason.
// Offering "start your shift" for an offline kiosk would be a lie.

import { Button } from "@/components/ui/button";
import { useDutyGuard } from "@/components/dashboard/off-duty-prompt";
import { cn } from "@/lib/utils";

export type PropertyActionButtonProps = {
  readonly label: string;
  readonly onAction: () => void;
  /** Icon element, already rendered (Server->Client boundary safety). */
  readonly icon?: React.ReactNode;
  /** Non-duty unavailability. Present => genuinely disabled. */
  readonly unavailableReason?: string;
  /** Label to show while unavailable (defaults to `label`). */
  readonly unavailableLabel?: string;
  /** Inline failure message rendered under the button. */
  readonly error?: string | null;
  /** Teal for dark in-call surfaces; navy (default) for cards. */
  readonly tone?: "navy" | "teal";
  /** Icon-only: label becomes the accessible name only. */
  readonly hideLabel?: boolean;
  readonly className?: string;
};

export function PropertyActionButton({
  label,
  onAction,
  icon,
  unavailableReason,
  unavailableLabel,
  error,
  tone = "navy",
  hideLabel = false,
  className,
}: PropertyActionButtonProps) {
  const { gated, guard } = useDutyGuard();
  const unavailable = unavailableReason != null;
  const shown = unavailable ? (unavailableLabel ?? label) : label;

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={tone === "teal" ? "accent" : "neutral"}
        size="sm"
        disabled={unavailable}
        title={unavailableReason}
        aria-label={hideLabel ? label : undefined}
        onClick={() => guard(onAction)}
        className={cn(
          // No label-driven reflow: state changes must not resize a control
          // (spec §3.6a). Fixed height, never wrap.
          "h-8 whitespace-nowrap",
          gated && !unavailable && "opacity-60",
          className,
        )}
      >
        {icon}
        {hideLabel ? <span className="sr-only">{label}</span> : shown}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/property-action-button.test.tsx
```

Expected: PASS, 5 tests.

If `variant="accent"` does not exist on `Button`, check `components/ui/button.tsx` for the teal variant's real name and use that — do not add a hex colour.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/dashboard/property-action-button.tsx \
        apps/portal/tests/components/property-action-button.test.tsx
git commit -m "feat(dashboard): shared PropertyActionButton

Collapses five hand-rolled copies (Connect x3, Kiosk, tile Connect) onto
one control. Separates duty gating, which stays enabled so it can be
intercepted, from real unavailability like an offline kiosk, which stays
genuinely disabled with a reason. Spec 7."
```

---

# Phase B — Property card

---

### Task 3: Reimplement Connect and Kiosk on the shared button

**Files:**
- Modify: `apps/portal/components/dashboard/connect-button.tsx`
- Modify: `apps/portal/components/dashboard/kiosk-call-button.tsx`

- [ ] **Step 1: Read both files end to end**

```bash
cat apps/portal/components/dashboard/connect-button.tsx
cat apps/portal/components/dashboard/kiosk-call-button.tsx
```

Note precisely: how each obtains its action from `CallSurfaceProvider`, what error state it holds, and every disabled reason. **Preserve all of it** — this task changes presentation only.

- [ ] **Step 2: Rewrite `connect-button.tsx`'s render**

Keep every hook, handler and piece of state exactly as-is. Replace only the returned JSX:

```tsx
return (
  <PropertyActionButton
    label="Connect"
    icon={<Monitor aria-hidden="true" />}
    onAction={handleClick}
    error={error}
  />
);
```

Add `import { PropertyActionButton } from "@/components/dashboard/property-action-button";` and `import { Monitor } from "lucide-react";`.

**Delete the component's own duty gate** (its `dutyGated` computation and the "Go on duty to start" label) — `PropertyActionButton` owns that now. Do **not** delete any error state.

- [ ] **Step 3: Rewrite `kiosk-call-button.tsx`'s render**

```tsx
const unavailableReason = !kioskOnline ? "Kiosk offline" : busy ? "Starting the call…" : undefined;

return (
  <PropertyActionButton
    label="Kiosk"
    unavailableLabel={!kioskOnline ? "Kiosk offline" : undefined}
    unavailableReason={unavailableReason}
    icon={<MonitorSmartphone aria-hidden="true" />}
    onAction={handleClick}
    error={error}
  />
);
```

Keep `startOutboundVideo`, `busy`, and the error state exactly as they are. **`dutyGated` must no longer feed `disabled`** — it is now the guard's job. `!kioskOnline` and `busy` still genuinely disable (spec §3.4).

- [ ] **Step 4: Run the affected tests**

```bash
pnpm -F @lc/portal test
```

Expected: PASS. Existing tests asserting `disabled` while off duty **will fail** — that is the intended behaviour change. Update those assertions to expect an enabled button that does not invoke its action, matching Task 2's second test.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/dashboard/connect-button.tsx \
        apps/portal/components/dashboard/kiosk-call-button.tsx \
        apps/portal/tests
git commit -m "refactor(dashboard): Connect and Kiosk on PropertyActionButton

Both keep their own actions and error state; duty gating moves to the
shared guard so an off-duty click is intercepted rather than swallowed.
Kiosk offline and in-flight still genuinely disable."
```

---

### Task 4: Property card — remove the per-card duty label and gate Answer

Implements spec §3.6.

**Files:**
- Modify: `apps/portal/components/dashboard/property-card.tsx:58,123-143`
- Modify: `apps/portal/tests/components/property-card.test.tsx` (or create if absent)

- [ ] **Step 0: Read the existing test file first**

```bash
cat apps/portal/tests/components/property-card.test.tsx
```

Note the name of the helper the existing tests use to render a **ringing** card and how they supply the answer callback. The test below calls it `renderRingingCard` — substitute the real name. Do not build a second harness alongside the existing one.

- [ ] **Step 1: Write the failing test**

Add this mock at the top of the file (alongside the existing mocks):

```tsx
let gated = false;
vi.mock("@/components/dashboard/off-duty-prompt", () => ({
  useDutyGuard: () => ({
    gated,
    guard: (run: () => void) => {
      if (!gated) run();
    },
  }),
}));
```

And this test:

```tsx
it("keeps the Answer label off duty and does not answer on click", () => {
  gated = true;
  const answer = vi.fn();
  renderRingingCard({ onAnswer: answer });

  const btn = screen.getByRole("button", { name: "Answer" });
  // Not disabled -- a disabled button fires no click, so the guard could
  // never intercept it (spec §3.4).
  expect(btn.hasAttribute("disabled")).toBe(false);

  fireEvent.click(btn);
  expect(answer).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Go on duty" })).toBeNull();
});

it("answers normally when on duty", () => {
  gated = false;
  const answer = vi.fn();
  renderRingingCard({ onAnswer: answer });
  fireEvent.click(screen.getByRole("button", { name: "Answer" }));
  expect(answer).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/property-card.test.tsx
```

Expected: FAIL — the button is currently named `Go on duty` and is `disabled`.

- [ ] **Step 3: Change the Answer button**

At `property-card.tsx:129-137`, replace the gated variant:

```tsx
{ringing && canAnswer && (
  <Button
    onClick={() => guard(answer)}
    size="sm"
    className="h-8 whitespace-nowrap animate-pulse"
  >
    Answer
  </Button>
)}
```

Add `const { guard } = useDutyGuard();` near the other hooks and import it. **Delete the `answerGated` constant at line 58** and every reference to it — `pod-card-grid.tsx:42` has a duplicate of the same computation; delete that too.

- [ ] **Step 4: Normalize `Silence` to the same size**

```tsx
<Button
  variant="neutral"
  size="sm"
  onClick={() => silenceRing(ring.key)}
  disabled={silenced}
  aria-pressed={silenced}
  className="h-8 whitespace-nowrap"
>
  <BellOff aria-hidden="true" />
  {silenced ? "Silenced" : "Silence"}
</Button>
```

`Silence` genuinely disables once silenced — that is not a duty gate, so it stays `disabled` (spec §3.4).

- [ ] **Step 5: Run tests, gate, commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/dashboard/property-card.tsx \
        apps/portal/components/dashboard/pod-card-grid.tsx \
        apps/portal/tests/components/property-card.test.tsx
git commit -m "fix(dashboard): one duty gate for Answer, not a per-card label swap

Answer keeps its label off duty and routes through the shared guard.
Removes the answerGated computation duplicated in property-card and
pod-card-grid, and retires the audio/video asymmetry where video showed
a gate and audio silently no-opped. All four card actions are now h-8.
Spec 3.6, 3.6a."
```

---

### Task 5: Property card layout — reserved action row and bottom-anchored actions

Implements spec §3.6b and §3.6c. **CSS-only; not jsdom-verifiable — this is smoke-pass material (Task 17).**

**Files:**
- Modify: `apps/portal/components/dashboard/property-card.tsx`

- [ ] **Step 1: Make the card a bottom-anchored flex column**

On the card's root element, add `flex flex-col`. On the **first** action row wrapper, add `mt-auto`.

Why: the grid already stretches every card to its row height, so pinning the actions to the bottom aligns them across cards regardless of how many lines each property name takes. `Holiday Inn Express Southgate` wraps to two lines at the current card width and currently pushes its own buttons out of line (spec §3.6c). A fixed two-line name height was rejected — it breaks on three lines.

- [ ] **Step 2: Reserve the ringing action row**

`Answer` and `Silence` render only while ringing, so a ringing card is one button-row taller and CSS Grid makes its whole row taller. Worse, the card grows *at the moment the agent reaches for Answer* — a target that moves under the cursor (spec §3.6b).

**The wrapper is always present and always `h-8`; only its children are conditional.** An always-rendered but empty row cannot be focused, cannot be read by a screen reader, and needs no `invisible`, `aria-hidden` or `tabIndex` juggling — which is why this is preferred over hiding populated buttons.

Replace the ringing-actions block with exactly this:

```tsx
{/* Reserve the ringing action row so a ring changes colour and content but
    never geometry (spec §3.6b). The wrapper is always rendered at the button's
    own height, so the reservation is DERIVED from the control -- do not swap
    this for a min-height constant, because the root font scales to 112.5% at
    lg and px constants do not track the type scale. */}
<div className="mt-auto flex h-8 items-center gap-2">
  {ringing && canAnswer && (
    <Button
      onClick={() => guard(answer)}
      size="sm"
      className="h-8 whitespace-nowrap animate-pulse"
    >
      Answer
    </Button>
  )}
  {ringing && ring && (
    <Button
      variant="neutral"
      size="sm"
      onClick={() => silenceRing(ring.key)}
      disabled={silenced}
      aria-pressed={silenced}
      className="h-8 whitespace-nowrap"
    >
      <BellOff aria-hidden="true" />
      {silenced ? "Silenced" : "Silence"}
    </Button>
  )}
</div>
```

Note `mt-auto` lives on **this** wrapper — it is the first of the two action rows, so it is what pins the whole action block to the bottom for Step 1.

- [ ] **Step 3: Put the Connect/Kiosk row directly beneath it**

The `connectSlot` row follows with a small gap and **no** `mt-auto` of its own:

```tsx
<div className="mt-2 flex items-center gap-2">{connectSlot}</div>
```

- [ ] **Step 4: Run the gate**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
```

Expected: green. jsdom cannot verify any of this — it has no layout engine. Task 17 is where it gets confirmed.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/dashboard/property-card.tsx
git commit -m "fix(dashboard): uniform property-card height and aligned actions

Reserves the ringing action row so a ring never resizes the card or its
grid row -- previously the card grew under the cursor at the moment
Answer appeared. Bottom-anchors the action block so a two-line property
name cannot push its buttons out of line with neighbouring cards.
Heights derive from the control, never a pixel constant, because the root
font scales to 112.5% at lg. Spec 3.6b, 3.6c."
```

---

# Phase C — Duty column

---

### Task 6: Zone-time pure helper

Implements the data half of spec §3.7.

**Files:**
- Create: `apps/portal/lib/clocks/zone-time.ts`
- Create: `apps/portal/tests/lib/clocks/zone-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/clocks/zone-time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zoneTime, handAngles } from "@/lib/clocks/zone-time";

describe("zoneTime", () => {
  it("converts an instant into wall-clock parts for a zone", () => {
    // 2026-07-19T09:30:00Z -> 15:00 IST (UTC+5:30)
    expect(zoneTime(new Date("2026-07-19T09:30:00Z"), "Asia/Kolkata")).toEqual({
      hours: 15,
      minutes: 0,
      isNight: false,
    });
  });

  it("marks night outside 06:00-17:59 local", () => {
    // 2026-07-19T06:14:00Z -> 02:14 America/New_York (EDT, UTC-4)
    expect(zoneTime(new Date("2026-07-19T06:14:00Z"), "America/New_York")).toEqual({
      hours: 2,
      minutes: 14,
      isNight: true,
    });
  });

  it("treats 06:00 as day and 18:00 as night at the boundaries", () => {
    expect(zoneTime(new Date("2026-07-19T10:00:00Z"), "America/New_York").isNight).toBe(false); // 06:00
    expect(zoneTime(new Date("2026-07-19T22:00:00Z"), "America/New_York").isNight).toBe(true); // 18:00
  });

  it("uses a 24-hour cycle, so local midnight is hour 0 and never 24", () => {
    // 2026-07-19T04:00:00Z -> 00:00 America/New_York
    expect(zoneTime(new Date("2026-07-19T04:00:00Z"), "America/New_York").hours).toBe(0);
  });

  it("follows US daylight saving across the autumn transition", () => {
    // DST ends 2026-11-01. Same wall-clock hour, one hour of UTC apart.
    const edt = zoneTime(new Date("2026-11-01T05:30:00Z"), "America/New_York");
    const est = zoneTime(new Date("2026-11-01T06:30:00Z"), "America/New_York");
    expect(edt.hours).toBe(1);
    expect(est.hours).toBe(1);
  });

  it("keeps India fixed at UTC+5:30 across that same transition", () => {
    expect(zoneTime(new Date("2026-11-01T05:30:00Z"), "Asia/Kolkata").hours).toBe(11);
    expect(zoneTime(new Date("2026-06-01T05:30:00Z"), "Asia/Kolkata").hours).toBe(11);
  });
});

describe("handAngles", () => {
  it("puts both hands at twelve at midnight", () => {
    expect(handAngles(0, 0)).toEqual({ hour: 0, minute: 0 });
  });

  it("advances the minute hand six degrees per minute", () => {
    expect(handAngles(0, 15).minute).toBe(90);
    expect(handAngles(0, 45).minute).toBe(270);
  });

  it("creeps the hour hand between hours", () => {
    expect(handAngles(3, 0).hour).toBe(90);
    expect(handAngles(3, 30).hour).toBe(105);
  });

  it("wraps the hour hand at noon so 12-hour and 24-hour agree", () => {
    expect(handAngles(15, 0).hour).toBe(90);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run tests/lib/clocks/zone-time.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/clocks/zone-time.ts`:

```ts
// Pure wall-clock maths for the dashboard's world clocks (spec §3.7).
// No Date.now() here -- callers pass the instant so this stays testable.

export type ZoneTime = {
  readonly hours: number;
  readonly minutes: number;
  readonly isNight: boolean;
};

/** Local hours before this are night. */
const DAY_STARTS_AT = 6;
/** Local hours from this on are night. */
const NIGHT_STARTS_AT = 18;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // hourCycle h23 (not hour12:false) so local midnight is 00 and never 24.
    f = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zoneTime(instant: Date, timeZone: string): ZoneTime {
  // formatToParts, not a string split -- separators are locale-dependent.
  const parts = formatterFor(timeZone).formatToParts(instant);
  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return {
    hours,
    minutes,
    isNight: hours < DAY_STARTS_AT || hours >= NIGHT_STARTS_AT,
  };
}

export function handAngles(hours: number, minutes: number): {
  readonly hour: number;
  readonly minute: number;
} {
  return {
    hour: (hours % 12) * 30 + minutes * 0.5,
    minute: minutes * 6,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @lc/portal exec vitest run tests/lib/clocks/zone-time.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/lib/clocks/zone-time.ts apps/portal/tests/lib/clocks/zone-time.test.ts
git commit -m "feat(clocks): pure zone-time and clock-hand helpers

Takes the instant as an argument so the tests pin real DST transitions
rather than asserting against wall-clock now. hourCycle h23 keeps local
midnight at hour 0. Spec 3.7."
```

---

### Task 7: Zone clocks card

Implements the presentation half of spec §3.7.

**Files:**
- Create: `apps/portal/components/dashboard/zone-clocks-card.tsx`
- Create: `apps/portal/tests/components/zone-clocks-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/components/zone-clocks-card.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ZoneClocksCard } from "@/components/dashboard/zone-clocks-card";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ZoneClocksCard", () => {
  it("labels all four zones geographically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T06:14:00Z"));
    render(<ZoneClocksCard />);
    for (const label of ["India", "US · Eastern", "US · Central", "US · Pacific"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("exposes each time as text, so the clocks are not vision-only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T06:14:00Z"));
    render(<ZoneClocksCard />);
    // 06:14Z -> 11:44 IST, 02:14 Eastern
    expect(screen.getByText(/India 11:44/)).toBeTruthy();
    expect(screen.getByText(/US · Eastern 02:14/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/zone-clocks-card.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/components/dashboard/zone-clocks-card.tsx`:

```tsx
"use client";

// Four analog faces for the dashboard column (spec §3.7).
//
// ANALOG, not digital: the shift card directly above already carries a large
// digital mono clock, and four more numeric readouts under it read as one
// undifferentiated block.
//
// DAY/NIGHT TINTING: analog is ambiguous about AM/PM, and across a 10.5-hour
// offset "is it the middle of the night there" is the actual question. A light
// face for day and a navy one for night answers it at a glance.

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { zoneTime, handAngles } from "@/lib/clocks/zone-time";
import { cn } from "@/lib/utils";

const ZONES = [
  { label: "India", tz: "Asia/Kolkata" },
  { label: "US · Eastern", tz: "America/New_York" },
  { label: "US · Central", tz: "America/Chicago" },
  { label: "US · Pacific", tz: "America/Los_Angeles" },
] as const;

/** Minute-hand accuracy only -- do not tick per second. */
const TICK_MS = 20_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ClockFace({ label, tz, now }: { readonly label: string; readonly tz: string; readonly now: Date }) {
  const { hours, minutes, isNight } = zoneTime(now, tz);
  const { hour, minute } = handAngles(hours, minutes);

  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-button)] border border-border p-3">
      <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r="29"
          className={cn(isNight ? "fill-call stroke-muted-foreground/40" : "fill-card stroke-border")}
          strokeWidth="1.5"
        />
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 - 90) * Math.PI) / 180;
          const len = i % 3 === 0 ? 7 : 4;
          return (
            <line
              key={i}
              x1={32 + Math.cos(a) * 24}
              y1={32 + Math.sin(a) * 24}
              x2={32 + Math.cos(a) * (24 - len)}
              y2={32 + Math.sin(a) * (24 - len)}
              className={isNight ? "stroke-muted-foreground" : "stroke-muted-foreground/60"}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          );
        })}
        {([
          { deg: hour, len: 13, w: 2.6 },
          { deg: minute, len: 20, w: 1.7 },
        ] as const).map(({ deg, len, w }, i) => {
          const r = ((deg - 90) * Math.PI) / 180;
          return (
            <line
              key={i}
              x1="32"
              y1="32"
              x2={32 + Math.cos(r) * len}
              y2={32 + Math.sin(r) * len}
              className={isNight ? "stroke-background" : "stroke-primary"}
              strokeWidth={w}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="32" cy="32" r="2.2" className={isNight ? "fill-background" : "fill-primary"} />
      </svg>
      <p className="text-center font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {label}
      </p>
      <span className="sr-only">{`${label} ${pad(hours)}:${pad(minutes)}`}</span>
    </div>
  );
}

export function ZoneClocksCard() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="gap-3 p-4">
      <p className="font-label text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        Clocks
      </p>
      <div className="grid grid-cols-2 gap-3">
        {ZONES.map((z) => (
          <ClockFace key={z.tz} label={z.label} tz={z.tz} now={now} />
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/zone-clocks-card.test.tsx
```

Expected: PASS, 2 tests. If `fill-call` is not a valid utility for `--color-call`, check `globals.css` and use the correct token utility — do not inline a hex.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/dashboard/zone-clocks-card.tsx \
        apps/portal/tests/components/zone-clocks-card.test.tsx
git commit -m "feat(dashboard): world clocks card with day/night faces

Analog rather than digital so it does not compete with the shift card's
digital clock directly above. Day/night tinting answers the AM/PM
question analog otherwise loses, which is the real question across a
10.5-hour offset. Ticks every 20s. Spec 3.7."
```

---

### Task 8: Shift card

Implements spec §3.3.

**Files:**
- Create: `apps/portal/components/dashboard/shift-card.tsx`
- Create: `apps/portal/tests/components/shift-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/components/shift-card.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ShiftCard } from "@/components/dashboard/shift-card";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const duty = {
  onDuty: true,
  onBreak: false,
  shiftStartedAt: "2026-07-19T21:48:00Z",
  endShift: vi.fn().mockResolvedValue(undefined),
  takeBreak: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/components/dashboard/duty-provider", () => ({
  useDuty: () => duty,
}));

describe("ShiftCard", () => {
  it("shows the elapsed shift and both actions on duty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T02:00:05Z"));
    Object.assign(duty, { onDuty: true, onBreak: false });
    render(<ShiftCard />);
    expect(screen.getByText("4:12:05")).toBeTruthy();
    expect(screen.getByRole("button", { name: /break/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /end shift/i })).toBeTruthy();
  });

  it("offers Resume instead of Break while on a break", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T02:00:05Z"));
    Object.assign(duty, { onDuty: true, onBreak: true });
    render(<ShiftCard />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /take a break/i })).toBeNull();
  });

  it("shows a resting state off duty with no actions", () => {
    Object.assign(duty, { onDuty: false, onBreak: false, shiftStartedAt: null });
    render(<ShiftCard />);
    expect(screen.getByText("Not on duty")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ends the shift when End shift is pressed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T02:00:05Z"));
    Object.assign(duty, { onDuty: true, onBreak: false, shiftStartedAt: "2026-07-19T21:48:00Z" });
    render(<ShiftCard />);
    fireEvent.click(screen.getByRole("button", { name: /end shift/i }));
    expect(duty.endShift).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/shift-card.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/components/dashboard/shift-card.tsx`:

```tsx
"use client";

// The shift half of the duty column (spec §3.3). Everything here already
// existed in the header's DutyControl -- this relocates the controls, it does
// not change duty semantics. The presence routes are untouched.
//
// Deliberately absent: a "calls tonight" figure (already on the chart) and a
// "last shift" readout (would need net-new agent-facing plumbing for a state
// that lasts seconds -- spec D4/D5).

import { useEffect, useState } from "react";
import { Coffee, LogOut, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDuty } from "@/components/dashboard/duty-provider";

function elapsed(startedAtIso: string, now: number): string {
  const ms = Math.max(0, now - new Date(startedAtIso).getTime());
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startedAtLabel(startedAtIso: string): string {
  return new Date(startedAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ShiftCard() {
  const { onDuty, onBreak, shiftStartedAt, endShift, takeBreak, resume } = useDuty();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!onDuty) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [onDuty]);

  const label = (
    <p className="font-label text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
      Your shift
    </p>
  );

  if (!onDuty || !shiftStartedAt) {
    return (
      <Card className="gap-2 p-4">
        {label}
        <p className="text-sm text-text-muted">Not on duty</p>
      </Card>
    );
  }

  return (
    <Card className="gap-3 p-4">
      {label}
      <div>
        <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
          {elapsed(shiftStartedAt, now)}
        </p>
        <p className="mt-0.5 text-xs text-text-muted tabular-nums">
          {onBreak ? "On break" : `On duty since ${startedAtLabel(shiftStartedAt)}`}
        </p>
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        {onBreak ? (
          <Button variant="neutral" size="sm" className="h-8 flex-1 whitespace-nowrap" onClick={() => void resume()}>
            <Play aria-hidden="true" />
            Resume
          </Button>
        ) : (
          <Button variant="neutral" size="sm" className="h-8 flex-1 whitespace-nowrap" onClick={() => void takeBreak()}>
            <Coffee aria-hidden="true" />
            Break
          </Button>
        )}
        <Button variant="neutral" size="sm" className="h-8 flex-1 whitespace-nowrap" onClick={() => void endShift()}>
          <LogOut aria-hidden="true" />
          End shift
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/shift-card.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Check the mid-call End-shift rule**

Read `duty-control.tsx:83-84`. The old control **disabled `End shift` during a call** with `title="Finish the call first"`, and **hid `Take a break` entirely** mid-call. Reproduce both behaviours here — they are existing safety rules, not polish. If `useDuty()` does not expose an on-call flag, source it the same way `duty-control.tsx` did and add a test asserting `End shift` is disabled with that title while on a call.

- [ ] **Step 6: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/dashboard/shift-card.tsx \
        apps/portal/tests/components/shift-card.test.tsx
git commit -m "feat(dashboard): shift card with clock, break and end shift

Relocates the header's duty controls into the column. End shift becomes a
labelled button with its own icon instead of hiding behind a chevron
dropdown. Preserves the mid-call rules: End shift disabled during a call,
Take a break hidden. Spec 3.3."
```

---

### Task 9: Softphone ring becomes the duty control

Implements spec §3.2.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx:814-849`
- Modify: `apps/portal/tests/components/softphone.test.tsx`

- [ ] **Step 1: Write the failing test**

**Read the file first.** `tests/components/softphone.test.tsx` has a documented flake history (fixed in `fd3fbdb` — a `waitFor` exact-count race). **Do not restructure its setup**; reuse the existing render helper and duty mock. The tests below call it `renderSoftphone` and assume the file's duty mock exposes a mutable object — substitute the real names.

```tsx
it("turns the ring into a go-on-duty control while off duty", () => {
  const goOnDuty = vi.fn().mockResolvedValue(undefined);
  Object.assign(dutyMock, { onDuty: false, onBreak: false, canWork: false, goOnDuty });
  renderSoftphone({ role: "AGENT" });

  const btn = screen.getByRole("button", { name: "Go on duty" });
  fireEvent.click(btn);
  expect(goOnDuty).toHaveBeenCalledTimes(1);
});

it("leaves the ring decorative while on duty", () => {
  Object.assign(dutyMock, { onDuty: true, onBreak: false, canWork: true });
  renderSoftphone({ role: "AGENT" });
  expect(screen.queryByRole("button", { name: "Go on duty" })).toBeNull();
});

it("reads Not accepting calls while off duty", () => {
  Object.assign(dutyMock, { onDuty: false, onBreak: false, canWork: false });
  renderSoftphone({ role: "AGENT" });
  expect(screen.getByText("Not accepting calls")).toBeTruthy();
});

it("reads Accepting calls while on duty", () => {
  Object.assign(dutyMock, { onDuty: true, onBreak: false, canWork: true, accepting: true });
  renderSoftphone({ role: "AGENT" });
  expect(screen.getByText("Accepting calls")).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/softphone.test.tsx
```

Expected: FAIL — no such button.

- [ ] **Step 3: Make the ring actionable off duty**

At `softphone.tsx:819-827` the ring is currently a decorative `<div>` — its own comment calls it *"decorative anchor, not a status light"*. Off duty it becomes a button; on duty it stays exactly as it is:

```tsx
{/* Off duty the ring is the go-on-duty control (spec §3.2). The lc-seam-drift
    glow already existed and was purely decorative; off duty it is the only
    bright thing on a greyed screen, which is now its job. */}
{canWork ? (
  /* existing decorative ring markup, unchanged */
) : (
  <button
    type="button"
    onClick={() => void goOnDuty()}
    className="mx-auto mt-1 grid h-16 w-16 place-items-center rounded-full"
  >
    {/* same ring markup, with border-live instead of border-border */}
    <span className="sr-only">Go on duty</span>
  </button>
)}
```

Add the visible caption under it when off duty:

```tsx
<p className="mt-2 text-center text-sm font-semibold text-live-foreground">Go on duty</p>
```

and switch the sub-copy from `Incoming calls ring here.` to `Your line is offline.`

- [ ] **Step 4: Change the accepting toggle**

At `softphone.tsx:829-847`, when off duty the label reads `Not accepting calls`, the control is visually gated (`opacity-60`), and its click routes through `useDutyGuard().guard` rather than being `disabled`.

Keep the AGENT-only rendering exactly as it is — ADMIN still gets the static "You're dialed in for properties set to Covering." paragraph.

- [ ] **Step 5: Run the tests, gate, and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/softphone/softphone.tsx apps/portal/tests/components/softphone.test.tsx
git commit -m "feat(softphone): the ring becomes the go-on-duty control off duty

The ring's own comment called it a decorative anchor with no function.
Off duty it is now the one actionable thing on a greyed screen, and the
lc-seam-drift glow it already had finally has a job. Accepting reads
'Not accepting calls' and routes through the duty guard. Spec 3.2."
```

---

### Task 10: Empty the header and wire the column

Implements spec §3.1 and §3.5.

**Files:**
- Modify: `apps/portal/components/dashboard-workspace.tsx:79-101`
- Delete: `apps/portal/components/dashboard/duty-control.tsx`

- [ ] **Step 1: Add the two cards to the aside**

In `dashboard-workspace.tsx`, the aside currently holds `Softphone` and `VideoCallHost`. Add the new cards **below** the softphone (spec D1 — the softphone card stays where it is and is not merged):

```tsx
<aside className={onHome ? "flex flex-col gap-3" : "hidden"}>
  <Softphone role={role} />
  <ShiftCard />
  <ZoneClocksCard />
  <VideoCallHost operatorId={operatorId} />
</aside>
```

`VideoCallHost` is headless — it renders no chrome — so its position is irrelevant visually, but keep it last so the two visible cards sit directly under the softphone.

- [ ] **Step 2: Remove duty from the header**

Delete `<DutyControl />` from the header slot at line 83, leaving only the account menu:

```tsx
<DashboardHeader firstName={firstName}>
  <div className="flex items-center gap-3">
    <AccountMenu … />
  </div>
</DashboardHeader>
```

Remove the now-unused `DutyControl` import.

- [ ] **Step 3: Delete the old control**

```bash
git rm apps/portal/components/dashboard/duty-control.tsx
```

If any test imports it, delete or rewrite that test — its behaviour now lives in `shift-card.test.tsx` and the softphone tests.

**Accepted consequence (spec §3.5):** an ADMIN on a non-home route now has no duty affordance and must navigate home to end a shift. AGENTs never hit this — they have exactly one route. `MAX_SHIFT_MS` (10h) force-closes a forgotten shift regardless.

- [ ] **Step 4: Run the gate**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
```

Expected: green. Any test referencing `DutyControl` or the header duty pill must be updated, not skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/dashboard-workspace.tsx apps/portal/tests
git commit -m "feat(dashboard): duty moves from the header into the column

The header keeps only the greeting and account menu. This absorbs both
outstanding time-tracker polish items: the pill-size mismatch died with
the lone h-9 'Go on duty' button leaving the header, and End shift is now
a labelled button rather than a chevron dropdown item. DutyMenu retires
with DutyControl. Spec 3.1, 3.5."
```

---

# Phase D — Call surfaces

> **Highest-risk phase.** Task 11 relocates the 911 and notes handlers. The test suite will not catch a subtle behavioural change in them. Review those paths line by line, and do not let Task 11 change any rendered output.

---

### Task 11: Extract `<CallShell>` as a pure move

Implements spec §4. **This task must produce no visual change whatsoever.** Rework happens in Task 12, so that if something breaks you know which step did it.

**Files:**
- Create: `apps/portal/components/call/call-shell.tsx`
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx`
- Modify: `apps/portal/components/video-call/video-call.tsx`

- [ ] **Step 1: Read both overlays end to end**

```bash
cat apps/portal/components/softphone/audio-call-overlay.tsx
cat apps/portal/components/video-call/video-call.tsx
```

Both carry a `SHARED-CHROME SEAM` comment predicting this extraction (`audio-call-overlay.tsx:140-142`). Note every difference between them — they have already drifted: audio splits `basis-[37%]`/`basis-[63%]`, video splits `basis-2/5`/`basis-3/5`.

- [ ] **Step 2: Create the shell**

Create `apps/portal/components/call/call-shell.tsx` owning the header strip, the stage slot, the playbook slot and the control-bar slot. Differences become explicit props, so the **deliberate** audio/video divergences stop being accidental (spec §4):

```tsx
export type CallShellProps = {
  readonly title: string;
  /** Left-panel width. Audio 70/30, video 60/40 (spec D9). */
  readonly split: "70/30" | "60/40";
  /** Video's guest stage. Audio passes null -- it has no stage. */
  readonly stage: React.ReactNode | null;
  readonly playbook: React.ReactNode;
  readonly controls: React.ReactNode;
  /** Audio only. Video deliberately has no 911 machinery. */
  readonly emergency?: React.ReactNode;
  readonly banners?: React.ReactNode;
  readonly collapsed?: boolean;
};
```

- [ ] **Step 3: Adopt it in both overlays, preserving current ratios**

Pass `split="60/40"` from **both** overlays for now, so this step is a pure move. Audio's 70/30 lands in Task 12.

Wait — audio is currently 37/63, not 40/60. To keep this a genuine no-op, give `CallShellProps.split` a third temporary value `"37/63"` and pass it from audio. Task 12 deletes it.

- [ ] **Step 4: Verify rendered output is unchanged**

```bash
pnpm -F @lc/portal test
```

Expected: PASS with **zero test changes**. If any overlay test needed editing, you changed behaviour — revert and redo the move.

- [ ] **Step 5: Line-by-line review of the moved paths**

Diff the 911 trigger, the emergency-control calls, `saveNotes`/`pendingNotes`, and `handleEnd` against `main`:

```bash
git diff main -- apps/portal/components/softphone/audio-call-overlay.tsx apps/portal/components/video-call/video-call.tsx
```

Confirm each handler is byte-identical apart from indentation and JSX nesting. **This is the review the spec calls the highest-risk item in the change (§11).**

- [ ] **Step 6: Run the gate and commit**

```bash
pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/call/call-shell.tsx \
        apps/portal/components/softphone/audio-call-overlay.tsx \
        apps/portal/components/video-call/video-call.tsx
git commit -m "refactor(call): extract CallShell as a pure move

Both overlays carried a comment predicting this extraction and had already
drifted (37/63 vs 40/60). Deliberate differences -- 911 on audio only, the
video stage -- become explicit props so they stop diverging by accident.
No rendered output changes in this commit; all call, notes and emergency
handlers are byte-identical. Spec 4."
```

---

### Task 12: Control-bar rework

Implements spec §5 and the 70/30 split from §4.

**Files:**
- Modify: `apps/portal/components/call/call-shell.tsx`
- Modify: `apps/portal/components/video-call/video-call.tsx:640-730`
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx`

- [ ] **Step 1: Remove `Hold` and `Swap`**

Both are hardcoded `disabled` with `title="Coming soon"`, and Hold was deferred entirely to multi-property when the Phase-3 plan was gated. Delete both buttons from both overlays. This is what frees the space everything else needs.

- [ ] **Step 2: Normalize `End`**

`End` is currently `text-[1.1875rem] font-bold` with an 18px icon while every sibling is `text-sm` with 16px — a one-off scale hack. Bring it onto the shared control scale, keep it navy (`bg-primary`), keep it the heaviest control in the bar, and relabel it `End call`:

```tsx
<Button
  variant="neutral"
  size="sm"
  className="h-8 whitespace-nowrap font-semibold"
  onClick={() => void handleEnd()}
>
  <PhoneOff aria-hidden="true" />
  End call
</Button>
```

- [ ] **Step 3: Stop the bar reflowing**

`Mute`/`Unmute` and `Cam off`/`Cam on` change width when toggled, shifting the row under the agent's cursor mid-call. Use fixed labels `Mute` and `Camera` with state carried by fill, and a fixed width:

```tsx
<Button
  variant="neutral"
  size="sm"
  aria-pressed={muted}
  className={cn("h-8 w-[7rem] whitespace-nowrap", muted && "bg-muted text-foreground")}
  onClick={toggleMute}
>
  {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
  Mute
</Button>
```

`aria-pressed` carries the state for assistive tech now that the label no longer changes.

- [ ] **Step 4: Group the controls (spec §5.4)**

Call controls (`Mute`, `Camera`, `Captions`) sit in one tray; `Connect` and `End call` are separated by a divider, because they leave or end the call rather than adjust it:

```tsx
<div className="flex items-center gap-2 rounded-[calc(var(--radius-button)+4px)] bg-background p-1">
  {/* Mute, Camera, Captions */}
</div>
<div className="mx-1 self-stretch w-px bg-border" aria-hidden="true" />
{/* Connect, End call */}
```

- [ ] **Step 5: Give audio its 70/30 split**

Delete the temporary `"37/63"` from `CallShellProps.split` and pass `"70/30"` from the audio overlay. Audio has no video to show, so its call card genuinely needs less room than video's; 63/37 was barely distinguishable from 60/40.

- [ ] **Step 6: Run the gate**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
```

Expected: green. Tests asserting on `Hold`, `Swap`, or the label `End` **will** fail — update them; that is the intended change. Any test touching 911 that fails means you broke something in Task 11 — stop and re-review.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/call apps/portal/components/softphone apps/portal/components/video-call apps/portal/tests
git commit -m "feat(call): rework both control bars

Removes Hold and Swap, permanently disabled and deferred to
multi-property, which frees the space for everything else. End drops its
one-off type scale and becomes 'End call'. Mute and Camera stop changing
width when toggled, so the row no longer shifts under the cursor mid-call.
Audio takes its 70/30 split. Spec 4, 5."
```

---

### Task 13: Reopen-tile control

Implements spec §6.

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx:508-522`
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx:229-236`
- Modify: `apps/portal/tests/components/video-call.test.tsx`

- [ ] **Step 1: Write the failing test**

Reuse the existing render helper in `tests/components/video-call.test.tsx` (called `renderVideoCall` below — substitute the real name) and whatever it already uses to report a user-closed tile:

```tsx
it("keeps an accessible name on the icon-only reopen control", () => {
  renderVideoCall({ tileClosedByUser: true });
  // The visible label is gone, so aria-label is the only name left.
  expect(screen.getByRole("button", { name: "Reopen tile" })).toBeTruthy();
});

it("reopens the tile when the corner control is pressed", () => {
  const openTileForCall = vi.fn();
  renderVideoCall({ tileClosedByUser: true, openTileForCall });
  fireEvent.click(screen.getByRole("button", { name: "Reopen tile" }));
  expect(openTileForCall).toHaveBeenCalledTimes(1);
});

it("hides the control when the tile is already open", () => {
  renderVideoCall({ tileClosedByUser: false });
  expect(screen.queryByRole("button", { name: "Reopen tile" })).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/video-call.test.tsx
```

Expected: FAIL if the current pill's accessible name differs, or PASS trivially if the text label already provides it — in which case keep the test as a regression guard for after the label is removed.

- [ ] **Step 3: Replace the video pill with a round corner button**

The current teal pill at `bottom-16 right-3` is chrome painted over live guest video, and it appears unannounced over a person mid-sentence. Replace with an icon-only circle in the true corner:

```tsx
{tileClosedByUser && docPipSupported() && (
  <button
    type="button"
    onClick={() => openTileForCall?.()}
    title="Reopen tile"
    aria-label="Reopen tile"
    className="absolute bottom-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-live bg-call/60 text-live hover:bg-live/20"
  >
    <PictureInPicture2 size={17} aria-hidden="true" />
  </button>
)}
```

Mint is the live/connect role in the brand, so a mint outline reads as *available action*. Note this is the app's **first mint outline-only treatment** — a small new pattern (spec §6).

- [ ] **Step 4: Inset the caption band so the corner is genuinely free**

`CaptionBand` is `absolute inset-x-3 bottom-3` (`video-call.tsx:508`) and would sit under the button. Inset its right edge while the button is present, rather than floating the button above the band:

```tsx
<CaptionBand
  finals={captions.finals}
  partial={captions.partial}
  className={cn("absolute bottom-3 left-3", tileClosedByUser && docPipSupported() ? "right-16" : "right-3")}
/>
```

- [ ] **Step 5: Put audio's reopen in the control bar**

Audio has no video stage, so there is no corner to tuck this into. It becomes a labelled button in the control bar — the one place that placement survives (spec §6). Use `PropertyActionButton`-style sizing (`h-8 whitespace-nowrap`) so it matches its neighbours.

- [ ] **Step 6: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/video-call/video-call.tsx \
        apps/portal/components/softphone/audio-call-overlay.tsx \
        apps/portal/tests/components/video-call.test.tsx
git commit -m "feat(call): move the reopen control off the guest video

An icon-only circle in the true bottom-right corner with a mint outline,
replacing a labelled teal pill that sat over a live person mid-sentence.
The caption band insets to make room rather than the button floating
above it. Icon-only, so it carries aria-label plus a tooltip. Audio has no
stage, so its reopen goes in the control bar. Spec 6."
```

---

### Task 14: In-call Connects onto the shared button

Completes spec §7.

**Files:**
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx:296-303`
- Modify: `apps/portal/components/video-call/video-call.tsx:683-692`
- Modify: `apps/portal/components/call-tile/call-tile.tsx:324-333`

- [ ] **Step 1: Replace all three with `PropertyActionButton`**

```tsx
<PropertyActionButton
  label="Connect"
  tone="teal"
  icon={<Monitor aria-hidden="true" />}
  onAction={() => {
    if (propertyId) void surface?.connectToProperty(propertyId);
  }}
  unavailableReason={!propertyId ? "No property on this call" : undefined}
  error={connectError}
/>
```

Keep the navy/teal split — teal on white and teal on navy read differently, and the in-call surfaces are dark (spec D13). The shared component makes unifying a one-prop change later.

- [ ] **Step 2: Close the behavioural gap**

None of the three in-call copies currently surface an error, so **a failed remote-access launch is silent in-call**. Thread the error state through so `PropertyActionButton` renders it on every surface (spec §7).

- [ ] **Step 3: Do not break the iframe deep-link mechanism**

`launchRustdesk` deliberately launches `rustdesk://` through a transient hidden iframe. A top-window navigation fires `pagehide`, and livekit-client tears the room down on `pagehide` — which is why pressing Connect mid-call used to end the call. **Do not touch `lib/remote-access/connect.ts`.** Its regression test `tests/lib/remote-access/launch-rustdesk.test.ts` must stay green.

- [ ] **Step 4: Fix the disabled contrast on the tile**

Tile `Connect` is low-contrast when disabled (teal at 50% on ink at 50%), reachable only when `propertyId == null`. `PropertyActionButton`'s disabled treatment should be legible on the tile's navy — verify against the tile background, not a white card.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/components/softphone apps/portal/components/video-call apps/portal/components/call-tile apps/portal/tests
git commit -m "refactor(call): in-call Connects onto PropertyActionButton

All five Connect-shaped sites now share one component. Closes a real gap:
the three in-call copies surfaced no error, so a failed remote-access
launch was silent mid-call. The rustdesk iframe launch mechanism is
untouched. Spec 7."
```

---

# Phase E — Observability

---

### Task 15: Report unexpected LiveKit disconnects

Implements spec §8 / D14.

**Files:**
- Modify: `apps/portal/lib/video/livekit-session.ts`
- Modify: `apps/portal/tests/lib/video/livekit-session.test.ts`

- [ ] **Step 1: Write the failing test**

Reuse the file's existing `livekit-client` mock and its room stub. The tests below assume the stub records handlers in a map called `roomHandlers` keyed by event name — substitute whatever the file already uses to fire a room event.

```ts
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

it("reports an unexpected disconnect to Sentry", async () => {
  captureMessage.mockClear();
  const session = await createSession(/* the file's existing args */);
  roomHandlers.get("disconnected")?.(DisconnectReason.SIGNAL_CLOSE);
  expect(captureMessage).toHaveBeenCalledTimes(1);
  expect(captureMessage.mock.calls[0][1]).toMatchObject({
    extra: { reason: "SIGNAL_CLOSE" },
  });
});

it("stays silent when the app called leave()", async () => {
  captureMessage.mockClear();
  const session = await createSession(/* the file's existing args */);
  await session.leave();
  roomHandlers.get("disconnected")?.(DisconnectReason.CLIENT_INITIATED);
  // An expected teardown is not an incident.
  expect(captureMessage).not.toHaveBeenCalled();
});
```

**The existing `livekit-client` mock must define `DisconnectReason`.** The session destructures it, and Vitest throws when you destructure an export a mock does not define — this exact failure was hit during Phase 3 and is recorded in the spec's §8 lineage. Add it to the mock as a plain object:

```ts
DisconnectReason: { CLIENT_INITIATED: 1, SIGNAL_CLOSE: 3 },
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm -F @lc/portal exec vitest run tests/lib/video/livekit-session.test.ts
```

Expected: FAIL — no handler registered.

- [ ] **Step 3: Add the handler**

```ts
// The portal has had NO disconnect handling on its LiveKit leg, so a dropped
// room produced no Sentry event, no log and no UI. That invisibility is exactly
// why a week of investigating "the call just ended" produced no evidence
// (spec §8). A disconnect after our own leave() is expected and stays silent.
let leaving = false;

room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
  if (leaving) return;
  Sentry.captureMessage("livekit room disconnected unexpectedly", {
    level: "warning",
    extra: { reason: reason != null ? DisconnectReason[reason] : "unknown" },
  });
});
```

Set `leaving = true` at the top of `leave()`.

- [ ] **Step 4: Run the test, gate, and commit**

```bash
pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm lint
git add apps/portal/lib/video/livekit-session.ts apps/portal/tests/lib/video/livekit-session.test.ts
git commit -m "feat(video): report unexpected LiveKit disconnects to Sentry

The portal had no disconnect handling at all, so a dropped room was
invisible -- no Sentry, no log, no UI. livekit-client disconnects the room
itself on a main-window pagehide, beforeunload or freeze, which produces a
clean silent leave. This makes a recurrence an issue instead of a rumour.
Silent after our own leave(). Spec 8, D14."
```

---

# Phase F — Verification

---

### Task 16: Full gate and self-review

- [ ] **Step 1: Run the whole gate**

```bash
pnpm -F @lc/portal test && pnpm typecheck && pnpm lint && pnpm check:routes && pnpm -F @lc/portal build
```

Expected: all green. Record the test count.

- [ ] **Step 2: Confirm zero out-of-scope changes**

```bash
git diff main --stat -- supabase/ apps/kiosk/
```

Expected: **empty**. This change touches no migrations and no kiosk code.

- [ ] **Step 3: Re-verify the 911 path**

```bash
git diff main -- apps/portal/components/softphone/audio-call-overlay.tsx | grep -n "emergency\|911"
```

Read every hit. Confirm the two-tap arm/confirm logic and the emergency-control calls are byte-identical apart from JSX nesting.

- [ ] **Step 4: Commit any fixes, then request review**

Use `superpowers:requesting-code-review` for a whole-branch review before the smoke pass.

---

### Task 17: Prod smoke

**Merging to `main` auto-deploys prod via Coolify.** Everything below is either CSS or DOM geometry that jsdom cannot see, so this list is not optional — every defect found during design review came from looking at rendered output, not from reading source.

- [ ] **Step 1: Deploy and hard-refresh**

Merge, wait for the Coolify deploy to report healthy, then hard-refresh. No build-time env vars changed, so no env work is needed.

- [ ] **Step 2: Walk the dashboard**

- [ ] Off duty: the ring glows and is clickable; caption reads `Go on duty`; sub-copy reads `Your line is offline.`
- [ ] Off duty: the accepting control reads `Not accepting calls`
- [ ] Off duty: clicking a greyed `Connect`, `Kiosk`, or the accepting control opens the prompt; `Start my shift` starts the shift and the page comes alive; `Not yet` dismisses
- [ ] An **offline kiosk** shows `Kiosk offline`, stays genuinely disabled, and does **not** open the prompt
- [ ] Shift card: clock ticks; `Break` / `Resume` / `End shift` all work; mid-call `End shift` is disabled with "Finish the call first"
- [ ] Clocks: four analog faces; US faces dark and India light during a night shift; hands are in plausible positions
- [ ] Header carries no duty chrome and does not look broken
- [ ] **Card geometry:** all cards in the pod grid are the same height; `Holiday Inn Express Southgate` (or any two-line name) has its buttons level with its neighbours; when a call rings, **nothing below the card moves**

- [ ] **Step 3: Walk a real video call**

- [ ] Control bar: no `Hold`, no `Swap`; `End call` reads correctly and ends the call
- [ ] Toggling `Mute` and `Camera` does **not** change the row's width
- [ ] Reopen control is a round mint circle in the bottom-right corner, not over the guest's face; the caption band does not run under it
- [ ] `Connect` launches RustDesk and **the call survives it** (this is the Phase-E regression — a top-window navigation would end it)
- [ ] Playbook split looks right at 60/40

- [ ] **Step 4: Walk a real audio call**

- [ ] Playbook has visibly more room than on video (70/30)
- [ ] **911 arms on the first tap and fires on the second** — the single most important check in this list
- [ ] Notes save with Enter; the retry banner still appears on a forced failure
- [ ] Reopen control sits in the control bar

- [ ] **Step 5: Record the result**

Write the outcome into the handoff. If anything fails, fix it on a branch and re-smoke — do not leave a known-broken prod.

---

## Notes for the implementer

**Out of scope — do not opportunistically fix:**
- Converting the softphone's hand-rolled card `<div>` (`softphone.tsx:774`) to `<Card>`.
- Dead `ChannelBar` / `ChannelLegend` in `components/dashboard/channel-viz.tsx` (zero references repo-wide).
- Stale `docs/v2-backlog.md:108`, which describes deleted Phase-3 components as current.
- The stale "permanently remote-session-foreground" framing in `CLAUDE.md`.

These are recorded in spec §12 as follow-ups.

**`PropertyCard` is slot-based.** Reading it tells you what it *can* render, not what it *does* — the buttons arrive through `connectSlot` and `footerSlot` from `pod-card-grid.tsx:115-136` and `fleet-board.tsx:84`. This caught the spec author out twice.

**The admin `FleetBoard` renders the same `PodCardGrid`**, so Tasks 4 and 5 change admin too. Admin cards additionally carry `footerSlot` content, so uniform height is required *within* a grid, not across agent and admin.

**One convention, applied in several places** (spec §3.6b): *a state or label change must not change a control's size.* It appears in the header (Task 10), card actions (Tasks 4-5) and the control bar (Task 12). Implement it as one rule, not three unrelated tweaks.
