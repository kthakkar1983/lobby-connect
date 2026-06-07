# UI/UX Stage 2 (Kiosk) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint every guest-facing kiosk screen to the locked Lobby Connect brand, and add an owner-configurable Home style (`kiosk_cta_style`) that the hotel owner picks from the owner portal.

**Architecture:** Presentational repaint of `apps/kiosk` screens against the Stage 1 token layer (no business-logic change), plus one additive setting that spans three layers: a `properties.kiosk_cta_style` column (migration 0015, guarded by the existing Plan-7b column trigger), the kiosk config API + `KioskConfig` type, and an owner-portal picker wired through the existing kiosk-content Edit/Save action. One new dark token (`--color-call`) backs the video screens; a `CLOSE_DISCLOSURE` state-machine transition backs the recording-notice X.

**Tech Stack:** Vite + React 19 (kiosk), Tailwind v4 CSS-first `@theme`, lucide-react, Vitest; Next.js App Router + Supabase (portal), Postgres migration.

**Spec:** `docs/specs/2026-06-07-stage2-kiosk-repaint-design.md` (LOCKED). All design values come from there + the Stage 0 direction. Do not invent values.

**Branch:** `feat/ui-ux-stage2-kiosk` (already created, spec committed).

---

## File structure

**Migration**
- Create `supabase/migrations/0015_kiosk_cta_style.sql` — column + CHECK + default; extend `enforce_owner_property_columns()` whitelist.

**Portal (owner side)**
- Modify `apps/portal/app/api/kiosk/config/route.ts` — select + return `ctaStyle`.
- Modify `apps/portal/tests/app/kiosk/config.test.ts` — assert `ctaStyle`.
- Modify `apps/portal/lib/owner/kiosk.ts` — `KioskCtaStyle`, `KIOSK_CTA_STYLES`, `validateCtaStyle`.
- Create `apps/portal/tests/lib/owner/kiosk-cta-style.test.ts` — validation tests.
- Modify `apps/portal/app/(owner)/owner/properties/[id]/actions.ts` — thread `ctaStyle` through update + audit.
- Modify `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx` — Appearance picker.
- Modify `apps/portal/app/(owner)/owner/properties/[id]/page.tsx` — pass `kiosk_cta_style` into the card.

**Kiosk**
- Modify `apps/kiosk/package.json` — add `lucide-react`.
- Modify `apps/kiosk/src/index.css` — `--color-call` token + seam/animation helper classes + reduced-motion.
- Modify `apps/kiosk/src/types.ts` — `KioskConfig.ctaStyle`.
- Modify `apps/kiosk/src/state/call-machine.ts` — `CLOSE_DISCLOSURE`.
- Modify `apps/kiosk/tests/state/call-machine.test.ts` — transition test.
- Create `apps/kiosk/src/components/brand.tsx` — `SeamTop`, `LogoMark`, `SeamShimmer`.
- Create `apps/kiosk/src/screens/CallControls.tsx` — shared control bar.
- Modify `apps/kiosk/src/screens/{Home,RecordingNotice,Ringing,Connected,Apology}.tsx` — repaint.
- Modify `apps/kiosk/src/App.tsx` — Loading + ReconnectingOverlay repaint, dispatch wiring, Apology/RecordingNotice prop changes.

**Docs**
- Modify `CLAUDE.md` build-status table on completion.

---

## Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Confirm branch + clean install**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git branch --show-current   # expect: feat/ui-ux-stage2-kiosk
pnpm install
```

- [ ] **Step 2: Confirm green baseline**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green. If red before any change, stop and report — it is pre-existing.

---

## Task 1: Add lucide-react to the kiosk

**Files:** Modify `apps/kiosk/package.json`.

- [ ] **Step 1: Install**

```bash
pnpm --filter @lc/kiosk add lucide-react
```
Expected: `lucide-react` appears in `apps/kiosk/package.json` dependencies.

- [ ] **Step 2: Verify it imports under the kiosk's bundler**

```bash
pnpm --filter @lc/kiosk typecheck
```
Expected: PASS (no change to source yet; just confirms install is sane).

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/package.json pnpm-lock.yaml
git commit -m "build(kiosk): add lucide-react for call-control icons"
```

---

## Task 2: Migration 0015 — `kiosk_cta_style` column + guard

**Files:** Create `supabase/migrations/0015_kiosk_cta_style.sql`.

- [ ] **Step 1: Write the migration**

Mirror the 0010 guard exactly, adding `kiosk_cta_style` to the column and to BOTH whitelist arrays. Idempotent.

