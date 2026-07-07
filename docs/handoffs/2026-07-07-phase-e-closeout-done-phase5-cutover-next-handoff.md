# Handoff — Phase E close-out DONE (Task 21) → next = Phase-5 cutover (with a new pre-go-live security BLOCKER) — START HERE

**Written:** 2026-07-07, end of the Phase-E close-out session. **Supersedes:** `2026-07-07-phase-e-built-smoked-merged-handoff.md` (its "REMAINING = Task 21 close-out" is now DONE). **`main` = `d73c134`.** The whole **phase3-workspace plan (Tasks 1–21, Phases A–E + close-out) is COMPLETE** — tag `plan-phase3-workspace-complete` is cut on `d73c134`.

## What happened this session (2026-07-07 close-out)

Executed the Task-21 close-out from the prior handoff. All docs + cleanup; no feature-logic changes (Phase E itself shipped in PR #34 the session before).

- **Reconciled PR #33** (docs-only Phase-3D wrap) → merged to `main` first, so the Phase-3D handoff doc is preserved and the CLAUDE.md current-focus had a clean base to layer Phase E onto (no merge conflict). Blue-green: deployed nothing.
- **Retired `/duty-tile-prototype`** (the Gate-3.0/3.1 spike surface — dead now that the production call tile shipped in Phase 3D). Removed the closed island: the route, `duty-tile-prototype.tsx`, `tile-window.tsx`, `lib/duty-tile/tick-stats.ts`, and its test (765 lines). Dependency-traced first — `tick-stats` was imported **only** by the prototype. **Production tile untouched:** `components/call-tile/`, `lib/duty-tile/{call-tile-manager,pip-document}.ts`, `document-pip.d.ts`. Suite green after: **643 node + 135 jsdom (portal), 35 kiosk, 25 shared** (−9 node = the removed `tick-stats.test.ts`); typecheck + lint + check:routes pass. (Had to `rm -rf apps/portal/.next` once — stale generated route types for the deleted route failed `tsc`; a clean cache regenerated fine.)
- **`docs/security-posture.md` §6.5 D14 addendum** — the RustDesk credential class: service-role-only zero-policy table + REVOKE, plaintext at rest, the single audited `no-store` read path, issuance-based audit + no-double-audit, the **best-effort-audit residual risk**, and full residency (prod DB + nightly `pg_dump` via `lc_backup` BYPASSRLS + PM + transient staging). Also corrected the one-paragraph summary (now **two** long-lived credential classes), added a §8 accepted-for-pilot note, a §9 sourcing line, and the maintenance footer. Every claim source-backed against migration 0020, the route, `audit.ts`, and the box runbook.
- **CLAUDE.md + repo `MEMORY.md`** current-focus → Phase E built + smoked + merged; the new deep-link gotcha recorded.
- All bundled in **PR #35** → CI green (`verify` 2m58s) → merged (`d73c134`). **Tag `plan-phase3-workspace-complete`** cut + pushed on `d73c134`.
- **Left `memory/project-status.md` frozen** — it's explicitly STALE-marked (after plan 6a) and points to CLAUDE.md as canonical; resurrecting it would be wrong.

## ⚠ NEW — pre-go-live security BLOCKER (Kumar 2026-07-07)

Kumar's call on the RustDesk-credential posture: **fix + test it before going live — NOT v2.** The §6.5 addendum currently frames the weakness as "accepted for pilot / v2 candidate"; that framing is superseded for the *fix*, but Kumar chose to **leave the §6.5 doc wording unchanged** (it's an accurate record of the *current* state) and **track the fix separately** — the doc gets reconciled to the hardened state when the fix lands.

- **The two weaknesses to fix (both in `property_remote_access` / the credential path):**
  1. **Plaintext password at rest** — `unattended_password` is stored as plain `text` (only Supabase disk encryption). It also lands in **every nightly `pg_dump`** (the `lc_backup` role is `BYPASSRLS`). → Add **app-layer encryption**: envelope key held server-side, decrypt only inside `GET /api/remote-access/[propertyId]` to build the `rustdesk://` URL, so a DB / dump leak is ciphertext.
  2. **Best-effort issuance audit** — `logAuditEvent` (`lib/auth/audit.ts`) doesn't check the `audit_logs` insert result, so a credential can be *issued* without its audit row landing. → Make it **fail-closed** on the secret-read path (fail the issuance if the audit write fails, or a durable outbox).
