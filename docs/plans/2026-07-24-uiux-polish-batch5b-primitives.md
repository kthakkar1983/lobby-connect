# UI/UX Polish Batch 5b — Shared primitives · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Promote three re-rolled affordances to shared, token-skinned primitives — `StatusBadge`, `Toggle`, and proper tab semantics — and migrate the hand-rolled instances onto them, so the app stops drifting. Look and behavior are preserved everywhere; this is consolidation, not restyle.

**Architecture:** Three independent clusters, sequenced low-risk → high-risk. (1) `StatusBadge` on a shared `cva` recipe, migrating the owner `StatusPill` + softphone `LinePill` + admin table pills. (2) `Toggle` on Radix `Toggle` with `tone`/`surface` variants that **preserve the existing per-surface WCAG-tuned recipes**, migrating the in-call bar toggles + the softphone Accepting toggle. (3) Add `role=tab`/`aria-selected` to the one real in-page tab (video overlay Playbook⇄Chat). No new dependency — the unified `radix-ui` package is already installed.

**Tech Stack:** Next.js App Router (portal), Tailwind v4 tokens, `radix-ui` unified package, `class-variance-authority`, Vitest + Testing Library (jsdom).

**Grounding:** the 2026-07-24 primitives sweep; audit `docs/audits/2026-07-20-whole-app-uiux-audit.md` Theme A; parent plan `docs/plans/2026-07-21-uiux-polish.md` (Batch 5). Depends on 5a (merged).

---

## Constraints (inherited — all batches)

- **Zero migrations / API routes / RLS.**
- **Do NOT touch the regression guards** — 911 machinery, notes handlers, `handleConnect`, the `softphone.tsx:587` accept-gate stay byte-identical. The Accepting-toggle migration (Task 7) restyles a button; it must keep the exact `onClick`/`guard(toggleReady)`/`aria-pressed`/gated-fill behavior.
- **Widths/sizes in Tailwind scale (rem), never px** (the root scales to 112.5% at `lg`).
- **jsdom has no layout engine** — tests assert classes/attributes/roles, never pixels. The real check is the live prod smoke at the end.
- **Gate (green before each commit):** `pnpm -F @lc/portal test && pnpm -F @lc/portal typecheck && pnpm -F @lc/portal build && pnpm lint && pnpm check:routes`. (`.next/types/* 2.ts` gotcha: `find apps/portal/.next/types -name "* 2.ts" -delete` first if it trips; root `pnpm lint` false-positives on a stray `.claude/worktrees/` checkout — re-verify with `pnpm -F @lc/portal lint`.)

## Scope decisions (deliberate — flag on review)

- **StatusBadge is a standalone `cva`**, not a new `Badge` variant. `Badge`'s color tokens (`live`/`accent`/`attention`) already match, but its base typography is `text-xs font-medium`; the status pill's role is `font-label text-[11px] font-semibold uppercase tracking-[0.06em]`. A separate primitive keeps that label role clean instead of overloading `Badge`. StatusBadge reuses the same color tokens, so they stay visually reconciled.
- **Toggle preserves per-surface WCAG recipes as variants.** `caption-toggle.tsx` documents (and measures) that the labelled bar sits on white (`text-foreground`/`text-text-muted`) while the compact tile sits on navy (`text-accent`/`text-primary-foreground/70`) — different tokens for contrast, with an explicit "do NOT unify the two branches." Toggle encodes both as `surface="bar"` / `surface="tile"` compound variants; nothing is flattened.
- **Toggle migration scope = the two bar toggles + Accepting; the tile's round `TileIconButton` is left as-is.** `TileIconButton` mixes toggles (mute/camera/chat) with non-toggles (hang-up, two-tap 911) in one round-button family on the highest-risk surface (the DocPiP tile); migrating only its toggle subset adds risk for little consolidation. Documented, not silently skipped.
- **Tabs = ARIA on the one real tab, no primitive.** Only `video-call.tsx`'s Playbook⇄Chat is an in-page tab; the Calls filter pills are navigation (`aria-current`), correctly not tabs; the tile Video⇄Chat is a single toggle. A full Radix `Tabs` primitive for one consumer is YAGNI (same call as `ButtonGroup` in Batch 1).

---

