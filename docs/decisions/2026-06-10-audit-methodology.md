# Architecture Audit Methodology — 2026-06-10

**How findings were classified, and why each bucket exists.**

---

## Classification buckets

### BUG: Fix before v1 ships

A finding is a **BUG** when it represents a **defect in current behavior** or a **regression in codebase discipline** that will cause problems within the v1 pilot timeline.

**Include if:**
- **Correctness failure:** silent data loss, wrong results, stale state, race conditions, security leaks. (H1, H3, S3, S8)
- **Broken process:** audit trail incomplete, type safety lost, drift unguarded, seams drift because they're hand-synced. (M2, M3, M4, M5, M6, D1–D10)
- **Guest-facing impact:** primary trust signal (H2), privacy incident (H3), dead-air latency (P4).
- **Dead code/impossible state:** thing that crashes on first documented use (A7), or pattern the codebase already solved elsewhere but didn't apply (H1, M1).
- **Already drifted:** copy-paste seam where divergence has already been found in code review (A1, D1, D4).

**Exclude if:**
- It's a known v2 scoped problem (see DEFER-V2).
- It's a documented tradeoff at pilot scale (see ACCEPT-RISK).
- It re-litigates a locked decision explicitly documented in CLAUDE.md (none found; would be INTENTIONAL).

### DEFER-V2: Real problem, scoped for v2

A finding is **DEFER-V2** when it represents a **real architectural risk that breaks at 10× growth** but doesn't hurt the v1 pilot (1–2 properties, 2–5 staff, pilot scale).

**Include if:**
- **Scale cliff:** unbounded query, cost fan-out, or N+1 pattern that works fine for pilot but fails at 50 properties, 20 staff, 10k calls. (S4, S6, S7, P3, S11)
- **Known v2 re-architecting:** e.g., the reaper daily-window-N+1 is acceptable because the v2 plan is to rebuild presence on subscriptions anyway. (S7 — partially)
- **Rework threshold:** the fix requires more than a module extraction; would be reshaping decisions that were intentional at v1. (P3 — the 3s poll itself is locked; only the query shape is improvable)

