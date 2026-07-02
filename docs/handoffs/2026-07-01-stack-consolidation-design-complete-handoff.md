# Handoff — Stack consolidation DESIGNED + LOCKED (start here)

**Date:** 2026-07-01 (second session that day) · **Branch:** `main` · **Supersedes:** `2026-07-01-stack-consolidation-strategy-handoff.md`

## What happened this session

Kumar's RustDesk-into-dashboard idea was pulled out (a Connect button in the call window: call shrinks to a small floating window Google-Meet-style, playbook becomes a sidebar, the hotel PC fills the screen — plus, from his Q&A: **per-property dashboard cards that also carry ringing/Answer**, one remote session at a time, a one-click **hold**, and the reveal that an **AHK + Zebra DS9308 license-scanner script already lives on hotel PCs**). Thirteen scoping questions answered; two source-backed research passes run (VPS/self-host cost model; RustDesk feasibility). Then a **pre-commit review round** — Kumar challenged tile utility, the admin dashboard, LiveKit-vs-Jitsi, and "solve notifications once and for all (agents watch YouTube between calls)" — which produced the deskphone-tile reframe, the layered alerting stack, the admin-workspace section, and the Phase-3 prototype gate. All forks resolved; design docs written + amended.

## The two docs of record (read in this order)

1. **Spec:** `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` — target architecture, component dispositions, the RustDesk integration design (deep link + floating PiP call window + credential brokering), agent-workspace direction (property cards), cost model (all cited), tradeoffs, non-goals, decision records for rejected alternatives.
2. **Migration:** `docs/plans/2026-07-01-stack-consolidation-migration.md` — Phases 0–5 (+optional 6), rollback per phase, sequencing rationale. Each phase gets its own brainstorm→spec→plan at build time.

## Headline decisions (details + citations in the spec)

- **DigitalOcean 4c/8GB single box** (~$84/mo all-in fixed incl. backups + Supabase Pro). Hetzner US is out (3× June-2026 price hike). Split-ready containers for a later media box.
- **RustDesk web-client embed REJECTED** (closed-source preview, no auto-connect API, $47.88/mo self-host gate, unverifiable in-browser E2EE). **Native client + verified `rustdesk://connection/new/<id>?password=<pw>` deep link** instead; hotel PCs mass-provisioned via documented CLI flags; LC brokers/audits credentials; OSS relay has **no session limits** (the "1 concurrent connection" belief was a paid-plan artifact).
- **Persistent "deskphone" tile** (Document PiP, opened all shift via a "Go on duty" click that also primes audio; Chromium → agents standardize Chrome/Edge) = the lifeline, not the workspace (playbook/notes stay in the portal tab). **Layered alerting solved product-wide:** tile rings above everything incl. fullscreen YouTube (layer 1) + **Web Push OS notifications BUILT in Phase 3** (layer 2 — un-demoted; folds in the 2026-06-30 alerting handoff) + Twilio's background-proof audio ring (layer 3). Two verify-at-build items live inside the gate below.
- **Admin workspace locked:** same shared card component; **pod-grouped fleet view** under the existing command-center strip; ring/Answer gated by `covering` (unchanged routing); **Connect available on ANY property regardless of covering** (fleet support). RLS already permits — no policy changes.
- **Phase 3 opens with Gate 3.0:** a 1–2 day deskphone-tile prototype (ring over fullscreen YouTube + over RustDesk, on real agent machines), judged live by Kumar + the pilot agent; fail → thin desktop-shell escalation decided *before* Phase-3 proper. LiveKit-vs-Jitsi rationale expanded in the spec (product-vs-infrastructure; **Jitsi = named plan B**).
- **LiveKit** replaces Agora; **Coolify** replaces Vercel; **custom domain is a new hard requirement** (Twilio/auth/kiosk URLs).
- **Supabase stays managed + upgrades to Pro**; formal self-host decision deliberately last (Phase 5).
- Twilio concurrency: raised but per-leg cost → staying at current capacity until needed (CLAUDE.md corrected).

## Next actions (in order)

1. **Phase 0:** merge `fix/max-call-duration-cap` (caps Agora exposure during the transition), tag `pre-consolidation-baseline`.
2. **Phase 1:** buy domain, provision the DO box, Coolify, staging portal/kiosk on it, ops runbook.
3. Then Phases 2–5 per the migration plan (relay → workspace feature → LiveKit → cutover).

## Carry-forward hygiene (unchanged)

Temp guest-audio diagnostics still on `main` (remove once first-call-audio cause is pinned — list in `2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · first-call-audio root cause still not airtight-confirmed.

## Register reminder

Real dialogue, plain English, no pick-one menus (`feedback-brainstorm-dialogue`). Build for the future, not just the pilot (`feedback-forward-compat`). Sourcing discipline on every number.