```sql
-- 0015_kiosk_cta_style.sql — Stage 2 (kiosk repaint).
-- Adds an owner-selectable kiosk Home style. text + CHECK (not a pg enum), per the
-- roles convention. Extends the Plan-7b column guard so an OWNER may write it under
-- RLS (the properties_owner_update row policy already covers the row; the trigger
-- gates which columns). Service-role writes have auth.uid()=NULL -> role NULL, so
-- they skip the guard. Idempotent.

-- 1. Column: warm (default) | accent | classic.
alter table properties
  add column if not exists kiosk_cta_style text not null default 'warm';

alter table properties
  drop constraint if exists properties_kiosk_cta_style_check;
alter table properties
  add constraint properties_kiosk_cta_style_check
  check (kiosk_cta_style in ('warm', 'accent', 'classic'));

-- 2. Extend the owner column whitelist (adds 'kiosk_cta_style' to both arrays).
create or replace function enforce_owner_property_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() = 'OWNER' then
    if (to_jsonb(old) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message',
          'kiosk_cta_style','updated_at'
        ]::text[])
       is distinct from
       (to_jsonb(new) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message',
          'kiosk_cta_style','updated_at'
        ]::text[])
    then
      raise exception 'owners may only edit guest-facing kiosk fields';
    end if;
  end if;
  return new;
end;
$$;
```

- [ ] **Step 2: Commit (apply to prod happens in Task 19, after code is verified)**

```bash
git add supabase/migrations/0015_kiosk_cta_style.sql
git commit -m "feat(db): migration 0015 — kiosk_cta_style column + owner guard whitelist"
```

---

## Task 3: Kiosk config route returns `ctaStyle`

**Files:** Modify `apps/portal/app/api/kiosk/config/route.ts`, `apps/portal/tests/app/kiosk/config.test.ts`.

- [ ] **Step 1: Extend the test (red)**

In `config.test.ts`, add `kiosk_cta_style: "accent"` to the `beforeEach` `propertyRow` object (after `kiosk_apology_message`), then add this test inside the `describe`:

```ts
it("returns the kiosk cta style, defaulting to warm when null", async () => {
  const token = signKioskToken("prop-1", SECRET);
  let res = await GET(req(token));
  expect((await res.json()).ctaStyle).toBe("accent");

  propertyRow!.kiosk_cta_style = null;
  res = await GET(req(token));
  expect((await res.json()).ctaStyle).toBe("warm");
});
```

- [ ] **Step 2: Run it (verify fail)**

```bash
pnpm --filter @lc/portal test -- config.test
```
Expected: FAIL — `ctaStyle` is `undefined`.

- [ ] **Step 3: Implement in `route.ts`**

In the `.select("...")` string, append `, kiosk_cta_style`. In the returned JSON object, add after `apologyMessage`:

```ts
    ctaStyle: (p.kiosk_cta_style as "warm" | "accent" | "classic" | null) ?? "warm",
```

- [ ] **Step 4: Run it (verify pass)**

```bash
pnpm --filter @lc/portal test -- config.test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/config/route.ts apps/portal/tests/app/kiosk/config.test.ts
git commit -m "feat(kiosk-api): return kiosk_cta_style (default warm) from config route"
```

---

## Task 4: Owner validation — `KioskCtaStyle` + `validateCtaStyle` (TDD)

**Files:** Modify `apps/portal/lib/owner/kiosk.ts`; Create `apps/portal/tests/lib/owner/kiosk-cta-style.test.ts`.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/lib/owner/kiosk-cta-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KIOSK_CTA_STYLES, validateCtaStyle } from "@/lib/owner/kiosk";

describe("validateCtaStyle", () => {
  it("accepts each known style", () => {
    for (const s of KIOSK_CTA_STYLES) expect(validateCtaStyle(s)).toBeNull();
  });
  it("rejects an unknown style", () => {
    expect(validateCtaStyle("rainbow")).toMatch(/appearance/i);
  });
});
```

- [ ] **Step 2: Run it (verify fail)**

```bash
pnpm --filter @lc/portal test -- kiosk-cta-style
```
Expected: FAIL — `validateCtaStyle`/`KIOSK_CTA_STYLES` not exported.

- [ ] **Step 3: Implement in `lib/owner/kiosk.ts`**

Add at the end of the file:

```ts
export const KIOSK_CTA_STYLES = ["warm", "accent", "classic"] as const;
export type KioskCtaStyle = (typeof KIOSK_CTA_STYLES)[number];

