# v1 punch-list

Open items before calling **v1 (pilot, one hotel end-to-end)** complete. Started 2026-06-18 (session 25), after the brand revision shipped. Living doc — check items off as they land.

Read order context: `CLAUDE.md` → `MEMORY.md` → `memory/project-status.md`. Brand source: `docs/brand/brand-guidelines.md`.

> **v1 (pilot, one hotel end-to-end) is COMPLETE — 2026-06-22 (Kumar).** §A (call reliability) is closed: the single-agent voice smoke passed (audio connects reliably with the presence-gated routing). The **Twilio concurrent-call cap (=1) and multi-agent fan-out are deferred to v2** (`docs/v2-backlog.md` → Agents/routing) — v1 ships with single-agent routing. Remaining unchecked items below are non-blocking niceties or v2 pointers.

---

## A. Call reliability — highest priority (core function)

- [x] **ROOT CAUSE FOUND (2026-06-19, systematic-debugging):** intermittent *"no one is available"* = the **Twilio account's concurrent-call limit is 1** (confirmed in console; business-verification request submitted to raise it, ~2 days) **colliding with the parallel-dial design**.

  **Evidence chain:** prod `calls` rows showed NO_ANSWERs dying in 7–15s (not the 120s ring window) → Twilio per-leg logs showed all three Client legs `failed`/`no-answer` at **0s (no ring)** → Twilio Monitor logged **error 10004 "call concurrency limit exceeded" on every call** (answered ones too) → account is Full but the **concurrent-call ceiling = 1**. Routing (`app/api/twilio/voice/incoming/route.ts`) fires a parallel `<Dial>` to **all 3 agent identities at once** (primary agent + 2 `accepting_calls` admins); with a limit of 1, only **one outbound leg** is placed and the other two are rejected. *Which* identity wins the single slot is a race; since **2 of the 3 agents (Dilnoza, Tejas) are offline**, the slot usually lands on a dead identity → greeting → no ring → apology. (Earlier "tab backgrounding" hypothesis was **refuted** by Kumar's foreground/background A-B test.)

  **The design gap (real, independent of the limit):** routing dials every `active` agent **regardless of whether their softphone is actually online** — the 20s presence heartbeat (stale after 90s = `PRESENCE_STALE_AFTER_MS`) drives the dashboard but is **never used by routing**. So offline agents are dialed (Dilnoza, offline ~2 days, is dialed on every call) and waste the scarce concurrency slot.

  **Temporal check (Kumar asked "why now?"):** the 10004 alerts + fast-misses go back **~2 weeks** (06-05 onward), so it is **not** a 3-day code regression — no routing code changed then. The misses were always possible at limit 1; the rate jumped from occasional to constant as the test agents (Dilnoza, Tejas) drifted offline **while still being dialed**, so the single slot now lands on a dead identity most of the time. ("Used to work with 2-3 online" = true: when everyone dialed was online, the slot always hit a reachable person.)

- [x] **FIX — presence-gate the dial — IMPLEMENTED** (branch `fix-dial-presence-gate`, 2026-06-19, TDD): new pure `isReachableForDial(status, lastSeenAt, nowMs)` in `lib/voice/presence.ts` (= `effectivePresence(...) === "AVAILABLE"`, so a stale heartbeat is correctly unreachable even though the OFFLINE sweep is daily); `resolvePrimaryAgent` / `resolveAvailableAdmins` now select `status, last_seen_at` and gate on it; empty-targets now also emits a Sentry warning ("no reachable agents") so the dead-end is observable. **Unblocks the pilot NOW even at limit = 1:** one online agent → single dial leg → fits the limit → connects every time. Predicate + route tests green (typecheck/lint/build/check:routes too). **PENDING: merge + a single-agent prod voice smoke** (call in with only your softphone online → should ring + connect reliably). **Complementary:** the concurrency-limit increase (~2 days) later allows fanning out to *multiple* online agents at once.

- [x] **SMOKE (2026-06-19) → gate over-excluded ON_CALL agents; refined + re-shipped** (merge `d18d452`, `systematic-debugging` + TDD). The single-agent smoke *still* apologized. **Twilio per-leg logs were decisive:** the assigned agent (Dilnoza) was **never dialed** — both legs went to the two admins (one Device dead → 0s fail; one registered-but-unmanned → 125s no-answer). Root cause: she'd finished a **VIDEO call ~22s earlier**, so her presence was **ON_CALL**, and `isReachableForDial` required `status === "AVAILABLE"` *exactly* → `resolvePrimaryAgent` skipped her. **Fix:** reachable = **`AVAILABLE || ON_CALL`** + fresh heartbeat (= the dashboard's `countOnlineAgents` "online" definition); still excludes AWAY (opted-out) + stale/OFFLINE.

