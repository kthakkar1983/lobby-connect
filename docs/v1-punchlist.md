# v1 punch-list

Open items before calling **v1 (pilot, one hotel end-to-end)** complete. Started 2026-06-18 (session 25), after the brand revision shipped. Living doc — check items off as they land.

Read order context: `CLAUDE.md` → `MEMORY.md` → `memory/project-status.md`. Brand source: `docs/brand/brand-guidelines.md`.

---

## A. Call reliability — highest priority (core function)

- [x] **ROOT CAUSE FOUND (2026-06-19, systematic-debugging):** intermittent *"no one is available"* = the **Twilio account's concurrent-call limit is 1** (confirmed in console; business-verification request submitted to raise it, ~2 days) **colliding with the parallel-dial design**.

  **Evidence chain:** prod `calls` rows showed NO_ANSWERs dying in 7–15s (not the 120s ring window) → Twilio per-leg logs showed all three Client legs `failed`/`no-answer` at **0s (no ring)** → Twilio Monitor logged **error 10004 "call concurrency limit exceeded" on every call** (answered ones too) → account is Full but the **concurrent-call ceiling = 1**. Routing (`app/api/twilio/voice/incoming/route.ts`) fires a parallel `<Dial>` to **all 3 agent identities at once** (primary agent + 2 `accepting_calls` admins); with a limit of 1, only **one outbound leg** is placed and the other two are rejected. *Which* identity wins the single slot is a race; since **2 of the 3 agents (Dilnoza, Tejas) are offline**, the slot usually lands on a dead identity → greeting → no ring → apology. (Earlier "tab backgrounding" hypothesis was **refuted** by Kumar's foreground/background A-B test.)

  **The design gap (real, independent of the limit):** routing dials every `active` agent **regardless of whether their softphone is actually online** — the 20s presence heartbeat (stale after 90s = `PRESENCE_STALE_AFTER_MS`) drives the dashboard but is **never used by routing**. So offline agents are dialed (Dilnoza, offline ~2 days, is dialed on every call) and waste the scarce concurrency slot.

  **Temporal check (Kumar asked "why now?"):** the 10004 alerts + fast-misses go back **~2 weeks** (06-05 onward), so it is **not** a 3-day code regression — no routing code changed then. The misses were always possible at limit 1; the rate jumped from occasional to constant as the test agents (Dilnoza, Tejas) drifted offline **while still being dialed**, so the single slot now lands on a dead identity most of the time. ("Used to work with 2-3 online" = true: when everyone dialed was online, the slot always hit a reachable person.)

- [x] **FIX — presence-gate the dial — IMPLEMENTED** (branch `fix-dial-presence-gate`, 2026-06-19, TDD): new pure `isReachableForDial(status, lastSeenAt, nowMs)` in `lib/voice/presence.ts` (= `effectivePresence(...) === "AVAILABLE"`, so a stale heartbeat is correctly unreachable even though the OFFLINE sweep is daily); `resolvePrimaryAgent` / `resolveAvailableAdmins` now select `status, last_seen_at` and gate on it; empty-targets now also emits a Sentry warning ("no reachable agents") so the dead-end is observable. **Unblocks the pilot NOW even at limit = 1:** one online agent → single dial leg → fits the limit → connects every time. Predicate + route tests green (typecheck/lint/build/check:routes too). **PENDING: merge + a single-agent prod voice smoke** (call in with only your softphone online → should ring + connect reliably). **Complementary:** the concurrency-limit increase (~2 days) later allows fanning out to *multiple* online agents at once.

- [ ] **(Follow-up, lower priority) surface + harden the softphone Device** — presence is a proxy for "softphone alive," not a guarantee the Twilio Device is registered. Later: report real Device registration state (registered/unregistered/error) to the server/Sentry so routing can gate on true reachability + the agent gets a loud "line down — reload" signal.

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