## Cluster 1 — StatusBadge (Tasks 1–4)

### Task 1: Create `ui/status-badge.tsx`

**Files:**
- Create: `apps/portal/components/ui/status-badge.tsx`
- Test: `apps/portal/tests/components/status-badge.test.tsx`

- [ ] **Step 1 — Write the failing test.**

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusBadge } from "@/components/ui/status-badge";

afterEach(() => cleanup());

describe("StatusBadge", () => {
  it("renders the label with the live variant tokens + pill typography", () => {
    render(<StatusBadge variant="live">Completed</StatusBadge>);
    const el = screen.getByText("Completed");
    expect(el.className).toContain("bg-live/15");
    expect(el.className).toContain("text-live-foreground");
    expect(el.className).toContain("rounded-pill");
    expect(el.className).toContain("uppercase");
  });
  it("defaults to muted and can show a status dot", () => {
    render(<StatusBadge dot>Offline</StatusBadge>);
    const el = screen.getByText("Offline");
    expect(el.className).toContain("bg-muted");
    // the dot is an aria-hidden span inside
    expect(el.querySelector("span[aria-hidden='true']")).toBeTruthy();
  });
});
```

- [ ] **Step 2 — Run it, verify it fails** (module absent): `pnpm -F @lc/portal test status-badge`.

- [ ] **Step 3 — Implement.** Write `status-badge.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em]",
  {
    variants: {
      variant: {
        live: "bg-live/15 text-live-foreground",
        accent: "bg-accent/15 text-accent-text",
        attention: "bg-attention/15 text-attention-text",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "muted" },
  },
);

const DOT: Record<NonNullable<VariantProps<typeof statusBadgeVariants>["variant"]>, string> = {
  live: "bg-live",
  accent: "bg-accent",
  attention: "bg-attention",
  muted: "bg-muted-foreground/50",
};

export function StatusBadge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof statusBadgeVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="status-badge"
      data-variant={variant ?? "muted"}
      className={cn(statusBadgeVariants({ variant }), className)}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT[variant ?? "muted"])} />
      ) : null}
      {children}
    </span>
  );
}

export { statusBadgeVariants };
```

- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** `feat(ui): add StatusBadge primitive`.

### Task 2: Migrate the owner `StatusPill` onto StatusBadge

Owner `StatusPill` (`components/owner/status-pill.tsx`) renders the base string itself and gets `{className,label}` from `callPill`/`incidentPill` (`lib/owner/status-pill.ts`). Refactor those mappers to return a StatusBadge **variant** (a union `"live"|"accent"|"attention"|"muted"`) instead of a raw className, and have `StatusPill` render `<StatusBadge variant={…}>`.

**Files:**
- Modify: `apps/portal/lib/owner/status-pill.ts` (`callPill`/`incidentPill` return `{ variant, label }`; read the file — its className→token mapping tells you which variant each state maps to: `bg-live/15`→`live`, `bg-attention/15`→`attention`, `bg-muted`→`muted`)
- Modify: `apps/portal/components/owner/status-pill.tsx` (render `<StatusBadge variant={pill.variant}>{pill.label}</StatusBadge>`)
- Test: `apps/portal/tests/lib/owner/status-pill.test.ts` (if present — update the expected shape from `className` to `variant`; read it first)

- [ ] **Step 1 — Update the mapper tests** to assert `variant` (e.g. `expect(callPill("COMPLETED").variant).toBe("live")`), matching the current className→variant mapping exactly. Run → fails.
- [ ] **Step 2 — Implement** the `{variant,label}` return + the `StatusPill` re-render. Preserve every current state→color mapping (including the OUTBOUND `NO_ANSWER`→`muted` downgrade).
- [ ] **Step 3 — Verify** the `StatusPill` consumers (`owner/incident-row.tsx`, `call/call-row.tsx`, owner call/incident detail pages) still render — no call-site prop change (StatusPill's props are unchanged).
- [ ] **Step 4 — Full gate + commit.** `refactor(owner): render StatusPill via StatusBadge`.

### Task 3: Migrate the softphone `LinePill` onto StatusBadge

`LinePill` (`softphone.tsx:1045–1075`, rendered `:826`) is a bespoke pill+dot mapping the line `phase` to Off duty / On call / Incoming / Ready / Offline / Connecting. Replace its markup with `<StatusBadge variant dot>` while keeping the exact phase→label→color mapping.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx` (`LinePill` internals only — read `:1045–1075` first; map its `ok`/label logic to a StatusBadge `variant` (`live` when up, `muted` when down) + `dot`)
- Test: `apps/portal/tests/components/softphone.test.tsx` (extend only if a LinePill assertion exists; otherwise the existing suite must stay green)