- [x] **DONE (2026-06-22) — single-agent voice smoke passed** (Kumar): audio connects reliably with the presence-gated routing. The concurrency raise + multi-agent fan-out are **deferred to v2** (`docs/v2-backlog.md` → Agents/routing). Original hygiene note kept for reference: At **Twilio concurrency = 1, multiple reachable targets RACE for the one slot** — if an admin is also online + `accepting_calls` (Tejas was), the dial can land on them, not the agent. For a reliable single-agent smoke: ensure ONLY that agent is reachable (admins `accepting_calls=false` or genuinely offline ≥90s) **and keep the agent's tab foregrounded** (a backgrounded tab throttles the 20s heartbeat → stale → OFFLINE → excluded). The concurrency raise (~2026-06-21) is what makes multi-agent fan-out reliable. **Status (2026-06-20 log check):** prod calls connect reliably (06-20 audio 4/4, Twilio 10004 alerts → 0, agent now dialed) — but this clean isolated test **still hasn't been run** (Dilnoza + Tejas + Kumar were all online, so connects always had ≥2 manned identities), and the cap itself is **still unconfirmed in the Twilio console** (was 1).

- [ ] **(Follow-up — DEFERRED TO v2) surface + harden the softphone Device** — presence is a proxy for "softphone alive," not a guarantee the Twilio Device is registered (it lags by up to the 90s staleness window — a just-closed browser is dialed into a 0s-fail leg, as seen in the 2026-06-19 smoke). Later: report real Device registration state (registered/unregistered/error) to the server/Sentry so routing can gate on true reachability + the agent gets a loud "line down — reload" signal. **Live evidence (2026-06-20, via Sentry):** the admin softphone logs `WSTransport` close 1005 → `Device` error `TransportError 31009` (no transport) on `/admin` while presence still read AVAILABLE — the exact 0s-fail-leg mechanism, now observable.

