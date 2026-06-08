# UI/UX Stage 3 — States · Motion · A11y · Copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final UI/UX phase — cross-cutting polish of states (empty/loading/error),
motion, accessibility (formal WCAG 2.1 AA audit + remediation), and copy — across all surfaces,
without touching features, routes, migrations, or call logic.

**Architecture:** Token/CSS layer (motion), two new presentational primitives (`EmptyState`,
`ErrorState`), one pure copy module per app, and a written WCAG report that drives a11y
remediation. Logic-orthogonal (Stage 2 pattern). Mirrored portal⇄kiosk where the CSS layer is
involved.

**Tech Stack:** Next.js 15 App Router (RSC), Vite (kiosk), TypeScript, Tailwind v4 `@theme`,
shadcn primitives, Vitest, pnpm monorepo.

**Spec:** `docs/specs/2026-06-08-stage3-states-motion-a11y-copy-design.md`
**Branch:** `feat/ui-ux-stage3-states-motion-a11y-copy` (cut from `main` @ `plan-stage2-agent-admin-complete`; spec + this plan committed first).

---

## Conventions (read once)

- **Run one test:** `cd apps/portal && pnpm test -- <path>`. `pnpm test` = `vitest run`.
- **Gates:** portal `cd apps/portal && pnpm typecheck · pnpm lint · pnpm build`; kiosk
  `cd apps/kiosk && pnpm typecheck · pnpm build`.
- **Tests** live in `apps/portal/tests/<area>/<name>.test.ts`; source under `apps/portal/lib/`
  and `apps/portal/components/`. Import via `@/...`; shared types `@lc/shared`.
- **No hardcoded hex** in components — brand hex only in the CSS `@theme`/keyframe layer beside
  `--gradient-seam`. Components use tokens/utilities.
- **Reuse before adding.** Only `EmptyState` + `ErrorState` are new components.
- **Don't regress the shipped Stage 2 repaints** — states/motion/a11y/copy on top; no layout churn.
- **RSC boundary (Next 15.5):** never pass a lucide *component* from a Server Component to a Client
  Component. `EmptyState` renders icons internally and is used from client list/table children, or
  servers pass a pre-rendered element.

---

## Task 1: Formal WCAG 2.1 AA audit (report artifact — do FIRST)