**Exclude if:**
- The fix is a one-liner or a small module extraction (it's a BUG, not a defer).
- Pilot traffic will expose it (it's a BUG, not a defer).

### ACCEPT-RISK: Documented tradeoff for v1

A finding is **ACCEPT-RISK** when it represents **known perf/UX friction that is acceptable at pilot scale** and will be polished later (v1.1 or v2).

**Include if:**
- **Perf burden under rare conditions:** e.g., monitoring page rate-limits its own Sentry under high concurrent admin usage (P2). Fix is trivial (add cache), but also rare (pilot has 1–2 admins). Acceptable.
- **UX cliff at larger scale:** e.g., "Load more" grows limit forever but pilot calls are hundreds (P7). Owner will hit 500-call limit in a month of real usage, not pilot week.
- **Cost without correctness impact:** e.g., 20s poll amplifies cost (P3 partially), but it's a cost-structure choice deferred to v2 anyway (no subscriptions).

**Include if further conditions hold:**
- The fix is known and trivial (cache, batch, add index).
- Pilot timeline and scale make the problem invisible.
- Risk is explicitly documented so team doesn't re-discover it in support tickets.

**Exclude if:**
- It's a silent defect or wrong result (it's a BUG).
- It affects the guest/primary user experience (it's a BUG).
- The risk is invisible and will bite unexpectedly (it's a BUG — document the risk so someone doesn't accidentally hit it).

### INTENTIONAL: Locked decision, not a finding

A finding would be **INTENTIONAL** (i.e., not a finding at all) if it merely re-litigates a locked decision documented in CLAUDE.md, docs/specs/, or the readiness-audit triage.

**None were found** in this audit. (The daily cron window, the 20s polling, the no-subscriptions design, single-tenant-first scoping — all are documented locked decisions but the findings don't re-litigate them; the findings identify friction *within* those decisions.)

---

## Application to this audit's findings

### Why H1/H2/H3 are BUG (not ACCEPT-RISK)

- **H1 (notes loss):** Silent data loss in money path. Stale-closure pattern is a footgun the kiosk's reducer pattern explicitly solves. No excuse for it to exist in two places. Must fix.
- **H2 (owner presence):** Primary trust signal to paying customer. "Your staff is covering you" is the value prop. Wrong for 24h is not acceptable. Pilot revenue depends on this. Must fix.
- **H3 (video race):** Guest-facing privacy incident. Two agents publishing into one guest's call is not a tradeoff; it's a defect. Multi-agent ring is the design; concurrent answers are inevitable at any scale >1 admin. Must fix.

### Why P2/P7/P9 are ACCEPT-RISK (not BUG)

- **P2 (Sentry API on every tick):** 4,320 calls/day/tab sounds like a lot, but pilot has 1–2 admins, they don't leave the status page open forever, and Sentry has plenty of free quota. The real DDoS scenario is large-scale ops dashboards (v2). Fix (cache) is one line. Acceptable. But *documented* so team can add it if telemetry shows concern.
- **P7 (Load more grows + auto-refresh):** Pilot calls are hundreds. At 500-row growth owner will notice the cliff; they can either stop clicking or request pagination. UX friction, not data loss. v1.1 upgrade is keyset pagination. Acceptable risk documented.
- **P9 (presence heartbeat 3 RTT):** Steady-state, not critical path. Load is negligible at pilot scale. Fix is one stored proc. Nice-to-have; doesn't block anything. Deferred.

### Why S4/S6/S7 are DEFER-V2 (not ACCEPT-RISK)

- **S4 (1000-row cap):** "Calls today" stat silently wrong at ~25+ properties. Pilot is 1–2 properties. At 10×+ growth the silent wrongness is unacceptable. But it's a scale problem, not a pilot problem. Fix is identical to P6 (count queries). Scoped as DEFER-V2.
- **S6 (poll amplification):** 1.7M RTT/day at 20 sessions is a cost cliff. But pilot has 1–2 staff, 1–2 properties. Growth trajectory is v2. Fix (reduce per-poll cost) is happening anyway in Phase 3. Scoped as DEFER-V2 because it's a *scale* problem.
- **S7 (reaper N+1):** Daily window hides the cost. At 10,000+ accumulated stale rows the nightly reaper takes 5+ minutes. But pilot will have <2,000 rows. And the v2 plan is subscriptions anyway (completely different presence model). Scoped as DEFER-V2.

### Why A6/D11 are low priority within BUG

These are *correct* classifications as BUG (they're real duplication), but their payoff is low:
- **A6 (PII scrub duplication):** Merged with D2. Both apps import `@lc/shared`, so move is one batch. Included in Phase 2.
- **D11 (CSS + guard boilerplate):** CSS belongs in both apps by design (separate deployments); guard duplication is 5 copies of a 3-line pattern. Low payoff. Deferred to Phase 4 or post-v1 polish.

---

## Risk framework used

For each finding, three risk dimensions were weighed:

| Dimension | BUG threshold | DEFER-V2 threshold | ACCEPT-RISK threshold |
|---|---|---|---|
| **Correctness** | Any data loss, silent wrong result, race condition | Breaks at 10× growth, not at 1× | Perf only, no result change |
| **Guest impact** | Direct (privacy, dead-air, trust signal) | Indirect (scale limit) | None; ops/internal only |
| **Pilot timeline** | Hits within weeks | Hits at months or never | Acceptable burden, fixable |
| **Seam stability** | Already drifted, hard to extend | Can drift post-v1, needs v2 redesign | Known tradeoff, documented |

---

## Phase sequencing

**Phase 0** (docs): Merge readiness-audit branch. Unblocks future audit workflows.

**Phase 1** (behavior fixes): H1/H2/H3. Three high-severity bugs. Ship before pilot launches.

**Phase 2** (seams): A1/D1–D7. Extract the security/tenancy/duplication boundaries. Pre-builds v2 multi-tenancy seam.

**Phase 3** (scaling): P1/P4/P5/P8. Guest-audible latency. Halves 20s-poll cost.

**Phase 4** (hardening): Remaining BUGs (M2/M3/M6/M7, A7/A8). Then tackle DEFER-V2 items.

---

## What *wasn't* classified as a finding

### Locked decisions (intentional, not regressions)

- **Daily cron window (Vercel Hobby limit):** Documented in CLAUDE.md. The presence staleness inference (H2 root cause) is a smell *within* that decision, but the decision itself is not wrong. Classified as BUG (H2) because the consequence needs fixing.
- **20s polling (no subscriptions):** Documented locked decision. Cost (P3/S6) is a consequence; scoped as DEFER-V2 because it scales, not because the decision is wrong.
- **Single-tenant v1 (v2 filter seam):** Documented. A1 and D1 identify drift *within* that seam; the seam itself is correct.

### Already-accepted items (readiness-audit triage)

- **Twilio Device/Call typed `any`:** Direct re-report of triage item 32, classified ACCEPT-RISK. Dropped from this audit.

### Dormant seams (locked decision 7 — forward-compat)

- Email invite/reset paths, voicemail callback, PagerDuty, dark mode, etc. are intentionally dormant with hooks. Finding M4 (password-reset seam points at the wrong handler) is **not** a dormant-seam issue; it's a defect *within* the seam. Classified as BUG.

---

## Severity vs. bucket

Note the difference:

- **Severity** (HIGH/MED/LOW) = impact level if the issue remains.
- **Bucket** (BUG/DEFER/ACCEPT/INTENTIONAL) = when to fix it.

Example: S2 (parallel-dial cap) is **MED severity** (call breaks) but **ACCEPT-RISK bucket** (pilot scale has <11 admins, so the cliff is unreachable). It's a real problem that doesn't hurt v1 pilot timeline.

Example: P2 (Sentry API) is **MED severity** (monitoring unavailable) but **ACCEPT-RISK bucket** (rare high-admin scenario, fix is trivial cache).

Example: S4 (1000-row cap) is **MED severity** (stats silently wrong) but **DEFER-V2 bucket** (breaks at 25+ properties, not 1–2).

---

## References

- `CLAUDE.md` — Locked decisions, conventions.
- `docs/specs/2026-05-27-v1-architecture-design.md` — V1 spec (scope, stack, decisions).
- `docs/audits/2026-06-06-readiness-audit-triage.md` — Prior audit triage (branch `docs/readiness-audit-2026-06-06`).
- `docs/audits/2026-06-10-architecture-audit.md` — Full findings.
- `docs/audits/2026-06-10-architecture-audit-triage.md` — Triage table (all 48 findings).