- [ ] **Step 1 — Pin the mapping** in a small test if not already covered (e.g. "Ready" phase → a live-variant pill), run → fails.
- [ ] **Step 2 — Implement** `LinePill` on `<StatusBadge>`. Touch ONLY `LinePill`; the softphone's Device/duty/call logic stays byte-identical.
- [ ] **Step 3 — Full gate + commit.** `refactor(softphone): render LinePill via StatusBadge`.

### Task 4: Migrate the admin table pills onto StatusBadge

`users-table.tsx:546–563` (Role + Status inline spans) and `properties-table.tsx:106–116` (Active/Inactive) copy the StatusBadge base string. Replace each inline `<span>` with `<StatusBadge variant>`. (The users-table **presence** column stays plain text here — it becomes a pill in 5c, which owns the zebra+pill pass.)

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx` (Role span → `<StatusBadge variant="muted">`; Status spans → matching variants — read `:546–563`)
- Modify: `apps/portal/app/(admin)/admin/properties/properties-table.tsx` (Active→`live`, Inactive→`muted` — read `:106–116`)
- Test: extend the relevant table tests if they assert pill classes; else keep green.

- [ ] **Step 1 — Adjust/keep tests** to assert the StatusBadge output for one row each, run → fails (or confirm green if untested).
- [ ] **Step 2 — Implement** the span→StatusBadge swaps; labels + colors unchanged.
- [ ] **Step 3 — Full gate + commit.** `refactor(admin): render table status pills via StatusBadge`.

---

## Cluster 2 — Toggle (Tasks 5–7)

### Task 5: Create `ui/toggle.tsx` (Radix Toggle + per-surface variants)

**Files:**
- Create: `apps/portal/components/ui/toggle.tsx`
- Test: `apps/portal/tests/components/toggle.test.tsx`

- [ ] **Step 1 — Write the failing test** — pin the three recipes + `aria-pressed`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "@/components/ui/toggle";

afterEach(() => cleanup());

describe("Toggle", () => {
  it("bar+accent: engaged uses the accent fill + foreground text", () => {
    render(<Toggle pressed tone="accent" surface="bar" aria-label="Mute" />);
    const b = screen.getByRole("button", { name: "Mute" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.className).toContain("data-[state=on]:border-accent");
    expect(b.className).toContain("data-[state=on]:text-foreground");
  });
  it("tile+accent: engaged text is the bright accent token (navy-safe), not foreground", () => {
    render(<Toggle pressed tone="accent" surface="tile" aria-label="Captions" />);
    const b = screen.getByRole("button", { name: "Captions" });
    expect(b.className).toContain("data-[state=on]:text-accent");
    expect(b.className).not.toContain("data-[state=on]:text-foreground");
  });
  it("bar+live: engaged uses the mint fill (Accepting recipe)", () => {
    render(<Toggle pressed tone="live" surface="bar" aria-label="Accepting" />);
    expect(screen.getByRole("button", { name: "Accepting" }).className).toContain("data-[state=on]:bg-live/15");
  });
  it("fires onPressedChange", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<Toggle pressed={false} onPressedChange={onPressedChange} aria-label="Mute" />);
    await user.click(screen.getByRole("button"));
    expect(onPressedChange).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Implement.** Write `toggle.tsx`. The compound variants carry the EXACT tokens from the current components (`call-controls.tsx:157–160`, `caption-toggle.tsx:60–68`, `softphone.tsx:969–986`):

```tsx
"use client";
import * as React from "react";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-button border text-sm font-medium transition-colors outline-none disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 focus-visible:ring-2 focus-visible:ring-offset-2",
  {
    variants: {
      surface: {
        bar: "focus-visible:ring-ring focus-visible:ring-offset-background",
        tile: "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary",
      },
      tone: { accent: "", live: "" },
      size: { bar: "px-3 py-2", compact: "px-2 py-1 text-xs", block: "w-full px-3 py-2" },
    },
    compoundVariants: [
      {
        surface: "bar", tone: "accent",
        className:
          "data-[state=off]:border-border data-[state=off]:text-text-muted data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:text-foreground data-[state=on]:hover:bg-accent/10 data-[state=on]:hover:text-foreground",
      },
      {
        surface: "bar", tone: "live",
        className:
          "data-[state=off]:border-border data-[state=off]:text-text-muted data-[state=on]:border-transparent data-[state=on]:bg-live/15 data-[state=on]:text-live-foreground",
      },
      {
        surface: "tile", tone: "accent",
        className:
          "data-[state=off]:border-border data-[state=off]:text-primary-foreground/70 data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:text-accent",
      },
    ],
    defaultVariants: { surface: "bar", tone: "accent", size: "bar" },
  },
);