The report's Fail list seeds Task 9's remediation, so it runs before the a11y fixes (but can run in
parallel with Tasks 2–6, which don't depend on it).

**Files:** Create `docs/audits/2026-06-08-wcag-2.1-aa-audit.md`.

- [ ] **Step 1:** Using the `design:accessibility-review` skill as the rubric, audit all surfaces
  (kiosk, owner, agent, admin, auth) criterion-by-criterion for WCAG 2.1 **Level A + AA**. Record
  Pass / Fail / N/A per applicable SC with `file:line` evidence + a remediation note per Fail.
- [ ] **Step 2:** **Measure contrast** (devtools / a contrast calc) for every brand-token text
  pairing the spec §5.1 lists — especially `--color-muted-foreground #64748B` on `#F6F8FA`/`#FFFFFF`
  and `--color-accent-strong #E05A39` as body text/link on white. Record the computed ratio + the
  size/weight at which it passes/fails. These numbers decide the Task 9 contrast fixes.
- [ ] **Step 3:** Cover at minimum the SC list in spec §5.1 (1.1.1, 1.3.1, 1.4.1, 1.4.3, 1.4.11,
  2.1.1/2, 2.4.3, 2.4.7, 2.5.5/8, 4.1.2, 4.1.3).
- [ ] **Acceptance:** the report exists, every Fail has a concrete remediation, and the Fail list is
  copied into Task 9 as the authoritative fix list.

---

## Task 2: Motion tokens (both apps)

**Files:** `apps/portal/app/globals.css`, `apps/kiosk/src/index.css`.

- [ ] **Step 1:** Add to each app's `@theme` block the five motion tokens from spec §3.1
  (`--ease-out`, `--ease-in-out`, `--duration-fast/standard/slow`). Identical values in both files.
- [ ] **Step 2:** No component rewrites here beyond the primitive in Task 4 — this task only
  introduces the tokens.
- [ ] **Acceptance:** both apps build; tokens resolve (spot-check via a utility using
  `var(--ease-out)`).

---

## Task 3: `prefers-reduced-motion` universal net + ad-hoc fixes

**Files:** `apps/portal/app/globals.css` (+ audit portal components for bare `animate-[...]`).

- [ ] **Step 1:** Add the global reduced-motion safety net (spec §3.5) to portal `globals.css`.
  Confirm the kiosk's existing block (`index.css:117-121`) still covers its animations and will
  cover the new seam drift.
- [ ] **Step 2:** Grep portal for `animate-[` / `animate-spin` / `animate-pulse` used without
  `motion-reduce:animate-none`; the global net now covers them, but add the explicit utility where a
  component owns a *looping decorative* animation (softphone glow already has it — verify the rest).
- [ ] **Acceptance:** with `prefers-reduced-motion: reduce` emulated, no looping/movement animation
  runs in either app; comprehension cues (color/dot states) remain.

---

## Task 4: Seam drift + Button press + Skeleton timing

**Files:** `apps/portal/app/globals.css`, `apps/kiosk/src/index.css`,
`apps/portal/components/ui/button.tsx`, `apps/portal/components/ui/skeleton.tsx`,
+ the active-call surfaces that should drift (`components/softphone/softphone.tsx`,
`apps/kiosk/src/screens/Connected.tsx`, and the in-call seam edge / video PiP frame).

- [ ] **Step 1 (seam drift CSS):** Add `@property --seam-angle` + `@keyframes lc-seam-drift` +
  `.lc-seam-drift` (spec §3.2) to both CSS files. 8s linear, reduced-motion off via Task 3 net (+
  the kiosk explicit block — add the new class name there).
- [ ] **Step 2 (apply drift):** Apply `.lc-seam-drift` to the **active/connected** seam surfaces
  only — softphone idle ring + in-call edge (portal), `Connected` caller ring (kiosk). Leave the
  static header hairline and the dashboard/tables untouched (spec §3.2 frequency rule).
- [ ] **Step 3 (Button press):** In `button.tsx`, narrow `transition-all` →
  `transition-[color,box-shadow,transform]` and add `active:scale-[0.98]` (composed; not on
  `:disabled`). Verify focus ring/hover unchanged.
- [ ] **Step 4 (Skeleton):** Replace stock `animate-pulse` with the brand shimmer/soft-pulse
  (spec §3.4), reduced-motion-safe. Tune by eye.
- [ ] **Acceptance:** drift is subtle on active-call surfaces and absent elsewhere; buttons confirm
  press; skeletons read calm + on-brand; both apps build.

---

## Task 5: `EmptyState` + `ErrorState` primitives

**Files:** Create `apps/portal/components/ui/empty-state.tsx`,
`apps/portal/components/ui/error-state.tsx`. Optional render tests under
`apps/portal/tests/components/`.

- [ ] **Step 1:** Build `EmptyState` per spec §4.1 (icon chip, title, description, optional action;
  brand tokens; renders the lucide icon internally). `ErrorState` is its sibling (icon + title +
  description + retry action) for route error boundaries.
- [ ] **Step 2:** If a render test fits the existing harness, add one asserting icon/title/
  description/action render. Otherwise rely on typecheck + visual.
- [ ] **Acceptance:** both render on-brand; typecheck/lint clean; RSC boundary respected (client
  component or used only from client/children).

---

## Task 6: Wire `EmptyState` into every zero-item case

**Files:** the 9 call sites in spec §4.1 table.

- [ ] **Step 1:** Replace each plain-text empty case with `<EmptyState>`. Table empties
  (users/properties/audit) render in a full-span row, not a bare `<td>` string.
- [ ] **Step 2:** Add an **action** only to admin users + admin properties (open the existing create
  dialog). Owner/agent reads stay action-less (Stage 0: no CTA without a target).
- [ ] **Step 3:** Pull each empty-state title/description from `lib/copy` (Task 7) — sequence after
  Task 7 or stub strings then swap.
- [ ] **Acceptance:** every listed surface shows the on-brand empty state; no regressions to
  populated views; build green.

---

## Task 7: Copy module (portal + kiosk)

**Files:** Create `apps/portal/lib/copy.ts`, `apps/kiosk/src/lib/copy.ts`; modify
`apps/portal/lib/auth/sign-in-errors.ts` + its test.

- [ ] **Step 1 (failing test):** Update `tests/auth/sign-in-errors.test.ts` (or add one) to assert
  `mapSignInError` returns the re-voiced strings sourced from `copy.auth`. Add a shape test for
  `copy` if useful.
- [ ] **Step 2:** Create `lib/copy.ts` (spec §6.1 shape) and `apps/kiosk/src/lib/copy.ts`. Migrate
  sign-in error strings into `copy.auth`; `mapSignInError` reads from it (logic unchanged).
- [ ] **Step 3 (voice pass):** Re-voice migrated + empty + error strings per spec §6.2 (calm,
  actionable, no codes, no blame). Keep the sign-in **default** generic on purpose (security).
- [ ] **Acceptance:** tests green; sign-in/onboarding still map errors correctly; strings read
  on-voice.

---

## Task 8: Error surfaces + kiosk Loading screen

**Files:** `apps/portal/app/global-error.tsx`; new `app/(agent)/error.tsx`,
`app/(admin)/error.tsx`, `app/(owner)/error.tsx`; kiosk error fallback +
`apps/kiosk/src/screens/Loading.tsx` (+ wire into `App.tsx`).

- [ ] **Step 1:** Repaint `global-error.tsx` on-brand (spec §4.2) — card, seam hairline,
  `AlertTriangle` chip (navy/muted, not red), copy from `lib/copy.error.global`, single coral retry.
  Keep Sentry capture; keep it self-contained (no dependence on root-layout fonts/CSS).
- [ ] **Step 2:** Add segment `error.tsx` to `(agent)`/`(admin)`/`(owner)` using `<ErrorState>` +
  `copy.error.segment` + `reset()` retry. (Client components — error boundaries must be.)
- [ ] **Step 3:** Confirm the kiosk `ErrorBoundary` (session 6) fallback is on-brand (icon + calm
  copy from kiosk `copy`), not a raw stack. Add the kiosk **Loading** screen (seam-ring spin + one
  reassuring line) shown until config/app-ready; reduced-motion-safe.
- [ ] **Acceptance:** throwing in a segment shows the on-brand card with working retry; global error
  is on-brand; kiosk shows Loading on first paint + an on-brand error fallback. Both apps build.

---

## Task 9: A11y remediation (driven by Task 1 report)

**Files:** per the Task 1 Fail list + spec §5.2 seed list (kiosk screens/CallControls, sonner
`Toaster`, sign-in form labels, contrast token usages, focus-ring-on-fills).

- [ ] **Step 1:** Implement every Level A/AA Fail from the Task 1 report (`docs/audits/2026-06-08-
  wcag-2.1-aa-audit.md` §5). The contrast token changes are **locked (audit §6)**:
  - **D1 (coral CTA):** keep `--color-accent-strong #E05A39`. Make every white-on-coral CTA label
    **≥18.66px (1.1667rem) + bold (≥700)** (or ≥24px) so 3.69:1 passes as large text — primary
    `Button` coral variant, softphone **Hang up**, video **End**, kiosk **Continue**. Any coral
    button that can't be that large (e.g. `size="sm"` table-row action) → switch to **navy** fill.
  - **D2 (input borders):** set `--color-input` → `#919598` (form controls only); leave
    `--color-border #E1E7EC`. Verify inputs use `border-input`, decorative dividers don't.
  - Mechanical contrast: `--color-muted-foreground #64748B → #5E6E85`; `--color-live-foreground
    #048A67 → #048765`; add `--color-accent-text #C85033` and apply to the ≈13 coral text/link
    sites; mint **Accept** button → navy `#2C425C` text on mint.
  - Mechanical structural: **skip-to-content** link in `(agent)`/`(admin)`/`(owner)` layouts (+
    `<main id="main">`); `sr-only`/visible `<h1>` on agent dashboard + owner home; kiosk
    "Reconnecting…" → `role="status" aria-live="polite"`; `sr-only` "Opens in new tab" on external
    links; kiosk CTA-style picker → `radiogroup`; confirm kiosk logo `alt` intent; normalize
    sign-in/forgot labels to `htmlFor`/`id`; **preserve the focus-ring `ring-offset` on the Button
    refactor** (it's what makes the coral ring pass — audit §0).
- [ ] **Step 2:** Re-check each fixed criterion; update the Task 1 report Fail→Pass with the fix
  reference.
- [ ] **Acceptance:** no remaining Level A/AA Fails (or each remaining one has a documented,
  accepted justification — e.g. the deliberately-generic sign-in copy); no visual regression to
  shipped repaints.

---

## Task 10: Verify + tag

- [ ] **Step 1:** Portal gates green (`typecheck`, `lint`, `build`); kiosk gates green
  (`typecheck`, `build`). Full Vitest suite green (≥ 347).
- [ ] **Step 2:** Visual + a11y spot-check in the running apps: empty/error/loading states on-brand;
  seam drift subtle + killed by reduced-motion; focus order + visible focus on a portal form and the
  kiosk flow; one screen-reader pass on the kiosk call flow + a portal form; contrast values
  confirmed in devtools.
- [ ] **Step 3:** Run `superpowers:requesting-code-review` (whole-branch) as the final gate, like the
  Stage 2 repaints.
- [ ] **Step 4:** Update `MEMORY.md` + `memory/project-status.md` (mark the UI/UX Stage 3 row done,
  note all UI/UX stages complete). `git tag plan-stage3-states-motion-a11y-copy-complete`.

---

## Ordering & parallelism

- **Task 1 (audit)** runs first/parallel — it gates only Task 9.
- **Tasks 2→3→4** are the motion chain (tokens → reduced-motion → drift/press/skeleton), in order.
- **Task 7 (copy)** before **Task 6** wire-in and **Task 8** error copy (or stub then swap).
- **Task 5** (components) before **Task 6** + **Task 8**.
- **Task 9** after Task 1 + after the components/copy land (it touches some of the same files).
- **Task 10** last.
