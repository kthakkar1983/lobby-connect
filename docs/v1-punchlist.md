# v1 punch-list

Open items before calling **v1 (pilot, one hotel end-to-end)** complete. Started 2026-06-18 (session 25), after the brand revision shipped. Living doc — check items off as they land.

Read order context: `CLAUDE.md` → `MEMORY.md` → `memory/project-status.md`. Brand source: `docs/brand/brand-guidelines.md`.

---

## A. Call reliability — highest priority (core function)

- [ ] **Harden softphone Device reachability + surface an unreachable line.**

  **Context (traced 2026-06-18):** call routing does **no presence polling**. Each incoming call does a fresh at-call-time lookup in `app/api/twilio/voice/incoming/route.ts` and dials, in parallel via Twilio `<Dial>` for the 120s `RING_WINDOW_SECONDS`:
  - the property's **primary agent** — dialed whenever `active` + has a `twilio_identity`, **regardless of whether their browser softphone is online** (`resolvePrimaryAgent`); and
  - **admins** with `accepting_calls = true` for that property (`resolveAvailableAdmins`).

  The presence layer (softphone heartbeat every **20s**; stale after **90s** = `PRESENCE_STALE_AFTER_MS`; daily OFFLINE sweep cron) drives the **dashboard** and the sweep — **NOT** who gets dialed. So the *"no one is available"* apology means **no dialed softphone answered in time**.

  **The gap:** if the assigned agent's browser Device isn't registered at call time (token-refresh lapse on a throttled/background tab, a closed tab, or a prior call's Device not fully torn down), the call rings into the void → apology, **with no fallback and no signal to the agent that their line is down**. Reproduced by Kumar on test calls (intermittent apology).

  **To do:** (1) investigate why the Device drops (token auto-refresh under tab throttling; back-to-back-call teardown timing); (2) decide + implement the right behavior — at minimum surface "your line dropped — reload" prominently when the Device deregisters; consider presence-gating the dial so an offline primary agent doesn't black-hole a call when an admin is covering. Scope a fix, then smoke on prod.

---

## B. UI / UX fixes

1. [ ] **Audio overlay: Hang up → blaze.** Change the Hang up button from navy (`bg-primary`) to **blaze** (`--color-attention`). **DECISION LOCKED** (Kumar, 2026-06-18) — red (911) was drawing the "end call" association; blaze on Hang up fixes that. This intentionally overrides the brand rule "blaze = needs-attention, never a CTA" for this one control; no brainstorming needed. (911 stays red/destructive, top-right.)

2. [ ] **Kiosk favicon.** Add the same navy-tile + reversed-mark icon to the kiosk (`apps/kiosk`, via its `index.html`). Explicit exception to the no-logo-on-kiosk rule — a browser-tab favicon is not an on-screen logo, so it's fine.

3. [ ] **Hourly chart redesign — match the reference, 3 series.** Restyle the agent-dashboard `HourlyVolumeChart` (`components/dashboard/channel-viz` / the chart card) to the clean reference Kumar shared ("Calls Per Hour": **thin, rounded-top bars grouped side-by-side per hour**, legend with colored dots top-right, light y-axis gridlines, airy spacing). Three series per hour: **Audio · Video · Missed** (brand mapping: audio = teal, video = navy, missed = blaze). Thinner bars than today.

4. [ ] **"total call duration:" → body font.** In the chart card, the "total call duration:" label currently uses a label/mono treatment; switch it to the **body font** (Outfit).

5. [ ] **Bump the desktop type scale.** General text reads small on desktop. Raise the base/desktop scale carefully so dense surfaces (tables, dashboards, the audit/calls lists) don't break or overflow.

6. [ ] **Logo + wordmark on every auth page.** Verify the lockup shows on **sign-in, forgot-password, update-password, and onboarding** — some may only render the wordmark (or nothing) today. Make them consistent.

7. [ ] **Make the incoming-call property name unmistakable.** On an incoming call the agent must instantly see *which property* it's for. Today the softphone shows a quiet "Incoming call · {property}" line — give the property name far more prominence (size/weight/placement) so it's absolutely clear at a glance.

---

## C. Verification

- [ ] **Audio in-call smoke — ONGOING** (Kumar testing). Still to confirm the new bits: **hotel local time renders + ticks** (matches the property's configured tz) and **typing a note + Enter → ✓ Saved → row lands in the DB**. (Routing/apology behavior already exercised — see A.)
- [ ] **Live a11y / reduced-motion / screen-reader pass** — ongoing as Kumar keeps testing; fold remaining checks in.
- [x] **Owner portal live browser pass — DONE + verified** (Kumar, 2026-06-18).

---

## D. Docs / security

- [ ] **Plain-English security & data-posture writeup** (`docs/security-posture.md`) — a readable, audit-style explanation (not code) of how the system handles, at minimum:
  - **Auth:** Supabase Auth (password-only, invite/admin-provisioned), `must_change_password` first-login gate, the Next.js middleware gate, RLS-on-every-table model + the column-guard triggers.
  - **Token retention / lifetimes:** Supabase session/JWT, the **Twilio voice access token** (~1h, in-place auto-refresh), **Agora** RTC tokens, and where each lives (cookie / memory) and for how long.
  - **Caching:** the Next.js caching layers in use (`cache()` request-dedupe, `unstable_cache` for the Sentry probe, the polling/refetch model — no realtime subscriptions), and what is/isn't cached.
  - **PII handling:** Sentry `beforeSend` scrubbing, what gets logged in `audit_logs`, recording status (none in v1).
  - **Secrets / service-role:** where the service-role key is used (Twilio webhooks, cron, admin provisioning) and the boundary that keeps it out of app code.

  When we tackle this, gather the facts from the code first; consider running the `security-review` skill for a rigor pass alongside the writeup.

---

### Notes
- **Audio-only scope** still holds for the in-call overlay; the video overlay's shared-`CallShell` extraction remains a deferred v2 seam.
- Items already deferred to **v2** (not v1 blockers): custom domain, voicemail/callback queue, PagerDuty, ops dashboard, MFA, transcription, mobile-responsive agent/admin portals, the admin off-tab video nudge (`docs/v2-backlog.md`), pod-scoped agent dashboard, phone-health "path down" red, Pro-tier keep-warm + sub-daily crons.
