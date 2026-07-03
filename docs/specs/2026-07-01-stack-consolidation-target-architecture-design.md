# Stack consolidation — target architecture (design spec)

**Date:** 2026-07-01 · **Status:** LOCKED (direction + component choices; each migration phase gets its own detailed spec/plan at build time) · **Companion:** `docs/plans/2026-07-01-stack-consolidation-migration.md`

Sourcing per CLAUDE.md discipline: prices/limits/capabilities below are **source-backed** (linked) unless explicitly labeled *estimate* or *verify at build*. Research was done 2026-07-01 via two web-research passes; key citations are embedded so future sessions don't re-derive.

---

## 1. Why

The current stack was optimized for "solo dev ships a free pilot fast," which conflicts with "simple + cheap at 10–25 properties":

- **~9–10 rented vendors** where 3–4 would do; each free tier is engineered to get expensive exactly when usage grows.
- **Agora trust is broken:** a 7 min 39 s test call billed as **71 minutes** (aggregate participant×stream billing + leaked channels billing until token expiry). Opaque, unpredictable, unwatchable.
- **Vercel's spin-up-on-demand model is a poor fit for telephony** (cold-start first-ring delay, daily-cron cap on Hobby, auto-pause risk) and priced per-seat/per-use at scale.
- **RustDesk — how agents do the actual front-desk work — lives entirely outside the product.** That is the root of the background-tab "no ring" problem (the agent's foreground is a different app) and the workflow pain (open app → find property → wait → work).
- **A future maintainer (India hire, system-maintenance role, not ops) needs as few endpoints as possible** — fewer vendors, fewer consoles, boring mainstream tech.

Scale envelope this design targets: **10–25 properties, 5–10 agents, a couple of admins, 1 hotel PC per property, night-shift usage, single-digit concurrent calls** (Kumar, 2026-07-01).

## 2. Target end state

| Component | Today | Target | Disposition |
|---|---|---|---|
| Portal + kiosk hosting | Vercel (Hobby) | **Coolify on owned VPS** | Move — re-host, not rewrite |
| Video | Agora | **Self-hosted LiveKit** (+ embedded TURN) | Replace — the one real code swap |
| Remote desktop | RustDesk, public relay, standalone app | **Self-hosted hbbs/hbbr relay + dashboard-integrated native client** | Move + integrate (new product surface) |
| Phone | Twilio | Twilio | **Keep, unchanged** |
| DB / Auth / Storage | Supabase (free) | **Supabase managed, Pro ($25/mo)** | Keep managed; final self-host call deferred to migration end (leaning permanent-keep — it also owns Auth) |
| Captions | Speechmatics | Speechmatics | Keep (bounded metering; swap seam `lib/captions/provider.ts` exists) |
| Errors | Sentry (free) | Sentry (free) | Keep for now; GlitchTip self-host = optional later |
| Analytics | @vercel/analytics | removed | Dies with Vercel; Umami optional later |
| CI / code | GitHub + Actions | GitHub + Actions | Keep |
| Domain | none (vercel.app URLs) | **Custom domain (NEW, required)** | Twilio webhooks, kiosk links, and Supabase auth URLs cannot point at vercel.app once we leave |

**Rented after consolidation:** Twilio, Supabase, Speechmatics, DigitalOcean (one box), a domain registrar, GitHub. **Owned:** one VPS running everything else. Endpoint count for a future maintainer: 1 server + ~3 SaaS consoles.

## 3. The server

**Pick: DigitalOcean Basic Regular droplet, 4 vCPU / 8 GB / 160 GB, $48/mo, 5 TB transfer included** ([DO pricing](https://www.digitalocean.com/pricing/droplets), fetched 2026-07-01). US region nearest the pilot (NYC/SFO→ choose lowest RTT to OKC; measure at provision). *(Resolved 2026-07-02: **NYC3** — ATL1 lacks the size, and the ~95%-India agent workforce anchors US-East either way; decision record in the Phase-1 spec §1.)*

Why not the usual suspects:
- **Hetzner US is out** — a 2026-06-15 price adjustment raised US prices ~3× (CPX31 4c/8GB now **$73.49/mo**, and US locations include only 3–4 TB traffic vs 20 TB EU) ([official price-adjustment doc](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)). EU regions stay cheap but are wrong for US-hotel RTT on TURN/remote-desktop relay.
- **Vultr is the price floor** (vc2 4c/8GB $40, vhp 4c/8GB $48/6TB — [Vultr plans API](https://api.vultr.com/v2/plans?type=vhp&per_page=500)) and stays the named alternate. DO wins on ergonomics, docs, and maintainer familiarity (*judgment call, not a benchmark*).
- **AWS is out (decision record added 2026-07-02, Kumar's challenge):** capable but wrong twice. Egress is $0.09/GB after 100 GB free ([AWS on-demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)) → ~$81–126/mo at our 1–1.5 TB/mo estimate — more than the whole box — vs **5 TB included** at DO; comparable 4c/8GB compute ≈ 2.5× the droplet (*estimate*); and the console/IAM/billing surface fails the India-maintainer constraint (§1). Lightsail (AWS's flat-price VPS clone) beats DO on nothing we need (*judgment*). Split-ready containers (§3) keep the door open if compliance inheritance or autoscale ever matter.
- **Cloudflare hosting is out (same challenge):** disqualified on capability, not price — Workers/Pages/Containers front everything through the HTTP fabric and **end-users cannot make non-HTTP TCP or UDP requests to a Container** ([CF Containers docs](https://developers.cloudflare.com/containers/)), so LiveKit and the RustDesk relay cannot run there at all; Cloudflare Calls is a managed **metered** SFU ([announcement](https://blog.cloudflare.com/cloudflare-calls-anycast-webrtc/)) — the Agora billing shape this consolidation exits. Cloudflare's role stays registrar + DNS (grey-cloud for infra hosts) + R2.

**Sizing rationale (labeled estimates on source-backed benchmarks):**
- LiveKit's own benchmark: a 16-core node carries a 150-publisher/150-subscriber video room at 85% CPU ([benchmark docs](https://docs.livekit.io/home/self-hosting/benchmark/)). Our peak (~5–10 concurrent 1:1 calls = 10–20 streams) ≈ **1–2 cores** — *estimate derived from that benchmark; LiveKit publishes no per-call figure*.
- RustDesk server: "hardware requirements are very low… a Raspberry Pi" is sufficient; relay traffic 30 KB/s–3 MB/s per session, ~100 KB/s for office work ([RustDesk self-host docs](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/)).
- Coolify minimum: 2 CPU / 2 GB / 30 GB ([install docs](https://coolify.io/docs/get-started/installation)); Coolify itself is free/open-source, all features ([pricing](https://coolify.io/pricing)).
- Next.js standalone + kiosk static are small. **Net: the 4c/8GB box carries the 12-month target with >50% headroom** (*estimate*). DO vertical resize is the relief valve.

**Single-box now, split-ready forever (design rule):** LiveKit, TURN, and hbbs/hbbr run as containers with all config in git and no meaningful local state — liftable to a second "media box" in an afternoon if we ever want blast-radius isolation. Do not let app and media services grow entangled (no shared volumes, no localhost-only assumptions between them).

**Known wrinkle:** LiveKit's TURN/TLS wants 443 ([deployment docs](https://docs.livekit.io/home/self-hosting/deployment/)) and Coolify's proxy also wants 443. Resolve with TURN on 5349/tcp+3478/udp or a second reserved IP. Config work; decide at Phase-4 build.

**Bandwidth:** realistic total ~1–1.5 TB/mo (*estimate*: video ≈ 2.7 Mbps/stream derived from the LiveKit benchmark → ~450 GB/mo at 25 properties × 3 calls × 5 min; RustDesk relay 0.4–0.9 TB worst-case-all-relayed) vs 5 TB included. The wildcard is RustDesk falling back to relay with motion-heavy screens (3 MB/s peak per the docs above) — **mitigation: make direct P2P connections work** (native clients hole-punch; the relay is the fallback, not the norm). Overage if ever: $0.01/GiB ([DO](https://docs.digitalocean.com/products/droplets/details/pricing/)).

**Backups/DR:**
- DO auto-backups, weekly, 20% of droplet price (+$9.60/mo) ([DO pricing](https://www.digitalocean.com/pricing/droplets)); snapshot manually before each migration phase. *(Timing decided 2026-07-02: the auto-backup toggle stays OFF through Phases 1–4 — the box is staging-only and rebuilds from git + runbook; phase-boundary snapshots suffice. Enable at Phase-5 cutover.)*
- Supabase Pro includes 7-day backups ([supabase.com/pricing](https://supabase.com/pricing)).
- Belt-and-suspenders: nightly `pg_dump` + Coolify/env config dump → Cloudflare R2 ($0.015/GB-mo, zero egress, 10 GB free — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)) ≈ $0–0.15/mo.

## 4. RustDesk integration (the new product surface)

**Model: Lobby Connect becomes the broker of remote access.** LC issues/stores/rotates/revokes each hotel PC's unattended-access credential and connects agents with one click; agents never see a password. This is credentials, not card data — PCI-safe.

**Self-hosted relay:** `hbbs` (ID/rendezvous) + `hbbr` (relay), AGPL-3.0, free ([rustdesk/rustdesk-server](https://github.com/rustdesk/rustdesk-server)). Ports 21115/tcp, 21116/tcp+udp, 21117/tcp; **21118/21119 (web-client ports) stay closed** — we don't use the web client ([docker docs](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/)). **No session/connection limits exist on the OSS server** — the "1 concurrent connection" belief maps to RustDesk's *Customized V2* paid plan ($24/each additional concurrent connection, [pricing](https://rustdesk.com/pricing/)); every other plan and the OSS path are unlimited.

**Connect flow (agent side):**
1. Agent clicks **Connect** (property card, or in-call).
2. Portal API returns `{ peerId, password }` just-in-time — authenticated via `requireApiActor` (operator-scoped like every session route; per-property tightening rides the existing v2 scoping seam), audited (`remote_access.connected`).
3. Client fires the deep link **`rustdesk://connection/new/<peerId>?password=<pw>`** — format verified in RustDesk's shipped source (`urlLinkToCmdArgs` in [flutter/lib/common.dart](https://github.com/rustdesk/rustdesk/blob/master/flutter/lib/common.dart); community-confirmed in [discussion #5299](https://github.com/rustdesk/rustdesk/discussions/5299)). Fire via programmatic navigation (no history entry); CLI equivalent `rustdesk --connect <id> --password <pw>` exists for a future desktop shell.
4. Native RustDesk opens the session; the call (if any) morphs into the floating window (§5).

**Hotel-PC provisioning (per property, scriptable):** `--silent-install`, then `--config <encrypted-config-string>` (points the client at OUR hbbs/hbbr + pins our public key) and `--password <unattended-pw>` — all officially documented for mass deployment ([client-deployment](https://rustdesk.com/docs/en/self-host/client-deployment/), [client-configuration](https://rustdesk.com/docs/en/self-host/client-configuration/), [MSI](https://rustdesk.com/docs/en/client/windows/msi/)). One provisioning script per hotel PC, kept in the repo.

**Schema (new, at Phase-3 build):** `property_remote_access` — `property_id` (FK, unique), `peer_id`, `unattended_password` (service-role-only reads; encrypted at rest by Supabase, optional app-layer envelope encryption decided at build), `operator_id`, timestamps. Admin CRUD in the admin portal; every read/issue/rotate audited.

**Rejected alternatives (decision record, 2026-07-01 research):**
- **RustDesk Web Client V2 (in-page embed)** — REJECTED: closed-source (V1 source deleted from `master` 2025-07-01, V2 never published), officially a "preview," self-hosting it is gated behind Server Pro ≥ **$47.88/mo** ([pricing FAQ](https://rustdesk.com/pricing/)), **no URL-param/iframe auto-connect API** (the exact ask is an unanswered GitHub discussion, [#14059](https://github.com/rustdesk/rustdesk/discussions/14059)), and — decisive — **in-browser E2EE cannot be source-verified for V2**, which is the property our PCI story rests on.
- **lejianwen/rustdesk-api unofficial web bundle** — REJECTED for the pixel path (unverified provenance of redistributed V2 binaries; same E2EE gap).
- **Apache Guacamole / MeshCentral-style gateways** — REJECTED by construction: the server decodes the session → LC would carry decryptable pixels → PCI scope.
- **KasmVNC** (nearest OSS browser-viewer architecture) — REJECTED: no Windows support ([Kasm docs](https://www.kasmweb.com/docs/latest/how_to/fixed_infrastructure.html)).
- Recorded filter for any future "or similar" candidate: **OSS + self-hostable + unattended access + browser-or-embeddable viewer + relay-blind E2EE + Windows targets.** Nothing besides RustDesk passes today.

**PCI rules (restated, load-bearing):** LC may serve clients and broker credentials; LC must **never carry or decrypt the remote-desktop pixel stream** (the hotel screen shows cardholder data). RustDesk E2EE is maintainer-confirmed peer-to-peer ("Between machines"; NaCl sign/box/secretbox — [discussion #2239](https://github.com/rustdesk/rustdesk/discussions/2239)); hbbr forwards ciphertext. **Operational rule:** pin our server key on all clients; RustDesk sessions *can* run unencrypted in some configs and the client shows an encryption indicator ([FAQ](https://github.com/rustdesk/rustdesk/wiki/FAQ)) — a non-encrypted session = incident. *This remains our read, not a QSA's — get professional sign-off before big-chain contracts.*

**Security notes:** deep-link password exposure is local to the agent's machine (process args/URL handler) — accepted for now; **per-connect rotation** (rotate the unattended password after each session via a hotel-PC-side hook) is the designed v2 upgrade seam. Credentials never render in any UI.

## 5. Agent + admin workspace (dashboard rework — direction)

Detailed UX spec comes at Phase-3 build; the locked direction (amended after Kumar's 2026-07-01 review round):

- **Property cards (shared component, two scopes).** One card per property showing presence/status, tonight's stats, **ringing state + Answer on the card itself** (kills property misidentification; retires the separate incoming-call toast/banner placements), and **Connect**. Agent scope = their pod (~5 assigned properties). Zero changes to routing/Twilio/dial logic — only where the Answer button lives.
- **The deskphone tile — persistent, all shift, not an in-call artifact.** At shift start the agent clicks once ("Go on duty"): that gesture opens an **always-on-top Document Picture-in-Picture tile** *and* unlocks audio (same autoplay-priming pattern as the session-22 video ringtone). All shift the tile floats above everything — fullscreen YouTube, the news, a full-screen RustDesk session — showing line status + pod state, and it **rings visibly and audibly on top of whatever the agent is doing**. During a call it morphs into the call controls (guest video, mute/**hold**/hang-up/911, quick Room#/note field, timer) and still shows incoming rings for *other* properties; afterwards it shrinks back to the deskphone. It is a real resizable mini-page (buttons/fields/layout), not a video thumbnail. **Framing: the tile is the lifeline, not the workspace** — playbook reading, long notes, and the dashboard stay in the portal tab one Alt-Tab away; while the agent works the PMS, the call is an audio activity. Document PiP is Chromium-only → **agents standardize on Chrome/Edge (SOP)**; graceful degradation = plain `<video>` PiP.
- **Layered alerting (the once-and-for-all stack):**
  1. **The deskphone tile** — primary; structurally cannot be buried under other windows/tabs.
  2. **Web Push OS notifications via a service worker — BUILT in Phase 3** (no longer a parked seam): rings even if the tile got closed or the browser is minimized; clicking focuses the portal. The prior direction in `docs/handoffs/2026-06-30-background-call-alerting-handoff.md` folds in here as layer 2.
  3. The phone path already survives backgrounding (Twilio Voice SDK rings in background tabs today — the v1.2 regression was the video/Realtime path only).
  - **Verify-at-build (live browser, inside the Phase-3 prototype gate):** (a) an open PiP window keeps its parent tab exempt from Chrome's background throttling (expected — PiP counts as visible — but tested, not trusted); (b) the tile floats above OS-fullscreen video on the agents' actual machines. Agent-machine SOP (dedicated work Chrome profile, focus-assist/notification-suppression off, "continue running in background" on) goes in the Phase-1 ops runbook.
- **Hold** (new feature, resurrects the v1-cut held-call slot): one click pauses audio+video. Audio rides the existing Twilio Conference seam (the 911 path precedent); video = LiveKit track pause once we own the media server. Held state visible on the property card + tile.
- **Pre-warm:** on answer, do the connection handshake (credential fetch + deep-link readiness); render pixels only on expand. Zero-wait feel without background decode cost.
- **Escalation fallback (recorded):** if the tile disappoints at the Phase-3 prototype gate, the fallback is a thin desktop shell (Tauri-class) wrapping the portal — real window management, a dockable sidebar beside RustDesk, native notifications. Deliberately not the first choice (install + auto-update burden); the gate decides *before* Phase-3 proper is built.

### 5b. Admin workspace (same system, wider scope — locked 2026-07-01)

- **Fleet view, grouped by pod:** agent header (presence) + their properties beneath, for every pod; the existing command-center strip (live calls, agents online, open incidents, phone health) stays on top. Same shared card component as the agent view — only the selection differs.
- **Ringing/Answer on admin cards is gated by `covering`** — exactly the existing dial-routing rule; no routing changes.
- **Connect is NOT gated by covering: admins can Connect to any property's hotel PC at any time** (fleet-support role — "let me look at hotel 12's PC"). Locked per Kumar. Credential API stays operator-scoped (`requireApiActor`), which already permits this; every connect is audited either way.
- Admins get the same deskphone tile + layered alerting; RLS is already operator-wide for admins, so no policy changes.

## 6. Video: Agora → LiveKit

- **LiveKit OSS**, Apache-2.0 ([github.com/livekit/livekit](https://github.com/livekit/livekit)), **embedded TURN** ([deployment docs](https://docs.livekit.io/home/self-hosting/deployment/)) — one Go binary + optional Redis (not needed at our scale, *verify at build*).
- **Swap surface (bounded):** kiosk `src/lib/agora.ts`; portal `components/video-call/*` client bits; `/api/agora/token` → a LiveKit token route (server-minted JWT, same pattern as today); env vars. **Unchanged:** `calls` rows, multi-owner finalization, emergency logic, notes, captions *architecture* (Speechmatics taps the remote `MediaStreamTrack`; LiveKit exposes remote tracks as MediaStreamTracks — *verify at build*).
- **Why LiveKit and not Jitsi (recorded rationale, 2026-07-01):** they are different *kinds* of thing. Jitsi is a finished meetings **product** — its own UI and a multi-service stack (Prosody XMPP + Jicofo + JVB + web app); using it means either adopting its meeting interface (discarding our built-and-branded kiosk/portal call UX) or building on its low-level library (`lib-jitsi-meet`), which is poorly documented. LiveKit is **infrastructure for people who already have a UI** — one Go binary server + a modern JS SDK with the same shape as the Agora SDK we build on today (token in, tracks out, raw `MediaStreamTrack` access for the captions tap). The migration is "swap the SDK calls inside existing components"; kiosk screens, call state machine, finalization, and captions architecture survive. Honest concession: Jitsi can go direct P2P for 1:1 calls and skip server bandwidth; LiveKit always relays through our SFU — priced in (§3/§9, ~450 GB/mo vs 5 TB included), so we pay nothing real for the better-fitting tool. **Jitsi is the named plan B** if LiveKit disappoints in the Phase-4 staging trial. mediasoup (a library requiring us to write the server) is out. (*Judgment, consistent with the research.*)

## 7. App hosting: Vercel → Coolify

- Next.js runs anywhere Node does — **re-host, not rewrite**. Portal = standalone build; kiosk = static Vite site. Coolify gives push-to-deploy from GitHub + TLS + a UI a future maintainer can operate.
- **What changes at the platform level:** Vercel crons → Coolify scheduled tasks hitting the same `CRON_SECRET` endpoints (**the reaper can finally run `*/15` — kills the Hobby daily-cap constraint and the Vercel-Pro deferral**); `@vercel/analytics` removed; env vars move to Coolify; staging = the `staging` branch deployed on the same box behind basic auth (replaces Vercel preview protection); Next `after()` and image optimization work on Node self-hosting (*verify at build*).
- **Custom domain (new requirement):** e.g. `app.<domain>` (portal), `kiosk.<domain>`, `staging.<domain>`, `relay.<domain>` (RustDesk), `livekit.<domain>`/`turn.<domain>`; **the apex + `www` stay reserved for the marketing landing page** (~1 month out; hosted anywhere — independent of the app). Registrar = **Cloudflare at-cost: .com $10.46/yr** ([price tracker](https://cfdomainpricing.com/), fetched 2026-07-02; supersedes the earlier $10–15 estimate). Cutover updates: Twilio webhook URLs, Supabase Auth site/redirect URLs, kiosk `?t=` links (regenerate), cross-app env URLs, Sentry allowed origins.

## 8. What explicitly does NOT change

The entire Twilio voice path (webhooks, HMAC, TwiML, routing, 911 conference), Supabase schema/RLS/auth flows, presence model, audit system, kiosk call semantics, captions provider seam, CI on GitHub Actions, repo/monorepo layout, all portal features. This migration is **a re-host + one vendor swap (video) + one new feature surface (RustDesk integration)** — not a rewrite.

## 9. Cost model

Single-server (recommended start):

| Line | $/mo | Source |
|---|---|---|
| DO Basic 4c/8GB (5 TB incl.) | 48.00 | [DO pricing](https://www.digitalocean.com/pricing/droplets) |
| DO auto-backups (20%) | 9.60 | same |
| Offsite dumps (R2, 10–20 GB) | ~0.15 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Supabase Pro | 25.00 | [supabase.com/pricing](https://supabase.com/pricing) |
| Domain (~$15/yr) | ~1.25 | *estimate* |
| **Fixed total** | **~$84** | *arithmetic = estimate-class composition of source-backed unit prices* |

Plus the deliberate meters: Twilio usage (unchanged) + Speechmatics (bounded). Two-server variant (app + media split): ~$131–141/mo. At 10–25 properties the fixed cost is **$3.40–8.40 per property per month**, and every scale-with-you meter (Agora aggregate billing, Vercel per-seat, per-invocation polling pressure) is gone — which also **de-pressurizes realtime phases 2–4** (re-evaluate later purely as UX, not cost).

## 10. Tradeoffs, risks, mitigations

- **Kumar becomes the sysadmin** (patching, uptime, backups). Mitigations: Coolify's managed-feeling UX, hardening + ops runbook (Phase 1 deliverable), DO backups/snapshots/resize, boring tech everywhere, the India maintainer is a system-maintenance hire, and the irreplaceable asset (DB) stays managed. This is money-vs-time-vs-risk, accepted for control + predictable cost.
- **Single-box blast radius.** Mitigations: split-ready containers (§3), snapshot before each phase, per-phase rollback (repoint DNS/Twilio back to the still-warm Vercel deploy during transition), and the human fallbacks that already exist (standalone RustDesk, Google Meet, Kumar on-site at the pilot).
- **LiveKit ops learning curve.** Staging-first on the owned box; Agora stays live until the swap is proven; the `fix/max-call-duration-cap` branch merges in Phase 0 to cap Agora billing exposure meanwhile.
- **RustDesk vendor drift** (the web client's closed-sourcing is a warning sign). We depend only on the OSS core (AGPL client + server), pin versions, and the recorded filter (§4) is the exit checklist if the OSS core ever degrades.
- **Deskphone-tile ergonomics are unproven in the flesh** → the Phase-3 prototype gate: a 1–2 day spike builds just the tile (ring over fullscreen YouTube, ring over RustDesk, resize, feel it), judged live by Kumar + the pilot agent; failure escalates to the desktop-shell fallback *before* Phase-3 proper is built. Chromium-only → SOP standardization; degradation path exists.
- **PCI opinion is ours, not a QSA's** → professional review before scaling into chains.

## 11. Non-goals

No PMS/payment integration (the firewall is the business model). No auto-widening of the answer pool. No web-client pixel embedding. No multi-tenancy changes (v2 seam untouched). No voicemail/queue/hold-music beyond the one-click hold. No kiosk hardware changes. WhatsApp/phone coordination stays out of scope. The AHK + Zebra DS9308 scanner glue **stays a separate install** — documented as part of the hotel-PC footprint (RustDesk client + scanner glue + startup scripts), owned by LC operationally but not folded into this codebase; SynXis-specific today, per-PMS script library later.

## 12. Key sources

[Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) · [DO droplet pricing](https://www.digitalocean.com/pricing/droplets) · [Vultr plans API](https://api.vultr.com/v2/plans?type=vhp&per_page=500) · [LiveKit deployment](https://docs.livekit.io/home/self-hosting/deployment/) / [benchmark](https://docs.livekit.io/home/self-hosting/benchmark/) / [repo](https://github.com/livekit/livekit) · [Coolify pricing](https://coolify.io/pricing) / [install](https://coolify.io/docs/get-started/installation) · [RustDesk pricing](https://rustdesk.com/pricing/) · [RustDesk server repo](https://github.com/rustdesk/rustdesk-server) · [RustDesk self-host install](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/) / [docker](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/) / [client-deployment](https://rustdesk.com/docs/en/self-host/client-deployment/) / [client-configuration](https://rustdesk.com/docs/en/self-host/client-configuration/) / [MSI](https://rustdesk.com/docs/en/client/windows/msi/) · [deep-link source](https://github.com/rustdesk/rustdesk/blob/master/flutter/lib/common.dart) · [E2EE #2239](https://github.com/rustdesk/rustdesk/discussions/2239) · [web URL-params #14059 (unanswered)](https://github.com/rustdesk/rustdesk/discussions/14059) · [web-client V2 blog](https://rustdesk.com/blog/2024/10/rustdesk-web-client-v2-preview/) · [Supabase pricing](https://supabase.com/pricing) · [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [KasmVNC no-Windows](https://www.kasmweb.com/docs/latest/how_to/fixed_infrastructure.html)