export function Toggle({
  className, surface, tone, size, ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ surface, tone, size }), className)}
      {...props}
    />
  );
}

export { toggleVariants };
```

> Radix `Toggle.Root` renders a `<button>` and manages `data-state=on|off` + `aria-pressed` from its `pressed`/`onPressedChange`. That is why the fills are keyed on `data-[state=on/off]` rather than a `pressed` boolean class.

- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Full gate + commit.** `feat(ui): add Toggle primitive (per-surface variants)`.

### Task 6: Migrate the in-call bar toggles (`CallToggleButton` + `CaptionToggle`) onto Toggle

Re-implement both as thin wrappers over `<Toggle>` **without changing their exported prop APIs** (so the overlay call-sites don't change). `CallToggleButton` → `<Toggle tone="accent" surface="bar" size="bar" className="w-36">`; `CaptionToggle` → `<Toggle tone="accent" surface={compact ? "tile" : "bar"} size={compact ? "compact" : "bar"}>`. Map `pressed`→`pressed`, `onToggle`→`onPressedChange={() => onToggle()}`, and forward `aria-label`/`title`/`stateLabel`/`icon`/`label` exactly as today.

**Files:**
- Modify: `apps/portal/components/call/call-controls.tsx` (`CallToggleButton` body → wrap `Toggle`; keep the `w-36`, the icon-then-label children, and the `aria-label`/`title` logic verbatim; keep the WCAG docblock)
- Modify: `apps/portal/components/call/caption-toggle.tsx` (body → wrap `Toggle`; the `compact` branch selects `surface="tile"`; keep the `Captions`/`CaptionsOff` icon sizing (`13`/`14`) and the `aria-label={compact ? "Captions" : undefined}`)
- Test: `apps/portal/tests/components/call-controls.test.tsx` + `apps/portal/tests/components/caption-toggle.test.tsx` — must stay green (they pin width `w-36`, `aria-pressed`, reflow-safety, and the compact/labelled color split). Read them first; update only the assertions that pinned an internal class that legitimately moved to `data-[state=…]` form, keeping the same intent.

- [ ] **Step 1 — Read both components + both test files.** Note every assertion (widths, `aria-pressed`, the compact `text-accent` vs labelled `text-foreground` split, the reflow test).
- [ ] **Step 2 — Re-implement `CallToggleButton`** over `<Toggle>`. Run `call-controls` tests → fix assertions that referenced the old `pressed ? …` class form to the new `data-[state=on]:…` form, preserving intent (same tokens). Green.
- [ ] **Step 3 — Re-implement `CaptionToggle`** over `<Toggle>` (bar/tile by `compact`). Run `caption-toggle` tests → green, with the compact/labelled color split intact.
- [ ] **Step 4 — Full gate + commit.** `refactor(call): build the in-call toggles on the Toggle primitive`.

> The overlays (`audio-call-overlay.tsx`, `video-call.tsx`) import `CallToggleButton`/`CaptionToggle` unchanged — confirm their call-sites are untouched (grep the imports). 911/notes/End-call are not in these files' scope.

### Task 7: Migrate the softphone Accepting toggle onto Toggle

The Accepting toggle (`softphone.tsx:964–990`) is the agent-only ready switch: `onClick={() => guard(toggleReady)}`, `aria-pressed={acceptingNow}`, gated recessed-fill when `gated`. Swap the raw `<button>` for `<Toggle tone="live" surface="bar" size="block" pressed={acceptingNow} onPressedChange={() => guard(toggleReady)}>` keeping the label swap and the `gated && "bg-muted"` cue.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx` (ONLY the Accepting-toggle JSX at `:964–990` — read it; the `guard`/`toggleReady`/`acceptingNow`/`gated` wiring and the "start your shift?" intercept behavior stay byte-identical)
- Test: `apps/portal/tests/components/softphone.test.tsx` — the gated-fill + "offers to start the shift" + aria-pressed tests must stay green (adjust only class-form assertions, same intent).

