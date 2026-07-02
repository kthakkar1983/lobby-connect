> **SUPERSEDED (later on 2026-07-01):** the direction below was designed + locked the same day. START HERE instead: `docs/handoffs/2026-07-01-stack-consolidation-design-complete-handoff.md` (+ the spec/migration plan it points to). This file stays as the strategy-session record.

# Handoff — Stack consolidation strategy (self-host most of it, keep Twilio) + business-model correction

**Date:** 2026-07-01 · **Branch:** `main` · **Status:** mid-brainstorm on a **major stack-consolidation / self-hosting direction.** Agreed at a high level; **NOT designed, NOT locked.** Kumar has a specific idea — especially **how to fold RustDesk into the agent dashboard** — that he has **not yet described.** The fresh chat must **pull that idea out FIRST**, before any design work.

This is the single "start here" doc for the next chat.

---

## 0. Register / how Kumar wants to work (read first)
- **Real dialogue, plain English, NO "pick one option" `AskUserQuestion` menus.** Talk it through, back and forth. (Memory: `feedback-brainstorm-dialogue`.) I lost a lot of goodwill early this session by (a) going too technical and (b) using pick-one forms — don't.
- **Build for the future — planned AND unplanned — not just the pilot.** (`feedback-forward-compat`.)
- When explaining, explain in plain terms first; go technical only when asked.

---

## 1. THE BUSINESS MODEL (was undocumented until this session — now committed)
This was **never written down** and I didn't know it, which nearly derailed the session. Now captured in `CLAUDE.md` ("What this is"), `docs/PRODUCT.md` ("Operating model — how it actually works"), and memory `business-model-remote-desktop` (marked read-first). The essentials:

- Lobby Connect sells **virtual night-shift front-desk EMPLOYEES** to hotels that can't staff nights. The kiosk video + phone routing is only the **guest-facing half**. The other half: agents **remote into the hotel's own PC (RustDesk)** and do the real work — **check-ins, creating/modifying reservations, night audit.**
- **Remote-desktop is a deliberate PCI firewall.** All card/PII/PMS work stays on the hotel PC → Lobby Connect **never touches cardholder data → stays out of PCI-DSS scope.** **DO NOT** design toward pulling payments/PMS into Lobby Connect — that breaks the whole model.
- **Pod model:** one agent **owns** a **dedicated pod of ~5 properties** — the **same faces week to week** (employees, not an anonymous call center). Maps onto the persistent per-property primary-agent assignment.
- **Overflow is human-coordinated, NOT automated:** a small, consistent **admin** bench floats as backup and flips a `covering` toggle **on/off by hand**, reactively (pod busy / agent on break / emergency). **No fixed admin↔pod assignment. NO auto-widening.** Internal SOPs + live agent/admin comms handle the away/emergency case. At launch, **Twilio concurrency is raised** so the already-built parallel dial (primary agent + covering admins) can place multiple legs. All-busy → apology (no queue/hold/voicemail in v1) — accepted rare tail.
- **Agent runtime is permanent:** remote session (foreground) + portal (background) → **OS-level alerting is structurally mandatory.**

---

## 2. THE STRATEGIC PIVOT (this session's core)
The realization: **the current stack was optimized for "solo dev ships a FREE pilot FAST" — which conflicts with "SIMPLE + CHEAP AT SCALE."** Kumar's three challenges, all fair:

1. **Why Vercel and not a cheap server?** Vercel was chosen for build speed + free tier. But its spin-up-on-demand model is a **poor fit** for real-time telephony (causes the cold-start first-call ring delay, the daily-cron cap, auto-pause) and it **gets expensive at scale.**
2. **Why 9-10 vendors when 3-4 could do it?** Sprawl from picking the easiest managed option for each piece separately. Only **phone + video** are true "can't-build-it-yourself" specialists; the rest is self-inflicted.
3. **Why "free/cheap pilot" if it costs an arm and a leg at scale?** Right for *validating* an unproven model; a **trap** if carried into scale — free tiers are engineered to get expensive exactly when you grow, and you'd be migrating under fire.