- **Where it's tracked:** migration plan **Phase 5, step 5** — a "Pre-cutover RustDesk-credential hardening — BLOCKER" sub-bullet (parallel to the existing video-quality spike), positioned *before* the pilot's real creds enter prod and *before* GO LIVE. **Test on staging before the cutover window.**
- **Not yet designed/built** — pick it up as its own small spec→build (envelope-encryption scheme + audit-fail-closed) inside the Phase-5 cutover prep. Code-light but security-critical.

## State of every moving part

- **`main` = `d73c134`** (Phase E + Task-21 close-out). Blue-green: **merging to `main` deploys nothing** (Vercel disconnected; prod = the frozen Vercel standby on Agora until the Phase-5 cutover). No open PRs.
- **Prod pilot:** frozen Vercel standby (`main@f4af480`, still Agora), serving normally, untouched. **Prod migration 0020 + real pilot credential entry happen at Phase-5 step 5** (after the hardening above).
- **Staging (box):** `staging` branch serves the Phase-E build incl. the launch fix. `property_remote_access` exists on staging DB (empty — smoke row deleted).
- **Phase-1 soak:** checkpoint ~2026-07-10 → then stamp DONE + tag `plan-phase1-box-staging-complete`.
- **Phase 2 (RustDesk relay):** built + verified; waits ONLY on Dilnoza's clean real night through our relay → stamp DONE + tag `plan-phase2-relay-complete`.
- **Staging deploy gotcha (carried):** Coolify build failed once at "Collecting build traces" (Next standalone tracing, memory-heavy) exit 255 — a **transient**; manual Redeploy cleared it. Box has only 2 GB swap; bump 2→4 GB if it recurs (disk 125 GB free). SSH: `ssh -i ~/.ssh/lc_box root@159.203.124.112`.

## What's left (the remaining migration)

**Phase-5 cutover (migration plan steps 5–10)**, gated on the Phase-1 soak (~07-10) + Dilnoza's Phase-2 real night. Sequence, with the new blocker folded in:
1. **Pre-cutover RustDesk-credential hardening** (the BLOCKER above) — spec→build→staging-test.
2. Pre-cutover video-quality tuning spike (already in step 5 — LiveKit capture presets + bitrate).
3. Stand up box prod apps (`lc-portal-prod`/`lc-kiosk-prod`), apply 0019/0020 to prod, enter pilot creds (now encrypted), box crons take over.
4. Custom domains → Vercel first (repoint tablet once), cutover runsheet + rollback rehearsal, **GO LIVE** (pointers → box; Dilnoza night-1 India test calls; Kumar smokes voice+video+Connect incl. the **AUDIO in-call overlay Connect** — the one Phase-E surface never live-verified, no Twilio on staging).
5. ~2-week standby window → decommission (Vercel + Agora closed, Supabase Pro, token revocations, tags `plan-phase4-livekit-complete` + `plan-phase5-cutover-complete`).

**Deferred to v2 (Kumar 2026-07-07):** the end-of-call **"continue remote session / disconnect?"** prompt — easy UI, but LC **cannot programmatically close RustDesk** (separate native app, no control API), so "Disconnect" can only *remind* the agent. Filed for v2.

## Gotchas / discipline (carried + new)

1. **Standby invariants:** frozen Vercel deploys · ADDITIVE-ONLY migrations · `agora_channel_name` unrenamed · Vercel `AGORA_*` + Agora account stay until decommission. 0020 is a clean additive table — blue-green safe.
2. **Deep-link launches must NOT navigate the top window** while a WebRTC call is live — use the hidden iframe (`launchRustdesk`). (This session's predecessor bug.)
3. **DEP-HYGIENE:** the pre-warm effect uses primitive deps + refs (never context state); `connectToProperty` is `[]`-stable; never churn the provider's memoized value.
4. **Staging is a throwaway deploy-pointer branch** — content == main; update via a non-ff merge of the feature branch (a force-push is correctly blocked by the auto-mode classifier).
5. Claude merges PRs on Kumar's explicit go; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; no emojis. `main` is push-protected — merge via `gh pr merge`.
6. Live smoke of voice/video/RustDesk only works on deployed envs.
7. **The §6.5 security-posture wording is deliberately left describing the *current* weak state** — do NOT "correct" it to say the risk is fixed until the hardening actually lands; reconcile it then.

## Register reminder

Real dialogue, plain English; decide when one answer is sane, converse on genuine forks. **Evidence before fixes.** Mark source-backed vs gap-filled. The standby is the safety net; protect its invariants. The RustDesk-credential hardening is now a **pre-go-live blocker**, not a v2 nicety.
