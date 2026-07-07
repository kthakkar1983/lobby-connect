# Handoff — Phase-E design refresh DONE (`b836dff`: D14 + Tasks 18/19a/19b/20 rewrite) → next = BUILD Phase E — START HERE

**Written:** 2026-07-07, end of the Phase-E design-refresh session (docs-only by Kumar's instruction: "stop after the specs are approved and a plan is written"). **Supersedes:** `2026-07-07-phase3d-done-phase-e-next-handoff.md` — its "NEXT: Phase E" is now half-executed (design refreshed + gated; BUILD remains); note that file rides the un-merged wrap branch `session-wrap-2026-07-07` (PR #33), so it is NOT on this branch — everything still relevant from it is restated here. **Branch state at close:** `main` = `ca2765a` (untouched) · **`phase-e-remote-access` = `main` + `b836dff` (the 4-doc amendment) + this handoff — BUILD HERE** · PR #33 (docs wrap) awaiting Kumar's click, no file overlap with this branch. ⚠ CLAUDE.md's current-focus on this branch is one session stale (its update rides PR #33) — **this handoff + `MEMORY.md` are authoritative.**

## What happened this session (2026-07-07)

1. **Re-validated the 2026-07-04-gated Phase-E design** (spec §3.5 D10–D12, plan Tasks 18–20) against the three things that moved since the gate: the as-built B–D trunk, the Agora strip, and the blue-green cutover model. Method: 2 exploration passes + 1 adversarial design review — the review caught one impossible-as-written wiring, one guaranteed double-audit bug, one contradiction with a Kumar-locked line, and several hardening gaps. Kumar approved the full amendment package (plan gate).
2. **4 docs amended, committed `b836dff`, pushed:** workspace spec (`docs/specs/2026-07-04-phase3-workspace-design.md` — new **D14**, §3.5 expanded to implementable mechanics, §6 staging re-aim, §8 risk 6) · target spec (2 dated strike-notes) · workspace plan (`docs/plans/2026-07-04-phase3-workspace.md` — Tasks rewritten, below) · migration plan (step 5 += pilot credential entry, step 8 += the audio-overlay Connect check).
3. Memory index + `stack-consolidation-direction.md` updated to point here.

## D14 + the build corrections (quick reference; full text in spec §2/§3.5)

- **D14 storage:** password plaintext-at-rest in the zero-policy table + explicit `revoke all … from anon, authenticated`; **envelope encryption → v2** (the envelope key would share the box with the service-role key AND the nightly BYPASSRLS `pg_dump`s — which WILL contain the password once 0020 reaches prod; residency named for the Task-21 posture addendum).
- **D14 audit — issuance-based:** every credential-API read audits `remote_access.credentials_issued` (`details.trigger: "prewarm"|"connect"`); pre-warm at Answer IS an issuance (one row per answered call on a configured property); **a cache-hit in-call Connect emits no extra row**; card-Connect always fetches → always audited (the fleet-support case stays fully trailed). Target-spec `remote_access.connected` + "every connect is audited" are strike-noted.
- **ConnectButton = `PodCardGrid`'s default `connectSlot`** — injecting a function from the agent RSC page is impossible (server→client boundary); the default means ZERO edits to the agent page, `fleet-board`, and `property-card`.
- **Pre-warm is provider-owned and keyed on `active?.callId`/`propertyId` PRIMITIVES + a fetched-for-call ref** — the softphone republishes `ActiveCallInfo` mid-call when `callTimeZone` arrives, so object-keying would double-fetch + double-audit every audio call. Cache in REFS (never context state — the render-loop trap); stale-response guard; cleared at call end; 404-only negative cache with explicit-click bypass; only pre-warm populates it.
- **Route hardening:** `Cache-Control: no-store` on 200 AND 404 (the only secret-returning route; deliberately the codebase's first audited GET); click-path `reliableFetch` retries capped at 1 (transient-activation window); label `remote_access.credentials`.
- **0020 additions:** the REVOKE + house `set_updated_at` trigger + `operator_id` FK index. New audit action `REMOTE_ACCESS_REMOVED`. Admin RSC page reads `peer_id, updated_at` ONLY (password write-only, "•••• saved"); admin CRUD uses `createAdminClient()` (user client sees silent empties).
- **Nullable-propertyId rule:** in-call Connect disabled when null; `UnmatchedRingCards` get no Connect (conscious omission).
- **New spec risk §8.6 — tile-Connect activation:** the tile's click is in the PiP document, the `rustdesk://` navigation targets the MAIN window; cross-document activation transfer is untested → named pass/fail smoke item; **fallback recorded: focus the main window first, then navigate** — a plan, not a redesign.

## NEXT SESSION: build Phase E (on this branch)

- **Order: Task 18 → 19a → 19b → Task 20 (HUMAN staging smoke) → Task 21 close-out.** Plan tasks are fully rewritten with code blocks: `docs/plans/2026-07-04-phase3-workspace.md`. Task 19 was split so **19a (route + `lib/remote-access/connect.ts` + provider pre-warm + ConnectButton) concentrates all the risk in one reviewable diff** — its review reads the `call-surface-provider.tsx` diff FIRST (that file carries both documented codebase traps); 19b is mechanical surface wiring (buttons only — D2/D12 discipline).
- **Build discipline (three sessions of evidence: the two-stage reviews caught something real in every task):** fresh subagent per task, spec review + quality review, whole-branch review before the PR. Per-task gates: `pnpm -F @lc/portal typecheck && test` (+ lint, check:routes, build at phase end). 724 tests green at branch base.
- **Migration 0020:** apply to LOCAL + **STAGING via MCP at Task 18** (the 0018 back-apply lesson) — **prod Supabase ONLY at Phase-5 step 5** (blue-green; the migration plan's step 5 now says so). `pnpm gen:types` needs `supabase start` + CLI 2.101.0; no `supabase-types.ts` overlay entry (no CHECK columns).
- **Task 20 smoke constraints:** staging kiosk + LiveKit work end-to-end; **staging has NO Twilio** (its softphone sits `phase:error` and tab-focus flaps it — remember when debugging staging-only weirdness) → the AUDIO-overlay Connect is jsdom-covered only, live-verified at the Phase-5 cutover (migration-plan step 8 names it). Smoke needs `staging` fast-forwarded to this branch (box auto-deploys). Kumar enters the pilot PC's credentials in the STAGING admin card for the smoke and **deletes the row after** (transient residency, D14). Tile-Connect is a named pass/fail with the recorded fallback.
- **Task 21 close-out adds:** the `docs/security-posture.md` addendum (credential class + full residency incl. nightly dumps), `/duty-tile-prototype` retirement, done-when checklist (audio-Connect line asterisked to the cutover), docs-sync + tag `plan-phase3-workspace-complete` on Kumar's nod.

## State of every moving part

- **Prod pilot:** frozen Vercel standby (Agora), serving normally, untouched. **`main`:** LiveKit-only trunk (`ca2765a`); merges deploy nothing until Phase-5 step 5.
- **Staging (box):** serves `f72569c` (= pre-refresh main); fast-forward `staging` to this branch when the build is ready to smoke.
- **Phase-1 soak:** checkpoint ~2026-07-10 → stamp + tag `plan-phase1-box-staging-complete`. **Phase 2:** waits on Dilnoza's clean real night → stamp + tag `plan-phase2-relay-complete`.
- **Phase-5 remaining:** steps 4–10; step 4 = this build; steps 5/8 now carry the pilot-credential entry + the audio-Connect check (2026-07-07 edits).
- **Carry-forwards (unchanged):** GitHub secret-scanning alert · pilot phone line not transferred · dashboard right-column + softphone-tile layout rework + Reopen-button reposition/color = post-migration polish · v2-backlog: mid-call resume + ChunkLoadError reload-guard + kiosk empty-target immediate apology + per-connect rotation + self-enrollment · post-cutover cleanups (Coolify `VIDEO_PROVIDER` env, Traefik `/api/agora/*` label, LiveKit test-mock dedup, stale test header comment) · audio↔video ⏎-parity · pre-cutover video-quality tuning spike.

## Gotchas / discipline (carried + new)

1. **Standby invariants:** frozen deploys · ADDITIVE-ONLY migrations · `agora_channel_name` unrenamed · Vercel `AGORA_*` + Agora account stay until decommission.
2. **DEP-HYGIENE:** the pre-warm effect uses primitive deps + refs; `connectToProperty` is `[]`-stable; never churn the provider's memoized context value.
3. **DocPiP debugging: DevTools interferes with the pip window** — use the on-page strip method for anything tile-adjacent; tile-Connect activation is the untested edge (§8.6).
4. **Two publishers, one slot:** channel-scoped `publishActive` stands — any new writer keeps ownership enforced at the shared resource.
5. Claude merges PRs on Kumar's explicit go; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; no emojis.
6. Session-limit mid-subagent: verify the on-disk work directly against the task spec, finish inline if surgical, then run the normal two-stage review (worked for 15d).

## Register reminder

Real dialogue, plain English; decide when one answer is sane (this session's five flagged decisions got a gate, not a menu), converse on genuine forks. Evidence before fixes — the adversarial review re-verified every claim in code before it changed a doc. Mark source-backed vs gap-filled. The standby is the safety net; protect its invariants.