**Agora specifically — trust is gone.** A **7 min 39 sec** test call showed as **71 minutes** on the Agora console. Likely cause: Agora bills **"aggregate"** (every participant × audio/SD-video/HD-video counted as separate *summed* buckets), AND leaked/abandoned test channels keep billing until token expiry (~1h) — the exact thing the unmerged **max-call-duration cap** guards against. Opaque + unpredictable, for a cost Kumar won't personally be watching. **Kumar wants Agora GONE.**

---

## 3. THE EMERGING DIRECTION (agreed high-level; NOT designed/locked)
Consolidate onto infrastructure **Kumar owns** (one or two VPS/servers). Rent only true specialists.

**KEEP (rented):**
- **Twilio (phone)** — Kumar is happy with it; **keep it.** Phone is the one genuinely rent-forever piece (you always need a carrier/number provider). *(A cheap SIP trunk + self-hosted PBX is a cheaper-at-scale alternative, but NOT wanted — Twilio stays.)*

**MOVE to owned server(s) — per-piece verdicts:**
- **App (off Vercel):** a **re-host, not a rewrite** — Next.js runs on any plain server. Keep the push-to-deploy convenience with a self-hosted platform (**Coolify / Dokku** = "your own private Vercel"). Kills cold-start, cron caps, auto-pause; flat cost.
- **Video (off Agora):** self-host open video software — **LiveKit** (modern pick) or Jitsi/mediasoup. 1:1 guest↔agent is very feasible. Flat, transparent, controllable. Real work to swap in, but **bounded to the video layer.** Only unavoidable cost = TURN relay bandwidth (on your own box).
- **RustDesk:** already the plan — self-host the relay on the VPS. **PLUS** integrate into the agent dashboard (Kumar's pending idea — §5).
- **Error tracking / analytics:** minor. Keep free tiers or light self-host (GlitchTip / Plausible / Umami). Not the arm-and-leg problem; do later.

**THE ONE HARD CALL — the database (UNRESOLVED, decide with Kumar):** Supabase is open-source + self-hostable (data + logins + storage move with barely any code change). BUT it holds the **one irreplaceable asset — the data** — and self-hosting puts backups/recovery on Kumar at 3am. **Honest steer:** self-host the easy stuff, but seriously consider keeping the **database** on a cheap **managed** service (or at minimum bulletproof automated backups). A DB mistake is *permanent*, not just inconvenient. This is the piece where "rent for peace of mind" has the strongest case.

**Captions (Speechmatics) — low priority:** usage-based but **bounded + predictable** (only during a call, only the guest's voice), unlike Agora. Keep a cheap STT API for now (or self-host Whisper later if a GPU box exists). Swap-seam already exists (`apps/portal/lib/captions/provider.ts`). Don't let it block the bigger moves.

**Net target shape:** ~9-10 rented meters → **one or two owned servers + Twilio + (maybe) a managed database + a small captions service.** Predictable, controllable.

**Honest tradeoff (say it every time):** self-hosting = Kumar becomes the sysadmin (patching, uptime, backups). Push-to-deploy tools soften it, but it's real work taken back from vendors — money-vs-time-vs-risk, not a free win. Kumar accepts this for the control + predictable cost.

---

## 4. KEY INSIGHTS TO PRESERVE (don't re-derive these)
1. **The integration problem and the background-alerting problem are the SAME problem.** RustDesk is the agent's foreground *only because it's a separate app* — that's the root of "no ring when the portal is backgrounded." **Fold the remote session INTO the LC surface → LC becomes the foreground → an in-app ring is visible again → Web Push demotes from *primary fix* to *backstop*.** So folding RustDesk in may be most of the alerting fix. **This likely REFRAMES the prior "Web Push + service worker" direction** (`docs/handoffs/2026-06-30-background-call-alerting-handoff.md`). **Do NOT start building the Web Push spec until the stack decision lands.**
2. **PCI firewall rule for ANY remote-desktop integration:** LC may **serve the client + broker access**, but must **NEVER carry or decrypt the remote-desktop PIXEL STREAM** (the hotel screen shows cardholder data during check-in). RustDesk's **end-to-end-encrypted, self-hosted-relay** model keeps LC out of scope (the relay forwards only ciphertext — like a network carrier). A server-side pixel gateway (**Guacamole**-style) would decrypt + re-render on LC servers → **pulls you into PCI scope → REJECTED.** *(This is my read, not a QSA's — confirm with someone who signs PCI attestations before relying on it.)*
3. **Routing + alerting reduce to ONE resolver:** `eligibleAnswerers(propertyId, now)` = reachable primary agent + admins currently covering. Twilio dials that set; the OS-notification pipe rings that same set. Build it once, two outputs.
4. **LC becomes the broker of remote-access:** each property's hotel PC gets a stable device ID + unattended credential that LC issues / stores / rotates / revokes / audits (agents never handle passwords). PCI-safe (credentials, not card data). Folds into the same access-control theme as the kiosk pairing token.

---

## 5. WHAT'S UNRESOLVED / DO NEXT (in order)
1. **PULL OUT KUMAR'S IDEA FIRST** — especially **how he wants to fold RustDesk into the agent dashboard.** He's gestured at it 3× and not described it. It likely shapes the entire server layout. Get it before designing anything.
2. **Decide the database question** — self-host Supabase vs. keep a managed database (§3).
3. **Turn the agreed direction into a real target-architecture design** (brainstorm → spec → phased migration plan). This is big enough to warrant its own spec and a careful, low-risk migration order (it's live in prod).
4. **Confirm the Twilio concurrency cap is actually raised** in the console (needed for the launch multi-answerer model; was still unconfirmed).

---

## 6. HOW THIS REFRAMES PRIOR IN-FLIGHT WORK (do NOT blindly resume these)
The stack-consolidation decision is now the **primary** thread and puts several items ON HOLD (not cancelled):
- **Web Push background-alerting** (`2026-06-30-background-call-alerting-handoff.md`) — likely demoted to a backstop once RustDesk is folded into the LC surface (insight #1). **Hold** — do not write the spec yet.
- **Realtime migration phases 2-4** (presence / kiosk liveness / dashboards) — the cost driver was polling on **metered serverless**; moving off Vercel/Supabase-managed to owned infra partly evaporates it. **Re-evaluate after the stack decision.**
- **Vercel Pro flip** (keep-warm, sub-daily crons) — **moot** if leaving Vercel.
- Don't sink build effort into these until the stack direction is locked.

---

## 7. STILL-OPEN HYGIENE (carry forward, unchanged)
- **Temp guest-audio diagnostics still on `main`** — remove once the first-call-audio cause is pinned. Removal list in `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4.
- **Max-call-duration cap** built but unmerged (`fix/max-call-duration-cap` @ `abcdcd9`) — also caps the Agora leaked-channel billing exposure. Decision pending: merge.
- **GitHub secret-scanning alert** still to close.
- v1.1 captions live in prod; v1.2 realtime incoming-call push live (migration 0018).
- First-call audio root cause (environmental device-switch) still not airtight-confirmed.

---

## 8. FILES UPDATED THIS SESSION
- `CLAUDE.md` — "What this is" rewritten to the real business model + **Remote desktop** added as a stack pillar + pod/overflow model. *(uncommitted)*
- `docs/PRODUCT.md` — new "Operating model — how it actually works" section. *(uncommitted)*
- Memory (auto-loaded): `business-model-remote-desktop` (read-first), `feedback-brainstorm-dialogue`, `stack-consolidation-direction`, + `MEMORY.md` index.
- This handoff.
- **CLAUDE.md + PRODUCT.md edits are UNCOMMITTED (working tree).** They load from disk regardless, but commit them if you want them in git history.

---

## 9. READING ORDER (fresh chat)
1. `CLAUDE.md` (business model + stack now correct) + auto-memory `MEMORY.md` (esp. `business-model-remote-desktop`, `stack-consolidation-direction`).
2. **This handoff.**
3. Prior handoffs for the reframed in-flight items: `2026-06-30-background-call-alerting-handoff.md`, `2026-06-28`/`2026-06-29` realtime handoffs, `2026-06-30-first-call-audio-debug-handoff.md`.
4. Then: **pull Kumar's RustDesk-integration idea** → decide the DB question → design the target architecture.