- [ ] **Step 1 — Read the Accepting block + the softphone tests** that touch it (gated `bg-muted`, the guard offer, aria-pressed).
- [ ] **Step 2 — Implement** the `<Toggle>` swap, preserving `gated && "bg-muted"` via `className` and the exact handler. Run softphone tests → green (adjust class-form assertions only).
- [ ] **Step 3 — Full gate + commit.** `refactor(softphone): build the Accepting toggle on the Toggle primitive`.

---

## Cluster 3 — Tabs semantics (Task 8)

### Task 8: Add `role=tab` / `aria-selected` to the video overlay Playbook⇄Chat tabs

`video-call.tsx:635–653` renders two plain `<button>`s switching `rightTab` with underline-active styling and no ARIA tab roles. Add `role="tablist"` to the row, `role="tab"` + `aria-selected` to each button, `aria-controls`/`id` linking to the panel (`:655–665`), and roving `tabIndex` (selected = 0, other = -1). Visual styling unchanged.

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx` (the tab row `:635–653` + the panel container `:655–665` — read first)
- Test: `apps/portal/tests/components/video-call.test.tsx` (extend — assert the tablist/tab roles + `aria-selected` reflects `rightTab`; read the existing file for its render harness/mocks)

- [ ] **Step 1 — Write the failing test** — the two tabs expose `role="tab"`, exactly one has `aria-selected="true"` matching the active panel, and the row is `role="tablist"`. Run → fails.
- [ ] **Step 2 — Implement** the roles/ARIA + roving `tabIndex`. Keep the underline classes, the unread dot, and the `rightTab` state/handlers exactly as they are.
- [ ] **Step 3 — Full gate + commit.** `feat(a11y): tab semantics for the in-call Playbook/Chat tabs`.

---

## Live-verify gate (before 5c)

Deploy the branch and confirm on the real build: status pills look identical across owner (calls/incidents), the softphone line pill, and the admin tables; the in-call bar toggles (Mute/Camera/Captions) look and behave exactly as before on BOTH the audio overlay (white bar) and the video overlay, AND the caption toggle in the **navy call tile** still reads correctly (the per-surface contrast); the softphone Accepting toggle still toggles + still shows the gated "start your shift?" intercept; the Playbook⇄Chat tabs switch by keyboard. Then start 5c.

---

## Self-review

- **Spec coverage:** Theme A's `Toggle` (bar toggles + Accepting; tile deferred with reason), `StatusBadge` (owner + softphone + admin tables), and Tabs (ARIA on the one real tab). `ButtonGroup` is NOT here — Batch 1 applied equal-width directly and the pattern did not recur enough to warrant it (confirm during Task 6; if a third equal-width pair appears, note it for a follow-up rather than expanding scope).
- **Type/name consistency:** `StatusBadge`'s `variant` union (`live|accent|attention|muted`) is the same in Task 1's impl, Task 2's mapper return, and Tasks 3–4's call-sites. `Toggle`'s `pressed`/`onPressedChange` (Radix) is the API every migration adapts `onToggle` onto.
- **Guard safety:** Tasks 3, 6, 7 touch call-surface files but only the pill/toggle JSX; each step says "read first, preserve the handler/gate verbatim, keep the suite green." The 911/notes/accept-gate never appear in the edited ranges.
- **No placeholders:** the two new primitives are given in full; migrations name exact files + line ranges + the transformation + the "read it first" adjacent read (house pattern), because the executing subagent must preserve heavily-commented WCAG reasoning that shouldn't be reproduced (and risk drifting) here.