- [x] **Sentry hygiene (2026-06-20, surfaced during §A debugging).** Gated Sentry to deployed builds only — local `next dev`/`vite dev` no longer pollute the prod project (the recurring "ReferenceError: X is not defined" issues were dev HMR, not prod). Added a TDD'd `beforeSend` filter (`lib/sentry/noise.ts` → `isTwilioTransportNoise`) that drops the benign Twilio transport-churn rejection **only** when correlated with Twilio breadcrumbs (a real empty rejection still reports). Added `pnpm sentry:issues` CLI (`scripts/sentry-issues.mjs`) + read-scoped `SENTRY_READ_TOKEN` (Internal Integration; the build `SENTRY_AUTH_TOKEN` is upload-only → 403 on the issues API). Shipped as PRs #20 + #21 (merged to `main` → prod). **Also fixed — the `/admin/status` error-count card** (`lib/sentry/errors.ts`): now prefers `SENTRY_READ_TOKEN` (the upload-only `SENTRY_AUTH_TOKEN` 403'd → card was silently null; Kumar added the read token to **Vercel prod env**); the query was counting **all-time** unresolved (Sentry `statsPeriod` does not filter by age → showed "2" June-4 stragglers vs the dashboard's 0) → fixed with `lastSeen:-24h`; cache bumped 60s→120s to ease the issues-endpoint rate limit (transient grey flaps, self-heal).

- [x] **Presence-display mismatch fixed (2026-06-20, PR #22).** Admin dashboard Properties board showed an agent OFFLINE while `/admin/users` showed the same agent AVAILABLE. Cause: the users table rendered the **raw `profiles.status` column**; everywhere else (dashboard, owner portal, routing) computes `effectivePresence` (heartbeat stale >90s → OFFLINE; the OFFLINE sweep is only daily). Fix: `/admin/users/page.tsx` maps through `effectivePresence`; also consolidated the dashboard's 2 inline `isStale ? OFFLINE : status` onto the same helper. Non-softphone OWNERs now read OFFLINE in the list (accurate) — blanking presence for owners is an easy open follow-up.

---

## B. UI / UX fixes

> **All 7 implemented 2026-06-19 (session 26)** on `main` working tree — typecheck (4 workspaces) · lint · check:routes · 475 portal tests · portal+kiosk builds all green. **NOT yet committed; NOT yet visually confirmed in a live browser.** The visual-judgment items (B3 chart, B5 type scale, B7 prominence) want Kumar's eyes before final sign-off — folds into §C. TDD only applied where there was logic (B3's `hourlyVolume` 3-series partition).

1. [x] **Audio overlay: Hang up → blaze.** — DONE. `bg-primary`→`bg-attention` + `text-attention-foreground` (brand-correct ink-on-blaze pairing) in `components/softphone/audio-call-overlay.tsx`, with a comment recording the intentional brand override. 911 unchanged (red, top-right).

2. [x] **Kiosk favicon.** — DONE. Reused the portal's navy-tile + reversed-mark SVG at `apps/kiosk/public/icon.svg` + `<link rel="icon">` and `theme-color` in `apps/kiosk/index.html`; build copies it to `dist/icon.svg` (verified).

3. [x] **Hourly chart redesign — 3 series.** — DONE (wants live visual confirm). `HourlyVolumeChart` rebuilt as thin (`max-w-[5px]`, `flex-1` responsive) rounded-top bars grouped side-by-side per hour over light gridlines; new 3-series `HourlyLegend` (Phone=teal · Video=navy · Missed=blaze) swapped into all three chart cards (agent/admin/owner). **Data partition is the clean one:** `audio`=answered AUDIO, `video`=answered VIDEO, `missed`=NO_ANSWER (FAILED + live excluded → no double-count). `hourlyVolume`/`HourBucket` extended TDD (RED→GREEN), 20/20. Pod/board `ChannelBar` keeps the 2-series `ChannelLegend`.

4. [x] **"total call duration:" → body font.** — DONE. Dropped `font-mono` from the duration line on the agent + admin dashboards (now Outfit).

5. [x] **Bump the desktop type scale.** — DONE (wants live visual confirm). `globals.css`: `@media (min-width:1024px) { html { font-size: 106.25% } }` — a *percentage* (respects the user's browser default) so Tailwind's rem-based text **and** spacing scale together (+6.25%) → dense tables/dashboards reflow proportionally, not overflow. Single knob; raise toward 112.5% if it still reads small on a real monitor.

6. [x] **Logo + wordmark on every auth page.** — DONE. Extracted `components/auth/auth-shell.tsx` (swaps `Wordmark`→`LogoLockup` = mark + wordmark); `(auth)/layout.tsx` delegates to it (covers sign-in/forgot/onboarding); new `app/auth/layout.tsx` brings `update-password` (outside the `(auth)` group, URL must stay `/auth/update-password`) into the same shell; `update-password/page.tsx` stripped to just its form.

7. [x] **Make the incoming-call property name unmistakable.** — DONE (wants live visual confirm). `softphone.tsx` incoming phase: quiet "Incoming call" eyebrow + the property name in a large bold `font-display text-2xl` line (fallback "Unknown property").

---

## C. Verification

- [ ] **Audio in-call smoke — ONGOING** (Kumar testing). Still to confirm the new bits: **hotel local time renders + ticks** (matches the property's configured tz) and **typing a note + Enter → ✓ Saved → row lands in the DB**. (Routing/apology behavior already exercised — see A.)
- [ ] **Live a11y / reduced-motion / screen-reader pass** — ongoing as Kumar keeps testing; fold remaining checks in.
- [x] **Owner portal live browser pass — DONE + verified** (Kumar, 2026-06-18).

---

## D. Docs / security

- [x] **Plain-English security & data-posture writeup** (`docs/security-posture.md`) — a readable, audit-style explanation (not code) of how the system handles, at minimum:
  - **Auth:** Supabase Auth (password-only, invite/admin-provisioned), `must_change_password` first-login gate, the Next.js middleware gate, RLS-on-every-table model + the column-guard triggers.
  - **Token retention / lifetimes:** Supabase session/JWT, the **Twilio voice access token** (~1h, in-place auto-refresh), **Agora** RTC tokens, and where each lives (cookie / memory) and for how long.
  - **Caching:** the Next.js caching layers in use (`cache()` request-dedupe, `unstable_cache` for the Sentry probe, the polling/refetch model — no realtime subscriptions), and what is/isn't cached.
  - **PII handling:** Sentry `beforeSend` scrubbing, what gets logged in `audit_logs`, recording status (none in v1).
  - **Secrets / service-role:** where the service-role key is used (Twilio webhooks, cron, admin provisioning) and the boundary that keeps it out of app code.

  When we tackle this, gather the facts from the code first; consider running the `security-review` skill for a rigor pass alongside the writeup.

  **DONE (2026-06-20, session 28).** `docs/security-posture.md` written — source-backed, audit-style, covering auth/access-control, token lifetimes (Supabase session; Twilio Voice 1h; Agora 1h; kiosk HMAC no-expiry), caching (`cache()` request-dedupe / `unstable_cache` 120s Sentry probe / 20s poll, no realtime), PII (Sentry scrub + audit log + recording-off), and the service-role boundary. Ran the `security-review` skill over the auth/RLS/service-role/Twilio-HMAC/token surfaces **plus a live Supabase security-advisor check** → **no high/medium exploitable vuln.** Triage: **fixed** the Sentry recording-URL scrubbing gap (TDD, `packages/shared/src/sentry-scrub.ts`); **filed two** defense-in-depth items to `docs/v2-backlog.md` (kiosk-token expiry/revocation — MEDIUM; Agora-token uid namespace — LOW); **documented as accepted** the two advisor WARNs (SECURITY DEFINER executable-by-`authenticated` = by-design per `0014`; leaked-password protection = known Pro-tier deferral).

  **Optional cleanups (session-27 PICK-UP item 4):** OWNER presence in `/admin/users` now shows "—" (new TDD'd `roleHasPresence` in `lib/voice/presence.ts`; wired in `page.tsx` + `users-table.tsx`) — agent/admin presence unchanged. **ring.mp3 downsize NOT done** — no mp3 encoder in the dev sandbox (no `ffmpeg`/`lame`/`sox`; `afconvert` can't emit mp3); the 681KB/320kbps file is unchanged. Do it later with: `ffmpeg -i ring.mp3 -ac 1 -b:a 80k ring.new.mp3` → replace → confirm it still rings on an incoming **video** call (prod-only test).

---

### Notes
- **Audio-only scope** still holds for the in-call overlay; the video overlay's shared-`CallShell` extraction remains a deferred v2 seam.
- Items already deferred to **v2** (not v1 blockers): custom domain, voicemail/callback queue, PagerDuty, ops dashboard, MFA, transcription, mobile-responsive agent/admin portals, the admin off-tab video nudge (`docs/v2-backlog.md`), pod-scoped agent dashboard, phone-health "path down" red, Pro-tier keep-warm + sub-daily crons.
