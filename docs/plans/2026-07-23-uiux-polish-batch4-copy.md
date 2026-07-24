# UI/UX Polish — Batch 4 (Copy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the copy tranche of the whole-app UI/UX audit — an `impeccable clarify` pass against `docs/brand/ui-copy-guide.md` (lead rule: *"talk to the person, not the interface"*), leading with the manual-speak / state-narration class, plus an em-dash purge, terminology unification to "Property," and four factual fixes.

**Architecture:** Almost entirely string edits. No logic, no data flow, no layout changes. The one structural touch is the softphone idle captions (in a regression-guard file — edit ONLY the caption strings, never the surrounding logic). Batch 4 of the five-batch plan (`docs/plans/2026-07-21-uiux-polish.md`); spec = `docs/brand/ui-copy-guide.md` + audit Theme F (em dashes) + the "Factual defects" section of `docs/audits/2026-07-20-whole-app-uiux-audit.md`. Zero migrations / API routes / RLS / call-logic.

**Tech Stack:** Next.js App Router (portal) + Vite (kiosk), Tailwind v4 tokens, Vitest + Testing Library (jsdom).

---

## Locked decisions (approved by Kumar 2026-07-23 — do NOT relitigate)

1. **Empty states → tighten** the milder "…will appear/show here" narration to person-facing calm status (exact strings in Task 2).
2. **Terminology → "Property"** everywhere user-facing (guest still sees the property's real name). "Property" over "hotel" generally — including **"Property local time"** (agent-facing in-call label) and **"property PC"** (admin remote-access card).
3. **Forgot-password page LEFT AS-IS.** Do NOT rebuild it. Instead add a "**Forgot your password? Contact your administrator.**" line to the **sign-in form** (the surface users actually hit). Rationale: SMTP (Supabase Pro + Google Workspace) lands in ~1–2 months and the orphan `/forgot-password` page isn't linked from anywhere; not worth the churn now.
4. **`<meta>` description** → make industry-neutral now (`"After-hours front desk, staffed by real people."`) + leave a marketing-site SEO reminder in `docs/v2-backlog.md`. The portal is auth-gated (no real SEO surface), so dropping "hotels" here costs nothing.
5. **911 dialog copy** → em-dash purge ONLY; wording otherwise byte-preserved (safety copy tuned in Stage 2). See Task 3.
6. **Softphone idle voice** (approved before/after in Task 1): on-duty "You're on. We'll ring you." · off-duty "Ready when you are." · admin covering "We'll ring you for any property you're covering." · line pill "Ready" · error "Your line dropped. Reload to reconnect."

## Constraints (ALL tasks)

- **Zero migrations / API routes / RLS / call-logic.** This is a copy batch.
- **Do NOT touch the regression guards.** The 911 *machinery* (conference/mute/dispatch logic), notes handlers, `handleConnect`, and the `softphone.tsx` accept-gate stay byte-identical. Task 1 edits softphone idle-caption **strings only**; Task 3 edits 911 **display strings only** (never the emergency handlers). If a task's diff would touch guard *logic*, STOP and flag.
- **Edit the REAL files, never a `" 2.tsx"` byte-copy.** The 16 macOS ` 2.tsx`/` 2.ts` dupes are dead (the space breaks the import path); Batch 5 `git clean`s them. All paths below point to canonical files.
- **Sentence case** for all source strings (the `font-label` class does any uppercasing visually). **No em dashes** (`—`) or `--` in prose; the standalone `"—"` empty-data-cell placeholder is exempt.
- **`presenceLabel`/`callStateLabel` etc. already exist** in `apps/portal/lib/owner/format.ts` — reuse them, never re-map an enum inline.
- **Tooling facts:**
  - Component tests: `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts <substr>`
  - Lib/plain tests: `pnpm --filter @lc/portal exec vitest run <substr>`
  - Kiosk tests: `pnpm --filter @lc/kiosk exec vitest run <substr>` (kiosk tests live under `apps/kiosk/tests/**` or co-located per that app's setup — read a sibling test first).
  - **`@testing-library/jest-dom` is NOT installed** — use `getByText(...)`/`getByRole(...)` + `.toBeTruthy()`, `expect(str).toContain(...)`, `.not.toContain(...)`. Never `.toBeInTheDocument()`.
  - **Before any `typecheck`/`build`:** `find apps/portal/.next/types -name "* 2.ts" -delete` (the ` 2.tsx` dupes spawn stale `.next/types/* 2.ts` that break typecheck).
  - eslint: prefer `pnpm -F @lc/portal exec eslint <changed files>` (a stray `.claude/worktrees/` checkout trips a bare root `eslint .`).
  - `check:routes` is a **ROOT** script: `pnpm check:routes`.
- **Per-task gate (all green before commit):** the task's own test(s) · `pnpm -F @lc/portal typecheck` (or `-F @lc/kiosk`) · eslint the changed files. The controller runs the full `pnpm -F @lc/portal build` + `pnpm -F @lc/kiosk build` + `pnpm check:routes` once before the PR.
- **jsdom judges TEXT fine** (unlike pixels) — a `getByText`/value assertion is a real gate for copy. But the final arbiter for anything rendered in-app is still Kumar's live prod smoke.

---

## Task 1: Softphone idle voice (the flagship manual-speak fix)

The softphone idle face is what an agent/admin stares at for hours. Four state-narration strings violate the guide's lead rule. Edit ONLY these caption strings — the `onDuty`/`role`/`phase` ternaries, the `role="status"` live-region wrapper, and everything else stay byte-identical.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx` (lines 962, 992, 1042, 1058 — anchors below; re-confirm by content, the file shifts)
- Test: `apps/portal/tests/components/softphone.test.tsx` (extend)

Current → new:
- `:962` `{onDuty ? "Incoming calls ring here." : "Your line is offline."}` → `{onDuty ? "You're on. We'll ring you." : "Ready when you are."}`
- `:992` (admin, `role !== "AGENT"` branch) `You&apos;re dialed in for properties set to Covering.` → `We&apos;ll ring you for any property you&apos;re covering.`
- `:1042` (`phase === "error"`) `Phone line disconnected — reload to reconnect.` → `Your line dropped. Reload to reconnect.` (also removes an em dash)
- `:1058` `LinePill` label `"Line ready"` → `"Ready"`

- [ ] **Step 1 — Read the idle region** (`softphone.tsx` ~915–1080) to confirm the four anchors and that none sit inside the accept-gate / 911 / notes logic. The comment block at ~945–950 coordinates the `:962` off-duty caption with the `:1042` error line — read it; the new "Ready when you are." (off-duty) and "Your line dropped." (error) keep those two non-duplicative, so the comment's intent still holds. Lightly update that comment to match the new strings.
- [ ] **Step 2 — Write the failing test.** Extend `softphone.test.tsx` following its EXISTING harness for the idle/ready state. **Do NOT mock the duty provider** (house lesson — `[[duty-column-polish]]`); use whatever real duty setup the file already uses to reach the on-duty idle face. Assert:
  - the on-duty idle caption renders `You're on. We'll ring you.` and NOT `Incoming calls ring here.`
  - If the harness can also reach the error phase, assert `Your line dropped. Reload to reconnect.`; if not practical, cover it in Step-4 via the whole-file run + rely on the string edit + reviewer diff.
  ```tsx
  // inside the existing idle/ready describe block, using the file's existing render helper:
  expect(screen.getByText("You're on. We'll ring you.")).toBeTruthy();
  expect(screen.queryByText("Incoming calls ring here.")).toBeNull();
  ```
- [ ] **Step 3 — Run it, verify it FAILS.** `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts softphone` → the new assertion fails on the old string.
- [ ] **Step 4 — Implement** the four string swaps above (JSX apostrophes as `&apos;`). Nothing else in the file changes.
- [ ] **Step 5 — Run it, verify it PASSES** (whole file, to catch any existing assertion that referenced an old string — update those too if present).
- [ ] **Step 6 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the two files. Commit: `fix(softphone): person-facing idle copy, not state narration`.

> **LIVE-VERIFY (Kumar):** go on/off duty as agent AND admin — the idle caption + the line pill read the new copy; the covering helper shows for admin; pulling the line (or a reconnect blip) shows "Your line dropped. Reload to reconnect."

## Task 2: Empty-state tightening (kill widget narration)

The guide: an empty state earns a teaching line only when there's a real first action; otherwise a calm status beats narrating the widget. **Keep** the actionable teaching empties untouched (`adminUsers` "Add your team…", `adminProperties` "Add your first property…", admin Properties "Add a property…", Team-on-now "Assign primary agents…" — these teach a real first action). **Tighten** the narration ones below.

**Files:**
- Modify: `apps/portal/lib/copy.ts` (the `empty` block: `ownerHome`, `ownerCalls`, `ownerPropertyCalls`, `ownerIncidents`, `agentProperties`, `agentCalls`, `adminAudit`)
- Modify: `apps/portal/app/(agent)/agent/page.tsx:136` (hourly-chart empty)
- Modify: `apps/portal/app/(admin)/admin/page.tsx:254` (Tonight-chart empty) and `:354` (operator-wide Recent-calls empty)
- Modify: `apps/portal/app/(admin)/admin/calls/page.tsx:98` (filtered-empty)
- Test: `apps/portal/tests/lib/copy.test.ts` (extend if present, else create) + reuse existing page tests

`copy.ts` `empty` — description rewrites (titles unchanged):
| key | new description |
|---|---|
| `ownerHome` | `Your admin assigns them.` |
| `ownerCalls` | `It's been quiet.` |
| `ownerPropertyCalls` | `It's been quiet here.` |
| `ownerIncidents` | `Nothing's come up.` |
| `agentProperties` | `Your admin will assign the properties you cover.` |
| `agentCalls` | `Quiet so far tonight.` |
| `adminAudit` | `Nothing logged yet.` |

Inline page rewrites:
- `agent/page.tsx:136` `description="Calls you handle will chart here through the shift."` → `description="Quiet so far tonight."`
- `admin/page.tsx:254` `description="Operator-wide call volume will chart here as the shift runs."` → `description="Quiet so far tonight."`
- `admin/page.tsx:354` `description="Operator-wide call activity will show here."` → `description="Nothing yet tonight."` (differs from `:254` so the two co-located empties don't read identical)
- `admin/calls/page.tsx:98` `description="Try a different filter, or check back as the shift runs."` → `description="Try a different filter."`

- [ ] **Step 1 — Write the failing test.** In `tests/lib/copy.test.ts`, assert the new descriptions and that none of the tightened `empty` values contain the narration phrases:
  ```ts
  import { describe, it, expect } from "vitest";
  import { copy } from "@/lib/copy";

  describe("empty-state copy is person-facing (Batch 4)", () => {
    it("ownerHome points to the admin, not the widget", () => {
      expect(copy.empty.ownerHome.description).toBe("Your admin assigns them.");
    });
    it("agentCalls reads as a calm status", () => {
      expect(copy.empty.agentCalls.description).toBe("Quiet so far tonight.");
    });
    it("no tightened empty narrates the widget", () => {
      for (const v of Object.values(copy.empty)) {
        expect(v.description).not.toMatch(/will (appear|show|chart)/i);
      }
    });
  });
  ```
- [ ] **Step 2 — Run it, verify it FAILS.** `pnpm --filter @lc/portal exec vitest run copy`.
- [ ] **Step 3 — Implement** the `copy.ts` description edits + the four inline page edits above.
- [ ] **Step 4 — Run it, verify it PASSES.** Also run any existing page tests that assert an old empty string (`pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts "agent\|admin"`) and update stale assertions.
- [ ] **Step 5 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the changed files. Commit: `fix(copy): tighten empty-state narration to calm status`.

## Task 3: Em-dash purge (portal, user-facing prose)

The brand bans `—`/`--`. Purge to periods/colons/parentheses at every user-facing prose site. **Exempt:** the standalone `"—"` empty-data-cell placeholder (do NOT touch those). This is the widest task — the site list is exhaustive; fix exactly these, then grep-sweep for any straggler.

**Files (each with the exact rewrite):**

*Centralized / lib:*
- `apps/portal/lib/copy.ts:59` `…unexpected error — it's been logged. Try again, or reload the page.` → `…unexpected error. It's been logged. Try again, or reload the page.`
- `apps/portal/lib/remote-access/connect-error.ts:60` `No credentials — ask an admin.` → `No credentials. Ask an admin.`
- `:61` `No remote access configured — ask an admin.` → `No remote access configured. Ask an admin.`
- `:64` `Connect failed — try again.` → `Connect failed. Try again.`
- `:65` `Could not fetch credentials — try again.` → `Could not fetch credentials. Try again.`
- `apps/portal/lib/duty-tile/pip-document.ts:29` `target.title = "Lobby Connect — deskphone";` → `"Lobby Connect deskphone"` (window title; drop the dash — keeps it a single plain title)

*911 dialog (`apps/portal/components/softphone/audio-call-overlay.tsx`) — wording preserved, dashes only (Locked decision 5):*
- `:198` `This conferences 911 into the live call — the guest, you, and the dispatcher on one line — and logs a high-priority incident.` → `This conferences 911 into the live call: the guest, you, and the dispatcher on one line. It logs a high-priority incident.`
- `:210` `Yes — call 911` → `Yes, call 911`
- `:221` `Emergency active — 911 is being conferenced in. Stay on the line and relay the property address and room number.` → `Emergency active. 911 is being conferenced in. Stay on the line and relay the property address and room number.`
- `:355` `? "Notes save failed — retries after the call"` → `? "Notes save failed. Retries after the call."`

*Softphone / call / dashboard:*
- `apps/portal/components/call/call-detail-body.tsx:47` `Emergency — view incident` → `Emergency: view incident`
- `apps/portal/components/dashboard/shift-card.tsx:93` `Notifications blocked — rings still work in this tab` → `Notifications blocked. Rings still work in this tab.`
- `apps/portal/components/dashboard/kiosk-call-button.tsx:79` `"Already on a call — try again shortly."` → `"Already on a call. Try again shortly."`
- `:80` `"Could not start the call — try again."` → `"Could not start the call. Try again."`
- `apps/portal/components/dashboard/call-back-shortcut.tsx:68` `"Already on a call — try again shortly."` → `"Already on a call. Try again shortly."`
- `:69` `"Could not start the call — try again."` → `"Could not start the call. Try again."`

*Video call (`apps/portal/components/video-call/video-call.tsx`):*
- `:510` `You can't hear the guest yet — your browser paused the audio.` → `You can't hear the guest yet. Your browser paused the audio.`
- `:527` `"Your camera is unavailable (in use by another app?). You're connected audio-only — turn the camera on once it's free."` → `"…audio-only. Turn the camera on once it's free."` (keep the first sentence verbatim)
- `:529` `"Your microphone is unavailable. The guest may not hear you — close other apps using it or check permissions."` → `"…The guest may not hear you. Close other apps using it, or check permissions."`
- `:673` `Couldn't save notes. They're still here — retry or discard.` → `Couldn't save notes. They're still here. Retry or discard.`
- `:738` `? "Notes save failed — retries after the call"` → `? "Notes save failed. Retries after the call."`

*App pages / actions / toasts:*
- `apps/portal/app/(admin)/admin/users/users-table.tsx:101` `"User created. Share their temporary password — they'll set their own at first sign-in."` → `"…temporary password. They'll set their own at first sign-in."`
- `:289` `"Password reset. Share the temporary password — they'll set a new one at next sign-in."` → `"…temporary password. They'll set a new one at next sign-in."`
- `apps/portal/app/(admin)/admin/shifts/shifts-table.tsx:371` `<DialogTitle>Edit shift — {row.name}</DialogTitle>` → `<DialogTitle>Edit shift: {row.name}</DialogTitle>`
- `apps/portal/app/(admin)/admin/availability-cards.tsx:37` `aria-label={`Covering — ${propertyName}`}` → `` aria-label={`Covering: ${propertyName}`} `` (aria-label; the visible "Covering" label was added in Batch 3 — leave that)
- `apps/portal/app/(admin)/admin/properties/actions.ts:430` `error: "This assignment just changed — please refresh and try again."` → `"This assignment just changed. Please refresh and try again."`
- `apps/portal/app/(admin)/admin/properties/[id]/kiosk-link-card.tsx:32` `"Couldn't copy — select the link and copy manually."` → `"Couldn't copy. Select the link and copy manually."`
- `:51` `a long-lived signed token — treat it like a password.` → `a long-lived signed token. Treat it like a password.`
- `apps/portal/app/(admin)/admin/properties/[id]/remote-access-card.tsx:109` `hotel PC. Stored for the Connect deep link on the agent dashboard —` → `property PC. Stored for the Connect deep link on the agent dashboard.` (drop the trailing dash; the "hotel PC" → "property PC" here is Task 5 — if Task 5 already ran, only the dash remains; if not, do both, they're the same line)
- `apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx:32` `"Pop-up blocked — allow pop-ups for this site to view the playbook."` → `"Pop-up blocked. Allow pop-ups for this site to view the playbook."`
- `apps/portal/app/(owner)/owner/properties/[id]/actions.ts:79` `error: "Couldn't save — please refresh and try again."` → `"Couldn't save. Please refresh and try again."`
- `apps/portal/app/(owner)/owner/incidents/[id]/actions.ts:44` `error: "Couldn't resolve — please refresh and try again."` → `"Couldn't resolve. Please refresh and try again."`

*Ambiguous — stored into `incidents.notes`, surfaced in the incident view (treat as user copy):*
- `apps/portal/app/api/calls/[id]/emergency/route.ts:208` `"guest may be stranded — relay 911 verbally / have guest dial 911 directly"` → `"guest may be stranded. Relay 911 verbally, or have the guest dial 911 directly."` (also drops the slash). ⚠ This is in the emergency route file but is a NOTE STRING, not dispatch logic — confirm you're editing only the string literal, not the conference/mute handlers.

**Files:**
- Modify: all files above
- Test: `apps/portal/tests/lib/copy.test.ts` (+ a `connect-error` value assertion)

- [ ] **Step 1 — Write the failing test.** Add a guard over the two data-copy modules (clean — no comments in the values):
  ```ts
  import { copy } from "@/lib/copy";
  import { connectErrorMessage } from "@/lib/remote-access/connect-error";
  // walk every string value in copy.* and assert no em dash:
  const strings: string[] = [];
  (function walk(o: unknown) {
    if (typeof o === "string") strings.push(o);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  })(copy);
  it("copy.ts has no em dashes", () => {
    for (const s of strings) expect(s).not.toContain("—");
  });
  ```
  (Only `copy.ts` is cleanly walkable. The scattered JSX/action sites are verified by the reviewer's diff + Step 4's grep — a component test per site is not worth it for a mechanical swap.)
- [ ] **Step 2 — Run it, verify it FAILS** (`copy.ts:59` still has the dash).
- [ ] **Step 3 — Implement** every rewrite above.
- [ ] **Step 4 — Verify no straggler.** Run:
  `grep -rn "—" apps/portal/app apps/portal/components apps/portal/lib | grep -v "/\* \|// \|\* " | grep -v '>—<\|"—"\|return "—"'`
  Manually confirm every remaining hit is either a code COMMENT (docblock/inline `//`) or the exempt `"—"` placeholder glyph. If any user-facing prose dash remains, fix it. (Comments keep their em dashes — the guide governs user-facing copy only.)
- [ ] **Step 5 — Run the test, verify it PASSES.**
- [ ] **Step 6 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the changed files. Commit: `fix(copy): purge em dashes from portal user-facing copy`.

> The 911 rewrites touch DISPLAY STRINGS only. If your diff of `audio-call-overlay.tsx` or `emergency/route.ts` shows any change outside a string literal, revert that hunk.

## Task 4: Kiosk copy — em-dash purge + drop the stale recording note

Two kiosk em dashes, plus factual fix 4c: recording was removed in v1, so the "Calls may be recorded for quality" note is false (and renders ~4.1:1, below AA). Remove the note and its render site.

**Files:**
- Modify: `apps/kiosk/src/lib/copy.ts` (`:12`, `:31`, and remove `:22` `recordingNote`)
- Modify: `apps/kiosk/src/screens/Ringing.tsx:48` (remove the `{copy.ringing.recordingNote}` render + its wrapper element)
- Test: `apps/kiosk/tests/` — a kiosk copy test (read a sibling kiosk test first for the harness; kiosk is Vite, not Next).

Rewrites:
- `copy.ts:12` `reconnecting: "Reconnecting you to the front desk — one moment."` → `"Reconnecting you to the front desk. One moment."`
- `copy.ts:31` `subtitle: "Hold tight — we're getting you back."` → `"Hold tight. We're getting you back."`
- `copy.ts:22` remove the `recordingNote: "Calls may be recorded for quality",` line entirely (it's the only property being deleted from `ringing`; `title`/`subtitle` stay).

- [ ] **Step 1 — Read** `apps/kiosk/src/screens/Ringing.tsx` around `:48` to see how `recordingNote` is wrapped (a `<p>`/`<span>`), so you remove the render element cleanly (no empty node left behind). Read one existing kiosk test for the render/assert pattern.
- [ ] **Step 2 — Write the failing test.** Assert the kiosk `copy.ringing` no longer exposes `recordingNote` and that the two reconnect strings have no em dash:
  ```ts
  import { describe, it, expect } from "vitest";
  import { copy } from "../src/lib/copy"; // adjust to the kiosk harness's import style
  describe("kiosk copy (Batch 4)", () => {
    it("dropped the stale recording note", () => {
      expect("recordingNote" in copy.ringing).toBe(false);
    });
    it("no em dashes in reconnect copy", () => {
      expect(copy.home.reconnecting).not.toContain("—");
      expect(copy.reconnecting.subtitle).not.toContain("—");
    });
  });
  ```
- [ ] **Step 3 — Run it, verify it FAILS.** `pnpm --filter @lc/kiosk exec vitest run <the test file>`.
- [ ] **Step 4 — Implement:** delete the `recordingNote` line in `copy.ts`, purge the two em dashes, and remove the `{copy.ringing.recordingNote}` element in `Ringing.tsx` (delete the wrapping node, leave surrounding layout intact). TypeScript will flag the dead reference if you miss it.
- [ ] **Step 5 — Run it, verify it PASSES.**
- [ ] **Step 6 — Gate + commit.** `pnpm -F @lc/kiosk typecheck` · eslint the changed files · `pnpm -F @lc/kiosk exec vitest run` (whole kiosk suite — the Ringing screen may have a test asserting the note; update it). Commit: `fix(kiosk): drop stale recording note; purge em dashes`.

> Guest-facing surface — Kumar's kiosk smoke confirms the Ringing screen still lays out correctly with the note gone.

## Task 5: Terminology → "Property" + neutral `<meta>`

One noun everywhere user-facing. The guest still sees the property's real NAME (kiosk `welcomeHeading` — DO NOT touch). Do NOT rename code identifiers (`SingleHotel`/`MultiHotel`/`useHotelClock`/`data-testid="hotel-clock-chip"`), comments, or the DB.

**Files:**
- Modify: `apps/portal/app/(owner)/owner/page.tsx:94` — `<h1 className="sr-only">Your hotel</h1>` → `Your property` (sr-only heading; if the owner may have multiple, `Your properties` — read the surrounding page: this `sr-only` h1 labels the owner Home; use `Your properties`)
- Modify: `apps/portal/app/(admin)/admin/properties/page.tsx:53` — `Manage the hotels and venues your operator serves.` → `Manage the properties your operator serves.`
- Modify: `apps/portal/components/call/call-filters.tsx:52` — `<span className={LABEL}>Hotel</span>` → `Property`
- Modify: `apps/portal/components/call-tile/call-tile.tsx:326` — chip label `Hotel` → `Property`
- Modify: `apps/portal/components/call-tile/call-tile.tsx:343` — `Hotel local time` → `Property local time`
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx:266` — `<div …>Hotel local time</div>` → `Property local time`
- Modify: `apps/portal/app/(admin)/admin/properties/[id]/remote-access-card.tsx:92` — `hotel PC until new credentials are saved.` → `property PC until new credentials are saved.` (and `:109` "hotel PC" → "property PC" if Task 3 didn't already do that line)
- Modify: `apps/portal/app/layout.tsx:14` — `description: "After-hours front desk for hotels."` → `description: "After-hours front desk, staffed by real people."`
- Modify: `docs/v2-backlog.md` — append the SEO reminder (below)
- Test: `apps/portal/tests/components/call-filters.test.tsx` (extend/add) + `apps/portal/tests/components/call-tile.test.tsx` (extend — assert `Property local time`)

- [ ] **Step 1 — Confirm scope.** `grep -rn "Hotel\|hotel" apps/portal/app apps/portal/components | grep -iv "//\|/\*\|data-testid\|useHotel\|SingleHotel\|MultiHotel\|import\|welcomeHeading"` — every remaining hit should be one of the user-facing strings listed above (or a false positive you leave). If a NEW user-facing "hotel" string appears that isn't listed, add it to the edit set and note it.
- [ ] **Step 2 — Write the failing test.** In `call-tile.test.tsx` (or a new `call-filters.test.tsx`), assert the label reads `Property local time` / `Property` and not `Hotel`. Follow the file's existing render harness (call-tile tests already mock what they need):
  ```tsx
  expect(screen.getByText("Property local time")).toBeTruthy();
  expect(screen.queryByText("Hotel local time")).toBeNull();
  ```
- [ ] **Step 3 — Run it, verify it FAILS.**
- [ ] **Step 4 — Implement** every string swap above, and append to `docs/v2-backlog.md`:
  ```markdown
  ## Marketing-site SEO — industry positioning (added 2026-07-23)

  The portal `<meta description>` was made industry-neutral ("After-hours front desk,
  staffed by real people.") because the portal is auth-gated and does no real SEO. When a
  public marketing site exists, decide the real keyword/positioning trade-off there:
  "hotels" (accurate for the pilot, strong keyword) vs. industry-neutral (Lobby Connect will
  serve other industries). Owner: Kumar. Not a code change in the app.
  ```
- [ ] **Step 5 — Run it, verify it PASSES.** Also run `pnpm --filter @lc/portal exec vitest run --config vitest.jsdom.config.ts call-tile` (a test may assert the old "Hotel local time" — update it).
- [ ] **Step 6 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the changed files. Commit: `fix(copy): unify property terminology; neutral meta description`.

## Task 6: Factual — shift cap "12h" → "10h"

The app cap is `MAX_SHIFT_MS = 10h` (`packages/shared/src/protocol.ts:103`). Two admin strings say 12h. (The `SESSION_MAX_MS = 12h` at `protocol.ts:56` is a *different* Supabase-session cap — the comments referencing "12h" elsewhere are correct; only these two user-facing strings are wrong.)

**Files:**
- Modify: `apps/portal/app/(admin)/admin/shifts/shifts-table.tsx:136` and `:648`
- Test: `apps/portal/tests/components/shifts-table.test.tsx` (extend/add — read for the harness first)

Rewrites:
- `:136` `capped: { label: "Capped 12h", variant: "attention" },` → `label: "Capped 10h"`
- `:648` `…close on end-shift, a lapsed heartbeat, or the 12h cap.` → `…or the 10h cap.`

- [ ] **Step 1 — Write the failing test.** Assert the capped badge label is `Capped 10h` (render the row that yields `endedReason: "capped"`, or assert the label map directly if it's exported; read the file to pick the cheapest hook). If neither is unit-reachable, assert via a `getByText("Capped 10h")` on a rendered capped row using the file's existing fixtures.
- [ ] **Step 2 — Run it, verify it FAILS.**
- [ ] **Step 3 — Implement** both string swaps.
- [ ] **Step 4 — Run it, verify it PASSES.**
- [ ] **Step 5 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the file. Commit: `fix(shifts): correct the shift cap to 10h`.

## Task 7: Factual — sign-in "contact your administrator" note

Leave `/forgot-password` untouched (Locked decision 3). Add a muted helper line to the sign-in form so users know the real path to a reset.

**Files:**
- Modify: `apps/portal/app/(auth)/sign-in/page.tsx` (add one line beneath the form/submit — read the file for exact placement + the existing link styling to match)
- Test: `apps/portal/tests/` — the sign-in page's existing test if present, else add a focused render test

Copy: `Forgot your password? Contact your administrator.` (plain muted text; if it links anywhere it does not — there is no self-serve reset. Match the muted style of the existing auth helper text, e.g. `text-sm text-text-muted`.)

- [ ] **Step 1 — Read** `sign-in/page.tsx` to find the form structure and where the existing helper/links sit; mirror their class vocabulary. Confirm whether a sign-in test file exists.
- [ ] **Step 2 — Write the failing test.** Render the sign-in page (or its client form component) and assert the note is present:
  ```tsx
  expect(screen.getByText("Forgot your password? Contact your administrator.")).toBeTruthy();
  ```
  (If the page is a Server Component that can't render in jsdom without mocks, test the client form subcomponent that owns the markup, following how other auth tests render.)
- [ ] **Step 3 — Run it, verify it FAILS.**
- [ ] **Step 4 — Implement** the helper line in the sign-in form markup.
- [ ] **Step 5 — Run it, verify it PASSES.**
- [ ] **Step 6 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the file. Commit: `fix(auth): point sign-in users to their admin for password reset`.

## Task 8: Factual — users-table raw enum humanization

The Presence column prints the raw DB enum (`ON_CALL`, `AVAILABLE`, …); the guide bans exposing enums. Humanize via the existing `presenceLabel` mapper; humanize Role for consistency. (Pill + zebra are VISUAL consolidation → Batch 5; this task is copy-only.)

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx:561` (presence) and `:542` (role)
- Test: `apps/portal/tests/components/users-table.test.tsx` (extend/add — read for the harness first)

Implementation:
- Add `import { presenceLabel } from "@/lib/owner/format";` (mirrors how `property-overview.tsx` imports it).
- `:561` `{roleHasPresence(u.role) ? u.status : "—"}` → `{roleHasPresence(u.role) ? presenceLabel(u.status) : "—"}` (keep the `"—"` placeholder for roles without presence — that's the exempt glyph).
- `:542` `{u.role}` → a humanized role. Add a tiny local map next to the component (roles are a fixed 3-set) or reuse a title-caser:
  ```tsx
  const ROLE_LABELS: Record<Role, string> = { ADMIN: "Admin", AGENT: "Agent", OWNER: "Owner" };
  // …
  {ROLE_LABELS[u.role]}
  ```
  (Import the `Role` type from `@lc/shared` as the file already types `u.role`. If a `font-label` uppercase class wraps this cell, the source is still honest sentence-case — keep the map.)

- [ ] **Step 1 — Read** `users-table.tsx:74` (the `status` typing), `:542`, `:561`, and confirm the `Role`/`ProfileStatus` types + the `presenceLabel` import path.
- [ ] **Step 2 — Write the failing test.** Render the table (or the row) with a user whose `status: "ON_CALL"` and assert it shows `On call`, not `ON_CALL`:
  ```tsx
  expect(screen.getByText("On call")).toBeTruthy();
  expect(screen.queryByText("ON_CALL")).toBeNull();
  ```
- [ ] **Step 3 — Run it, verify it FAILS.**
- [ ] **Step 4 — Implement** the `presenceLabel` swap + the role map.
- [ ] **Step 5 — Run it, verify it PASSES.**
- [ ] **Step 6 — Gate + commit.** `find apps/portal/.next/types -name "* 2.ts" -delete` · `pnpm -F @lc/portal typecheck` · eslint the file. Commit: `fix(admin): humanize users-table presence and role enums`.

---

## Whole-branch gate (before the PR)

Run once from the repo root:
- `find apps/portal/.next/types -name "* 2.ts" -delete`
- `pnpm -F @lc/portal typecheck` · `pnpm -F @lc/kiosk typecheck`
- `pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts` + `pnpm -F @lc/portal exec vitest run` (lib) · `pnpm -F @lc/kiosk exec vitest run`
- `pnpm lint` (root) · `pnpm check:routes`
- `pnpm -F @lc/portal build` · `pnpm -F @lc/kiosk build`
- Final em-dash sweep (Task 3 Step 4 grep) confirms only comments + `"—"` placeholders remain.

Then opus whole-branch review, then branch → PR → `gh pr checks <n> --watch` → **Kumar merges** (auto-deploys prod) → **Kumar smokes**.

## Live-verify gate (Kumar, at the smoke)
1. **Softphone idle** (agent + admin, on/off duty): new caption + line pill + covering helper + the "Your line dropped." error line.
2. **Empty states:** a quiet agent/admin dashboard reads the calm status lines (not "will chart here"); owner empties read person-facing.
3. **Em dashes gone** from the surfaces you touch: 911 confirm dialog, connect errors, video-call warnings, toasts.
4. **Kiosk:** Ringing screen lays out cleanly with the recording note gone.
5. **Terminology:** in-call "Property local time"; call filters + call-tile chip say "Property."
6. **Factual:** shifts table shows "Capped 10h"; sign-in shows the contact-admin note; users table shows "On call"/"Available" (not `ON_CALL`).

## Self-review
- **Spec coverage:** manual-speak (Task 1 + 2), em-dash purge portal+kiosk (Tasks 3–4), terminology + meta (Task 5), the 4 factual fixes (Tasks 2/4 recording-note, 5 meta, 6 shifts, 7 forgot-pw-as-sign-in-note, 8 users-enums). All of plan line 149 + the 4 audit "Factual defects" are covered.
- **Centralization stance:** the guide's "centralize into `lib/copy.ts`" is satisfied by editing the already-central `empty`/`error` blocks; component-coupled ternary strings (softphone idle) stay inline to avoid awkward indirection in a regression-guard file (measured, not dogmatic).
- **Regression guards:** Task 1 = softphone caption strings only; Task 3 = 911 display strings only (explicit "revert any non-string hunk" instruction); no call-logic, notes-handler, or accept-gate lines touched.
- **No placeholders:** every task names exact files, line anchors, and the verbatim before→after string.
- **Type consistency:** `presenceLabel` (Task 8) is the same helper referenced in the constraints; `Role`/`ProfileStatus` from `@lc/shared`; no invented symbols.