export function validateCtaStyle(value: string): string | null {
  return (KIOSK_CTA_STYLES as readonly string[]).includes(value)
    ? null
    : "Choose a valid kiosk appearance.";
}
```

- [ ] **Step 4: Run it (verify pass)**

```bash
pnpm --filter @lc/portal test -- kiosk-cta-style
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/kiosk.ts apps/portal/tests/lib/owner/kiosk-cta-style.test.ts
git commit -m "feat(owner): kiosk cta-style enum + validator"
```

---

## Task 5: Owner action threads `ctaStyle` through update + audit

**Files:** Modify `apps/portal/app/(owner)/owner/properties/[id]/actions.ts`.

- [ ] **Step 1: Extend imports + signature**

In `actions.ts`, change the `@/lib/owner/kiosk` import to also pull the new symbols:

```ts
import {
  KIOSK_FIELDS,
  validateKioskFields,
  validateCtaStyle,
  type KioskContentInput,
  type KioskCtaStyle,
} from "@/lib/owner/kiosk";
```

Change the action signature to accept the style as a third argument:

```ts
export async function updateKioskContentAction(
  propertyId: string,
  input: KioskContentInput,
  ctaStyle: KioskCtaStyle,
): Promise<ActionResult> {
```

- [ ] **Step 2: Validate the style**

Immediately after the existing `validateKioskFields` guard, add:

```ts
  const styleError = validateCtaStyle(ctaStyle);
  if (styleError) return { ok: false, error: styleError };
```

- [ ] **Step 3: Select + diff the style column**

Change the `.select(KIOSK_FIELDS.join(", "))` call to include the style column, and widen the row type:

```ts
    .select([...KIOSK_FIELDS, "kiosk_cta_style"].join(", "))
    .eq("id", propertyId)
    .maybeSingle<
      Record<(typeof KIOSK_FIELDS)[number], string | null> & {
        kiosk_cta_style: string | null;
      }
    >();
```

After the `for (const field of KIOSK_FIELDS) { ... }` loop and **before** the `if (audits.length === 0)` check, add the style diff:

```ts
  if (ctaStyle !== current.kiosk_cta_style) {
    (updates as Record<string, unknown>).kiosk_cta_style = ctaStyle;
    audits.push({ field: "kiosk_cta_style", from: current.kiosk_cta_style, to: ctaStyle });
  }
```

(The existing audit-write block consumes `audits` unchanged — the style edit rides the same transaction + audit path.)

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @lc/portal typecheck
```
Expected: PASS. (Card call-site updates in Task 6; if typecheck flags the call-site arity now, that is expected and fixed next.)

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/actions.ts"
git commit -m "feat(owner): persist + audit kiosk_cta_style in kiosk-content action"
```

---

## Task 6: Owner portal Appearance picker

**Files:** Modify `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx`, `page.tsx`.

- [ ] **Step 1: Pass the current style into the card**

In `page.tsx`, find where `<KioskContentCard ... initial={...} />` is rendered and where the property row is selected. Ensure `kiosk_cta_style` is part of the selected columns for that property, then pass it:

```tsx
<KioskContentCard
  propertyId={property.id}
  initial={kioskInitial}
  initialStyle={(property.kiosk_cta_style ?? "warm") as KioskCtaStyle}
/>
```

Add the import at the top of `page.tsx`:

```ts
import type { KioskCtaStyle } from "@/lib/owner/kiosk";
```

If the property `select(...)` in `page.tsx` lists columns explicitly, add `kiosk_cta_style`; if it selects `*`, no change needed.

- [ ] **Step 2: Add the picker to the card**

In `kiosk-content-card.tsx`, update imports + props + state:

```tsx
import { KIOSK_CTA_STYLES, type KioskCtaStyle } from "@/lib/owner/kiosk";
// ...
type Props = {
  propertyId: string;
  initial: KioskContentInput;
  initialStyle: KioskCtaStyle;
};

const STYLE_META: Record<KioskCtaStyle, { name: string; panel: string; greet: string }> = {
  warm: { name: "Warm", panel: "bg-accent-strong", greet: "text-foreground" },
  accent: { name: "Accent", panel: "bg-primary", greet: "text-foreground" },
  classic: { name: "Classic", panel: "bg-primary", greet: "text-accent-strong" },
};
```

In the component body, add style state next to `values`:

```tsx
const [style, setStyle] = useState<KioskCtaStyle>(initialStyle);
```

In `cancel()`, also reset the style:

```tsx
function cancel() {
  setValues(initial);
  setStyle(initialStyle);
  setError(null);
  setEditing(false);
}
```

In `save()`, pass the style as the third arg:

```tsx
const result = await updateKioskContentAction(propertyId, values, style);
```

Render the picker as the first field inside the fields `<div className="flex flex-col gap-4">` block (above the `KIOSK_FIELDS.map`):

```tsx
<div className="flex flex-col gap-1.5">
  <Label>Appearance</Label>
  <div className="flex gap-2">
    {KIOSK_CTA_STYLES.map((s) => {
      const meta = STYLE_META[s];
      const selected = style === s;
      return (
        <button
          key={s}
          type="button"
          disabled={!editing}
          onClick={() => setStyle(s)}
          aria-pressed={selected}
          className={`flex-1 rounded-input border-2 p-1.5 text-left transition-colors disabled:cursor-default ${
            selected ? "border-accent-strong" : "border-border"
          } ${editing ? "cursor-pointer" : ""}`}
        >
          <span className="flex aspect-[16/10] overflow-hidden rounded-[6px] border border-border">
            <span className="flex-[0_0_55%] bg-card p-1">
              <span className={`block font-display text-[10px] leading-none ${meta.greet}`}>Hi.</span>
            </span>
            <span className={`flex-[0_0_45%] ${meta.panel}`} />
          </span>
          <span className="mt-1 block text-center text-xs font-medium text-foreground">
            {meta.name}
            {s === "warm" ? <span className="text-muted-foreground"> · default</span> : null}
          </span>
        </button>
      );
    })}
  </div>
</div>
```

- [ ] **Step 3: Typecheck + build**

```bash
pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build
```
Expected: PASS (call-site arity now matches Task 5).

- [ ] **Step 4: Eyeball**

`pnpm dev:portal` → sign in as the owner → a property → the kiosk-content card shows three Appearance thumbnails; they are inert until **Edit**, selectable while editing, and **Save** persists (toast). Refresh: the chosen one stays ringed.

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx" "apps/portal/app/(owner)/owner/properties/[id]/page.tsx"
git commit -m "feat(owner): kiosk appearance picker in the kiosk-content card"
```

---

## Task 7: Kiosk `KioskConfig.ctaStyle`

**Files:** Modify `apps/kiosk/src/types.ts`.

- [ ] **Step 1: Add the field**

In `KioskConfig`, after `phoneNumber`, add:

```ts
  ctaStyle: "warm" | "accent" | "classic";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @lc/kiosk typecheck
```
Expected: PASS (the field is consumed in Task 12; nothing breaks yet).

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/types.ts
git commit -m "feat(kiosk): add ctaStyle to KioskConfig"
```

---

## Task 8: Kiosk dark token + seam/animation helpers

**Files:** Modify `apps/kiosk/src/index.css`.

- [ ] **Step 1: Add the call token**

Inside the `@theme { ... }` block in `index.css`, add alongside the other color tokens:

```css
  --color-call: #14202F;   /* deep-navy video backdrop (Stage 2). Not charcoal, not #000. */
```

- [ ] **Step 2: Append the helper layer** at the end of `index.css` (after the existing `html, body, #root` block):

```css
/* ============================================================
   Stage 2 kiosk repaint helpers — seam ring/frame + motion.
   ============================================================ */
.seam-ring {
  background: var(--gradient-seam);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}

@keyframes lc-spin { to { transform: rotate(360deg); } }
@keyframes lc-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(6, 214, 160, 0.5); }
  70%  { box-shadow: 0 0 0 10px rgba(6, 214, 160, 0); }
  100% { box-shadow: 0 0 0 0 rgba(6, 214, 160, 0); }
}
@keyframes lc-shimmer { to { background-position: -150% 0; } }

.lc-anim-spin    { animation: lc-spin 3.2s linear infinite; }
.lc-anim-spin-fast { animation: lc-spin 1.1s linear infinite; }
.lc-anim-pulse   { animation: lc-pulse 2s ease-out infinite; }
.lc-anim-shimmer {
  background: linear-gradient(90deg, var(--color-muted) 0 40%, var(--color-live) 50%, var(--color-muted) 60% 100%);
  background-size: 250% 100%;
  animation: lc-shimmer 1.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .lc-anim-spin, .lc-anim-spin-fast, .lc-anim-pulse, .lc-anim-shimmer {
    animation: none !important;
  }
}
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @lc/kiosk build
```
Expected: PASS. `bg-call`, `rounded-pill`, etc. now resolve.

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/index.css
git commit -m "feat(kiosk): add --color-call token + seam/motion helper classes"
```

---

## Task 9: State machine `CLOSE_DISCLOSURE` (TDD)

**Files:** Modify `apps/kiosk/src/state/call-machine.ts`, `apps/kiosk/tests/state/call-machine.test.ts`.

- [ ] **Step 1: Write the failing test**

In `call-machine.test.ts`, add inside the `describe`:

```ts
it("disclosure → home on close", () => {
  let s = reduce(initialState(), { type: "TAP_CALL" });
  expect(s.screen).toBe("disclosure");
  s = reduce(s, { type: "CLOSE_DISCLOSURE" });
  expect(s.screen).toBe("home");
});

it("CLOSE_DISCLOSURE is a no-op off the disclosure screen", () => {
  const s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
  expect(reduce(s, { type: "CLOSE_DISCLOSURE" }).screen).toBe("ringing");
});
```

- [ ] **Step 2: Run it (verify fail)**

```bash
pnpm --filter @lc/kiosk test -- call-machine
```
Expected: FAIL — `CLOSE_DISCLOSURE` not in the action union / not handled.

- [ ] **Step 3: Implement**

In `call-machine.ts`, add to the `KioskAction` union:

```ts
  | { type: "CLOSE_DISCLOSURE" }
```

And add a case in `reduce`, before `default`:

```ts
    case "CLOSE_DISCLOSURE":
      return state.screen === "disclosure" ? home() : state;
```

- [ ] **Step 4: Run it (verify pass)**

```bash
pnpm --filter @lc/kiosk test -- call-machine
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/state/call-machine.ts apps/kiosk/tests/state/call-machine.test.ts
git commit -m "feat(kiosk): CLOSE_DISCLOSURE transition (recording-notice X → home)"
```

---

## Task 10: Kiosk brand chrome components

**Files:** Create `apps/kiosk/src/components/brand.tsx`.

- [ ] **Step 1: Write the file**

```tsx
/** Full-width seam hairline used at the top edge of the light screens. */
export function SeamTop() {
  return (
    <div
      className="absolute inset-x-0 top-0 z-10 h-[3px]"
      style={{ background: "var(--gradient-seam)" }}
      aria-hidden
    />
  );
}

/** The "LC" seam mark (kiosk copy of the portal LogoMark). */
export function LogoMark({ className = "" }: { readonly className?: string }) {
  return (
    <span
      className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-input bg-primary text-sm font-semibold text-primary-foreground ${className}`}
      aria-hidden
    >
      LC
      <span
        className="absolute inset-x-1.5 -bottom-px h-px rounded-full"
        style={{ background: "var(--gradient-seam)" }}
      />
    </span>
  );
}

/** Thin shimmering seam line for the loading state. */
export function SeamShimmer() {
  return <div className="lc-anim-shimmer h-[3px] w-36 rounded-full" aria-hidden />;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @lc/kiosk typecheck
```
Expected: PASS (unused exports are fine; consumed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/components/brand.tsx
git commit -m "feat(kiosk): brand chrome (SeamTop, LogoMark, SeamShimmer)"
```

---

## Task 11: Shared call-control bar

**Files:** Create `apps/kiosk/src/screens/CallControls.tsx`.

- [ ] **Step 1: Write the file**

```tsx
import type { ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

function Ctrl({
  label, onClick, children, variant = "ghost",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  variant?: "ghost" | "end";
}) {
  const base =
    "grid size-14 place-items-center rounded-pill transition-transform active:scale-95 [&_svg]:size-6";
  const skin =
    variant === "end"
      ? "bg-accent-strong text-accent-foreground"
      : "border border-white/25 bg-white/10 text-white";
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex flex-col items-center gap-1.5">
      <span className={`${base} ${skin}`}>{children}</span>
      <span className="text-[11px] font-medium text-white/80">{label}</span>
    </button>
  );
}

export function CallControls({
  muted, cameraOff, onMute, onCamera, primary,
}: {
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  primary: { label: string; onClick: () => void };
}) {
  return (
    <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-end gap-3 rounded-pill border border-white/10 bg-call/70 px-3 py-2.5 backdrop-blur-sm">
      <Ctrl label={muted ? "Unmute" : "Mute"} onClick={onMute}>
        {muted ? <MicOff /> : <Mic />}
      </Ctrl>
      <Ctrl label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera}>
        {cameraOff ? <VideoOff /> : <Video />}
      </Ctrl>
      <Ctrl label={primary.label} onClick={primary.onClick} variant="end">
        <PhoneOff />
      </Ctrl>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @lc/kiosk typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/CallControls.tsx
git commit -m "feat(kiosk): shared CallControls bar (icon buttons, coral primary)"
```

---

## Task 12: Home repaint (with `ctaStyle` variants)

**Files:** Modify `apps/kiosk/src/screens/Home.tsx`.

- [ ] **Step 1: Replace the file**

```tsx
import { Video } from "lucide-react";
import type { KioskConfig } from "../types";
import { SeamTop, LogoMark } from "../components/brand";

const CTA_STYLES = {
  warm:    { panel: "bg-accent-strong", text: "text-white",  sub: "text-white/80", greet: "text-foreground" },
  accent:  { panel: "bg-primary",       text: "text-accent", sub: "text-white/70", greet: "text-foreground" },
  classic: { panel: "bg-primary",       text: "text-white",  sub: "text-white/80", greet: "text-accent-strong" },
} as const;

function InfoItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const wifi =
    config.wifiNetwork && config.wifiPassword
      ? `${config.wifiNetwork} / ${config.wifiPassword}`
      : config.wifiNetwork;
  const s = CTA_STYLES[config.ctaStyle] ?? CTA_STYLES.warm;

  return (
    <div className="relative flex h-full">
      <SeamTop />
      {/* Left 55% — info */}
      <div className="flex flex-[0_0_55%] flex-col px-12 py-11">
        <div className="flex items-center gap-3">
          {config.logoUrl ? (
            <img src={config.logoUrl} alt="" className="size-9 rounded-input object-cover" />
          ) : (
            <LogoMark />
          )}
          <span className="font-label text-xs font-semibold uppercase tracking-[0.13em] text-foreground">
            {config.welcomeHeading}
          </span>
        </div>

        <h1 className={`mt-7 font-display text-5xl leading-[1.04] ${s.greet}`}>
          {config.welcomeHeading}
        </h1>
        {config.welcomeMessage ? (
          <p className="mt-4 max-w-[92%] text-lg leading-relaxed text-muted-foreground">
            {config.welcomeMessage}
          </p>
        ) : null}

        <div className="mt-auto grid grid-cols-2 gap-x-8 gap-y-5">
          <InfoItem label="Check-in" value={config.checkinTime} />
          <InfoItem label="Check-out" value={config.checkoutTime} />
          <InfoItem label="Wi-Fi" value={wifi ?? null} />
          <InfoItem label="Breakfast" value={config.breakfastHours} />
        </div>
      </div>

      {/* Right 45% — action */}
      <button
        type="button"
        onClick={onCall}
        className={`relative flex flex-[0_0_45%] flex-col items-center justify-center gap-4 px-8 text-center transition-transform active:scale-[0.99] ${s.panel}`}
      >
        <Video className={`size-14 ${s.text}`} strokeWidth={1.75} />
        <span className={`font-display text-3xl leading-tight ${s.text}`}>
          Talk to the Front Desk
        </span>
        <span className={`text-sm ${s.sub}`}>One tap — a real person answers</span>
      </button>
    </div>
  );
}
```

Notes: the first small line and the big greeting both use `welcomeHeading` (small = brand label, large = the display greeting) — matching the mockup's "hotel name (label) + greeting (display)". If you prefer the big line to be a fixed greeting, that is a copy task, not structural; keep `welcomeHeading` to honor the owner-configured value.

- [ ] **Step 2: Build + eyeball**

```bash
pnpm --filter @lc/kiosk build
```
Then `pnpm dev:kiosk` → Home shows the 55/45 split, coral action panel (default `warm`), Solitude greeting, mono info values, seam hairline. (To preview `accent`/`classic` before the picker is wired to your local property, temporarily hardcode `config.ctaStyle` in DevTools or via the owner picker against the dev property.)

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Home.tsx
git commit -m "feat(kiosk): repaint Home (concierge split 55/45, ctaStyle variants)"
```

---

## Task 13: Recording-notice repaint (X close + Continue)

**Files:** Modify `apps/kiosk/src/screens/RecordingNotice.tsx`.

- [ ] **Step 1: Replace the file**

```tsx
import { ShieldCheck, X } from "lucide-react";
import { SeamTop } from "../components/brand";

export function RecordingNotice({
  onOk, onClose,
}: {
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative h-full">
      <SeamTop />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-20 grid size-14 place-items-center rounded-pill border border-border bg-card text-muted-foreground shadow-sm transition-transform active:scale-95"
      >
        <X className="size-5" />
      </button>

      <div className="flex h-full items-center justify-center p-9">
        <div className="max-w-[78%] rounded-card border border-border bg-card p-11 text-center shadow-md">
          <ShieldCheck className="mx-auto mb-4 size-10 text-accent-strong" strokeWidth={1.6} />
          <h1 className="font-display text-2xl leading-snug text-foreground">
            Before we connect you
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Your call with the front desk may be recorded for training and quality. Tap continue
            when you're ready.
          </p>
          <button
            type="button"
            onClick={onOk}
            className="mt-6 rounded-button bg-accent-strong px-11 py-4 text-lg font-semibold text-accent-foreground transition-transform active:scale-[0.98]"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @lc/kiosk build
```
Expected: PASS. (App wiring of `onClose` is Task 17.)

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/RecordingNotice.tsx
git commit -m "feat(kiosk): repaint recording notice (X-to-close + coral Continue)"
```

---

## Task 14: Ringing repaint

**Files:** Modify `apps/kiosk/src/screens/Ringing.tsx`.

- [ ] **Step 1: Replace the file**

```tsx
import { useEffect, useRef } from "react";
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";
import { Phone } from "lucide-react";
import { CallControls } from "./CallControls";

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
    <div className="relative h-full overflow-hidden bg-call">
      <div ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 bg-call/45" />

      <div className="absolute left-4 top-4 rounded-pill bg-black/30 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-[0.13em] text-white/70">
        You
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white">
        <div className="relative grid place-items-center">
          <div className="seam-ring lc-anim-spin size-32 rounded-pill p-1" aria-hidden />
          <div className="absolute grid size-24 place-items-center rounded-pill bg-white/10">
            <Phone className="size-9" strokeWidth={1.6} />
          </div>
        </div>
        <div className="font-display text-3xl">Ringing the front desk…</div>
        <div className="font-mono text-sm text-white/70">Someone's almost there</div>
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

- [ ] **Step 2: Build**

```bash
pnpm --filter @lc/kiosk build
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Ringing.tsx
git commit -m "feat(kiosk): repaint Ringing (spinning seam ring, shared controls)"
```

---

## Task 15: Connected repaint

**Files:** Modify `apps/kiosk/src/screens/Connected.tsx`.

- [ ] **Step 1: Replace the file**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { CallControls } from "./CallControls";

function useElapsed(): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function Connected({
  remoteVideo, localVideo, muted, cameraOff, onMute, onCamera, onEnd,
}: {
  remoteVideo: IRemoteVideoTrack | null;
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
}) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed();
  useEffect(() => { if (remoteVideo && remoteRef.current) remoteVideo.play(remoteRef.current); }, [remoteVideo]);
  useEffect(() => { if (localVideo && localRef.current) localVideo.play(localRef.current); }, [localVideo]);

  return (
    <div className="relative h-full overflow-hidden bg-call">
      <div ref={remoteRef} className="absolute inset-0" />
      {/* seam frame = "connected" */}
      <div className="seam-ring pointer-events-none absolute inset-0 p-[2px]" aria-hidden />

      <div className="absolute left-4 top-4 flex items-center gap-2.5 rounded-pill border border-white/10 bg-call/60 py-1.5 pl-2.5 pr-3.5">
        <span className="lc-anim-pulse size-2.5 rounded-pill bg-live" aria-hidden />
        <span className="text-sm font-semibold leading-tight text-white">
          Connected
          <span className="block font-mono text-[10px] font-medium text-white/65">
            Front desk · {elapsed}
          </span>
        </span>
      </div>

      <div
        ref={localRef}
        className="absolute bottom-24 right-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/45"
      />

      <CallControls
        muted={muted}
        cameraOff={cameraOff}
        onMute={onMute}
        onCamera={onCamera}
        primary={{ label: "End", onClick: onEnd }}
      />
    </div>
  );
}
```

Note: the agent's name is not available on the kiosk, so the status reads **"Front desk"** (honest) rather than a person name. Duration counts from when Connected mounts.

- [ ] **Step 2: Build**

```bash
pnpm --filter @lc/kiosk build
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Connected.tsx
git commit -m "feat(kiosk): repaint Connected (seam frame, mint status, mono timer)"
```

---

## Task 16: Apology repaint (apology-only copy, visible countdown)

**Files:** Modify `apps/kiosk/src/screens/Apology.tsx`.

- [ ] **Step 1: Replace the file** (drops the `phone` prop)

```tsx
import { useEffect, useState } from "react";
import { SeamTop } from "../components/brand";

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
      <div className="flex h-full flex-col items-center justify-center px-9 text-center">
        <h1 className="max-w-[80%] font-display text-3xl leading-tight text-foreground">
          Sorry to keep you waiting.
        </h1>
        <p className="mt-3.5 max-w-[70%] text-base leading-relaxed text-muted-foreground">
          {message ??
            "The front desk is helping another guest right now. Please try again in a couple of minutes."}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Returning to home in {Math.max(0, left)}s…
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @lc/kiosk build
```
Expected: may FAIL typecheck at the `App.tsx` call site (still passes `phone`). That is fixed in Task 17; if running this task in isolation, proceed to Task 17 before re-running the gate.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Apology.tsx
git commit -m "feat(kiosk): repaint Apology (apology-only copy, visible countdown, drop phone)"
```

---

## Task 17: App.tsx — Loading, Reconnecting, dispatch wiring

**Files:** Modify `apps/kiosk/src/App.tsx`.

- [ ] **Step 1: Update imports**

Add to the top of `App.tsx`:

```tsx
import { LogoMark, SeamShimmer } from "./components/brand";
```

- [ ] **Step 2: Replace the Loading branch**

Replace the `if (!config) { return ... }` block with:

```tsx
  if (!config) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <LogoMark className="size-12" />
        <SeamShimmer />
      </div>
    );
  }
```

- [ ] **Step 3: Wire RecordingNotice + Apology props**

In the `screen` switch, update the `disclosure` and `apology` cases:

```tsx
      case "disclosure":
        return <RecordingNotice onOk={onAccept} onClose={() => dispatch({ type: "CLOSE_DISCLOSURE" })} />;
```

```tsx
      case "apology":
        return <Apology message={config.apologyMessage} onDone={() => dispatch({ type: "DISMISS_APOLOGY" })} />;
```

(Removes the now-unused `phone={config.phoneNumber}` prop.)

- [ ] **Step 4: Repaint the ReconnectingOverlay**

Replace the `ReconnectingOverlay` function body with:

```tsx
function ReconnectingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3.5 bg-call/[0.66] text-white">
      <div className="seam-ring lc-anim-spin-fast size-14 rounded-pill p-[3px]" aria-hidden />
      <div className="text-lg font-semibold">Reconnecting…</div>
      <div className="text-sm text-white/70">Hold tight — we're getting you back</div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build (full kiosk)**

```bash
pnpm --filter @lc/kiosk typecheck && pnpm --filter @lc/kiosk build
```
Expected: PASS (Apology arity now matches).

- [ ] **Step 6: Eyeball the full flow**

`pnpm dev:kiosk` → drive: Home → tap action → recording notice (X returns home; Continue proceeds) → Ringing (spinning seam ring) → Connected (seam frame + mint status + timer) → End → Home. Toggle OS reduced-motion: ring/pulse/shimmer go static. Trigger a no-answer to see the repainted Apology.

- [ ] **Step 7: Commit**

```bash
git add apps/kiosk/src/App.tsx
git commit -m "feat(kiosk): repaint Loading + Reconnecting, wire close-disclosure + apology props"
```

---

## Task 18: Full verification gate

**Files:** none.

- [ ] **Step 1: Run the complete gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green.

- [ ] **Step 2: Confirm no stray hex outside the token files**

```bash
grep -rnE "#[0-9a-fA-F]{6}\b" apps/kiosk/src | grep -v "index.css"
```
Expected: **no output**. (All kiosk hex now lives in `index.css`. The `rgba(...)` whites/blacks inside helper classes/components are token-orthogonal opacity utilities, not brand-hex; the deferred `#27272a`/`#b91c1c`/`#000` are gone.)

- [ ] **Step 3: Confirm reduced-motion + targets (manual)**

Eyeball checklist: every control ≥ 56px (close X = 56px), reduced-motion stills the seam/pulse/shimmer, mint status always pairs with the word "Connected".

---

## Task 19: Apply migration + open PR

**Files:** none.

- [ ] **Step 1: Apply migration 0015 to prod**

Per the deploy workflow (Supabase MCP can write to prod ref `ztunzdpmazwwwkxcpyfp`), apply `supabase/migrations/0015_kiosk_cta_style.sql`. Verify: `select kiosk_cta_style from properties limit 1;` returns `warm` for existing rows, and an OWNER update of a non-kiosk column still raises.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/ui-ux-stage2-kiosk
gh pr create --base main --title "feat(ui): UI/UX Stage 2 — kiosk repaint + owner-selectable Home style" --body "$(cat <<'EOF'
## Summary
Stage 2 surface 1 of 3 (kiosk). Repaints every guest-facing screen to the locked brand and adds an owner-configurable Home style.

- Home (concierge split 55/45) with owner-selectable `kiosk_cta_style` (warm/accent/classic, default warm).
- Recording notice (X-to-close + coral Continue), Ringing & Connected (seam ring → seam frame motif, shared CallControls, coral End/Cancel), Apology (apology-only copy, visible countdown), Reconnecting + Loading.
- New `--color-call` deep-navy token; `CLOSE_DISCLOSURE` state transition; removed the deferred hardcoded hex.
- Owner picker in the kiosk-content card; migration 0015 (column + guard whitelist), config API + `KioskConfig.ctaStyle`.

Spec: `docs/specs/2026-06-07-stage2-kiosk-repaint-design.md` · Plan: `docs/plans/2026-06-07-stage2-kiosk-repaint.md`

## Verification
`pnpm typecheck && lint && test && build` green. Migration 0015 applied. Full kiosk flow + each preset + reduced-motion eyeballed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update CLAUDE.md build-status table**

Add a Stage 2 (kiosk) row to the build-status table noting the repaint + `kiosk_cta_style` + migration 0015, and commit.

---

## Self-review notes (author)

- **Spec coverage:** §3.1 Home → Task 12; §3.2 recording notice → Task 13; §3.3 Ringing → Task 14; §3.4 Connected → Task 15; §3.5 Apology → Task 16; §3.6 Reconnecting/Loading → Task 17; §3.7 control bar → Task 11; §4 owner style (data/kiosk/owner UI) → Tasks 2/3/7/5/6; §5 dark token → Task 8; §6 state machine → Task 9; §7 motion/a11y → Tasks 8/11 + Task 18 checks. Hex cleanup → Task 18.
- **Type consistency:** `KioskCtaStyle` / `KIOSK_CTA_STYLES` defined in Task 4, used in Tasks 5/6; `ctaStyle` added in Task 7 (kiosk) + Task 3 (API); `CLOSE_DISCLOSURE` defined + used in Tasks 9/17; `CallControls` signature defined in Task 11, used in Tasks 14/15; `SeamTop`/`LogoMark`/`SeamShimmer` defined in Task 10, used in Tasks 12/13/16/17.
- **Deviations from mockups (intentional):** Connected status uses "Front desk" not a person name (kiosk has no agent identity); `accent` preset sub-line uses near-white not coral (AA at small size). Both noted in the spec/tasks.
- **Out of scope (per spec):** owner-portal repaint, agent/admin, any voice/Agora logic.
