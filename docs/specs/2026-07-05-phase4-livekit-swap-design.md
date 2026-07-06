# Phase 4 — video swap: Agora → self-hosted LiveKit (design spec)

**Date:** 2026-07-05 · **Status:** design approved in dialogue (Kumar, 2026-07-05: sequencing + full design "looks good"); this written spec awaits his gate · **Parents:** target architecture `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` §6 · migration plan `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 4) · handoff `docs/handoffs/2026-07-05-phase3C-done-staging-notes-phase4-next-handoff.md` · **Branch:** `phase3-workspace` (Phase 4 stacks on the unmerged Phase C; PR #29 grows — see D14).

## 0. Why now, and why before Phase 3 D/E

Staging is blind: Agora does not function on the box (`AGORA_APP_CERTIFICATE` deliberately not added — Kumar declined, 2026-07-05), so no video call can complete on staging and the Phase-C smoke items (push → answer → connect) are stuck half-verified. Kumar will not touch prod until the stack is testable end-to-end. LiveKit on our own box makes staging fully testable and removes the metered-billing provider whose trust was already broken (the 7m39s call billed as 71 minutes — target spec §2). Phase 3 D (call tile) is guest-video-first, so it builds ON LiveKit rather than being built twice. Phase 4 therefore jumps the queue; Phase 3 D/E resume after it. Confirmed by Kumar 2026-07-05: "if doing phase 4 will not mess up phase D in any way, then yes" — it does not (D is unbuilt; the tile consumes a `MediaStreamTrack`, which LiveKit exposes the same way).

**Sourcing note.** Every LiveKit/Coolify fact below was verified 2026-07-05 against primary sources (docs pages, `config-sample.yaml`, SDK source, npm registry, GitHub releases API); §10 carries the citations. Both SDKs were also exercised empirically on Node 24 (import safety, async `toJwt()`, JWT minting). Items marked *estimate* or *inference* are labeled inline.

## 1. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **LiveKit OSS `livekit/livekit-server:v1.13.3`** (released 2026-07-03), pinned | Current stable at design time (GitHub releases API). Jitsi remains the named plan B (target spec §6 rationale unchanged) |
| D2 | **Plain docker compose at `/opt/livekit/` with `network_mode: host` — deliberately NOT Coolify-managed** | LiveKit docs: "If running in a Dockerized environment, host networking should be used for optimal performance." Same disjoint-failure-domain logic as the RustDesk relay (`/opt/rustdesk/`): media infrastructure must not share fate with the app-deploy plane. Bridge mode would require publishing every media port AND fixing advertised ICE candidate IPs — the documented recommendation avoids all of it |
| D3 | **UDP media on a 4-port mux `rtc.udp_port: 7882-7885`**, not the 50000-60000 range | config-sample: when muxing, "we recommend using a range of ports greater or equal to the number of vCPUs on the machine" — box has 4 vCPUs. Tiny ufw/DO-firewall surface; at 5-10 concurrent 1:1 calls both options are far from any limit (*inference from the two-ports-per-participant doc line*) |
| D4 | **No TURN at launch** — `turn.enabled` stays at its default `false`; ICE/TCP 7881 is the restrictive-network fallback | Docs position TURN for networks that block "not only UDP traffic, but non-secure TCP traffic, as well." The SFU has a public IP; UDP-blocked clients fall back to 7881/tcp. This dissolves the target spec's 443-vs-5349 wrinkle entirely. The enable-later seam (config keys incl. `tls_port`, `domain`, `LIVEKIT_TURN_CERT/KEY`) is recorded in §2.5; revisit only on evidence of a client that cannot connect |
| D5 | **No Redis** | Redis is what switches LiveKit into distributed multi-node mode; single node needs none. Add only if we ever split to a media box |
| D6 | **One LiveKit instance serves staging AND prod, with two API keypairs** (`keys:` map is natively multi-key): `lc_prod` + `lc_staging` | Independent revocation, zero extra footprint. Honesty note: keypairs do NOT namespace rooms — any valid token can name any room. Acceptable: room names are `call_<uuid32>` (unguessable) and tokens are minted only for live-call rows by an authed route (§3). A second instance later is trivial (split-ready rule, target spec §3) |
| D7 | **TLS: Coolify's Traefik terminates wss for the signal port only** via a file-based dynamic config (`livekit.lobby-connect.com` → `http://<box>:7880`); media ports go direct | LiveKit docs: 7880 "should be placed behind a load balancer that can terminate SSL", while 7881 "*cannot* be behind load balancer or TLS, and must be exposed on the node"; "WebRTC transports are encrypted and do not require additional encryption." Coolify v4 has a first-class Dynamic Configurations UI for exactly this |
| D8 | **`VIDEO_PROVIDER=agora\|livekit` env on the PORTAL only; the server tells every client, per call, which provider to use** via the new `GET /api/video/token` (discriminated response). Old `/api/agora/token` retained until the Agora strip | One source of truth — kiosk and agent can never disagree mid-call. Unset defaults to `agora` → merging to `main` is prod-inert; the prod cutover is an env flip, rollback is flipping it back. Stale kiosk builds (tablet SPA) keep working against the old route during transition |
| D9 | **LiveKit identities: kiosk branch → `kiosk`, session branch → `agent-<userId>`** | Meaningful in logs, and LiveKit's duplicate-identity rule ("another client with the same identity has joined" disconnects the first) gives ghost-replacement on reconnect for free — a reloaded tab replaces its zombie instead of colliding with it |
| D10 | **Token TTL 3600s (parity with Agora today); the app-level 30-min cap (Phase 0) stays the authoritative duration bound** | Verified: "Expiration time only impacts the initial connection, and not subsequent reconnects" — expiry cannot drop a live call, and LiveKit has NO server-side max-room-duration setting (config-sample + protocol checked). Room cleanup is automatic (`empty_timeout` 300s / `departure_timeout` 20s defaults) |
| D11 | **`calls.agora_channel_name` keeps its name and simply carries the LiveKit room name** (same generated `call_<uuid>` value) | Zero DB migration in Phase 4. A cosmetic rename to `video_room_name` may ride the eventual Agora-strip cleanup, or never — it is not load-bearing |
| D12 | **The TEMP guest-audio diagnostics are NOT ported to the LiveKit path** | They stay on the Agora path and die at the strip. The 2026-06-30 investigation closed environmental (device hijack), not code |
| D13 | **Client seam = one normalized track handle + today's callback interface** | The only Agora-typed thing screens touch is `track.play(el)`; a `{ attach(el), detach() }` handle normalizes it (LiveKit `Track.attach(element)` verified). Kiosk keeps `joinChannel`'s exact callback shape with a `livekit.ts` sibling; portal branches inside `video-call.tsx` after the token fetch. All call-state, finalization, notes, captions, cap logic untouched |
| D14 | **Rollout: staging flips to LiveKit immediately; merge to `main` is prod-inert (flag=agora); prod flip is a separately-timed env-only change; Agora path retained until LiveKit survives ≥1 week of real nights; then strip** | Kumar-approved sequencing (2026-07-05). Build continues on `phase3-workspace`; PR #29 grows into "Phase 3C + Phase 4" (retitle at merge). Migration 0019 applies to prod at merge (the 0018 lesson) — it rides the same PR |
| D15 | **Boot validation checks only the ACTIVE provider's env** | `instrumentation.ts` currently always validates Agora creds — on staging (no cert, by decision) that's a permanent boot warning. Gate the check on `VIDEO_PROVIDER` |

## 2. Server deployment (the box)

### 2.1 Artifacts (committed)
- `ops/livekit/compose.yaml` — service `livekit`, image pinned `livekit/livekit-server:v1.13.3`, `network_mode: host`, `restart: unless-stopped`, mounts `./livekit.yaml:/etc/livekit.yaml`, command `--config /etc/livekit.yaml`.
- `ops/livekit/livekit.yaml.example` — committed WITHOUT secrets (real file lives only on the box + PM):

```yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882-7885     # single-port UDP mux; >= vCPU count per config-sample guidance
  use_external_ip: false   # host networking on a droplet: public IP is bound directly
keys:
  lc_prod: <secret>        # generated at build, stored in PM + credentials register
  lc_staging: <secret>
logging:
  level: info
```

(TURN block deliberately absent — D4. Room defaults left stock — D10.)

### 2.2 Ports and firewall (ufw + DO cloud firewall, both)
| Port | Proto | Exposure | Purpose |
|---|---|---|---|
| 7880 | tcp | **blocked externally**; reached only by Coolify's Traefik on-box | signal WS / health |
| 7881 | tcp | open | ICE/TCP fallback (must not sit behind a proxy) |
| 7882-7885 | udp | open | media (UDP mux) |

No conflicts expected with the existing map (80/443 Traefik, 8000 Coolify, 21115-21117 RustDesk, 22 SSH-restricted) — **verify with `ss -tlnp`/`ss -ulnp` at build** (the design-session SSH attempt timed out off-network; check runs from Kumar's network).

### 2.3 TLS / DNS
- Cloudflare: `livekit.lobby-connect.com` A → `159.203.124.112`, **grey cloud** (infra-host rule).
- Coolify → Servers → Proxy → **Dynamic Configurations** → add `livekit.yaml`:

```yaml
http:
  routers:
    livekit:
      rule: Host(`livekit.lobby-connect.com`)
      entryPoints: [https]
      service: livekit
      tls:
        certResolver: letsencrypt
  services:
    livekit:
      loadBalancer:
        servers:
          - url: "http://159.203.124.112:7880"
```

(Exact resolver name confirmed against the box's existing dynamic configs at build; WebSocket needs no extra Traefik config. Traefik runs in a container, so the loadBalancer URL targets the box IP it can reach — the documented community pattern for non-Coolify services.)

### 2.4 Health + ops
- Health probe: `GET /` on 7880 → 200 `OK` (406 `Not Ready` when unhealthy) — the same endpoint LiveKit's own helm chart probes. Runbook gains §13 (compose location, health curl via `curl -s http://127.0.0.1:7880/` on-box, log access, key rotation, update procedure, TURN-enable seam).
- Credentials register gains the two keypairs (secrets in PM; `lc_staging` also lands in Coolify staging env, `lc_prod` in Vercel prod env).
- Snapshot the droplet before install (`pre-phase4-livekit`), per the phase-boundary habit.

### 2.5 TURN enable-later seam (recorded, not built)
`turn: { enabled: true, domain: turn.lobby-connect.com, tls_port: 5349 (or 443 on a second reserved IP), udp_port: 3478 }` + cert via `LIVEKIT_TURN_CERT/KEY` env or `cert_file/key_file`, `external_tls: true` if a TCP LB ever terminates for it. Trigger to revisit: a real client that cannot connect via UDP or 7881/tcp.

## 3. Token route + provider flag (portal)

### 3.1 Route
`GET /api/video/token?channel=<name>&uid=<n>` — a sibling of today's `/api/agora/token` with the **auth and gate logic identical** (extracted/shared, not duplicated): resolve the `calls` row by `agora_channel_name`, require an ACTIVE call state, then dual-auth — `x-kiosk-token` branch (verify + property match) OR session branch (`requireApiActor({allow:["AGENT","ADMIN"]})` + operator match; OWNER rejected). Only the minting tail branches:

- `VIDEO_PROVIDER=livekit` → `livekit-server-sdk` (v2.16.0) `AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: 3600 })` + `addGrant({ roomJoin: true, room: channel, canPublish: true, canSubscribe: true })` + `await at.toJwt()` (async in v2 — jose). Identity per D9. Response `{ provider: "livekit", url: LIVEKIT_URL, channelName, token }`.
- `VIDEO_PROVIDER=agora` or unset → today's Agora mint, response `{ provider: "agora", appId, channelName, uid, token }`.

`runtime = "nodejs"` (server SDK engines >=18; verified minting on Node 24).

### 3.2 DTO (`@lc/shared`)
```ts
export type VideoTokenResult =
  | ({ provider: "agora" } & AgoraTokenResult)
  | { provider: "livekit"; url: string; channelName: string; token: string };
```
Kiosk consumes it through its existing types module pattern.

### 3.3 Config plumbing
- `next.config.ts`: add `{ source: "/api/video/:path*", headers: KIOSK_CORS }` (kiosk is a different origin — without this the swap dies at first fetch).
- Staging Traefik basic-auth carve-outs: add `/api/video/*` alongside `/api/kiosk/*`, `/api/agora/*`, `/api/cron/*` (Coolify label edit; labels are verbatim — no `$$` doubling).
- Env (portal): `VIDEO_PROVIDER`, `LIVEKIT_URL=wss://livekit.lobby-connect.com`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (+ `.env.example`). Staging Coolify: `VIDEO_PROVIDER=livekit` + `lc_staging` pair. Vercel prod: LiveKit vars present but `VIDEO_PROVIDER=agora` until the flip (D14).
- `instrumentation.ts` boot check: validate the active provider's env only (D15); Agora validation remains while the flag is `agora`.

## 4. Client swap surface

### 4.1 Kiosk (`apps/kiosk`)
- `src/lib/portal-api.ts`: `fetchVideoToken(channel, uid)` → `/api/video/token` (replaces the `fetchAgoraToken` call site; the old function goes away with the new build — the retained OLD ROUTE serves stale builds, not new code).
- `src/lib/video/agora.ts` (moved from `src/lib/agora.ts`, unchanged incl. TEMP diagnostics) + `src/lib/video/livekit.ts` — **same exported interface** as `joinChannel` today: `{ onRemoteVideo(handle|null), onAgentJoined, onAgentLeft, onConnectionStateChange(cur, prev, reason?) }`, returning `{ leave(), mute controls as today }`. `App.tsx` branches once on `tok.provider`; everything else (call machine, ring timeout, max-duration, teardown generation token) untouched.
- LiveKit implementation mapping (all APIs verified, §10):
  - Join: `new Room()` + `room.connect(url, token)`; SDK dynamic-imported (import-safe in Node empirically, but the existing lazy pattern stays).
  - Publish mic-FIRST then camera (preserving the cold-camera fix): `createLocalAudioTrack()` → `localParticipant.publishTrack(audio)` → `createLocalVideoTrack()` → publish. Independent acquisition is structural (each helper runs its own getUserMedia).
  - Remote: `RoomEvent.TrackSubscribed` fires per track; video → wrap in the normalized handle for `onRemoteVideo` + fire `onAgentJoined` on first video (today's semantics); audio → `track.attach()` and keep the element for autoplay recovery.
  - Autoplay: `RoomEvent.AudioPlaybackStatusChanged` + `!room.canPlaybackAudio` → existing `recoverAudioOnNextGesture(() => room.startAudio())`.
  - Agent left: `RoomEvent.ParticipantDisconnected` → `onAgentLeft`. Connection: `Reconnecting`/`Reconnected`/`Disconnected` mapped into the existing `interpretConnectionState` vocabulary (mapping table TDD'd).
- Screens: `Connected.tsx` swaps `remoteVideo.play(el)` for `handle.attach(el)` (the normalized handle's Agora impl wraps `.play(el)`, LiveKit impl wraps `Track.attach(el)` — which sets `playsInline`/autoplay itself, incl. the Safari quirk, per SDK source). Local self-view identical treatment.

### 4.2 Portal (`apps/portal/components/video-call/video-call.tsx`)
- After `answer-video` returns `channelName`: fetch `/api/video/token`, branch on `provider`. Agora branch = today's code verbatim (diagnostics and all). LiveKit branch mirrors the kiosk mapping plus:
  - Busy-webcam audio-only fallback: same try/catch shape — the raw `NotReadableError` DOMException propagates unwrapped from `createLocalVideoTrack()` (SDK source verified); optional classification via `MediaDeviceFailure.getFailure()`.
  - Captions tap: `remoteAudioTrack.mediaStreamTrack` (a getter on the Track base class — the same W3C `MediaStreamTrack` object family Agora's `getMediaStreamTrack()` returns). `lib/captions/*` unchanged.
  - Mute: `LocalAudioTrack.mute()/unmute()` (1:1 with today's `setMuted`). Camera toggle: keep the current raw-track `.enabled` shape via `mediaStreamTrack`.
  - `user-left` → `ParticipantDisconnected` → `handleEnd()`; 30-min cap timer, `finalizingRef`, notes durability — all byte-identical.
- `video-call-host.tsx`, cards, push, provider publishes: untouched (they operate above the media layer).

### 4.3 Dependencies
`livekit-client@2.20.0` (Apache-2.0) in both apps; `livekit-server-sdk@2.16.0` in the portal. Both lazy-loaded on the client so page-load cost is nil; Agora SDKs remain until the strip.

## 5. What does NOT change
Call rows/states/routes (`call-started`, `answer-video`, `end-video`, `call-ended`), multi-owner finalization + reaper, 0016 one-active index, Phase-C push + duty controls, presence, 911 (audio-only machinery), playbook, notes durability, kiosk call machine + screens' structure, captions architecture, dashboards. No migrations. No RLS. `agora_channel_name` semantic only (D11).

## 6. Testing

- **Unit (house pattern — mock at the seam):** kiosk `livekit.ts` callback contract (join/publish order incl. mic-first; TrackSubscribed → onRemoteVideo + onAgentJoined-once; ParticipantDisconnected → onAgentLeft; connection-state mapping table); portal LiveKit branch (busy-cam fallback publishes audio-only; captions receive the mediaStreamTrack; mute wiring; user-left finalize); token route (provider branches, kiosk vs session auth, OWNER reject, inactive-call 404, exact payloads); DTO type tests; boot-validation gating. Full gate: typecheck, portal node+jsdom, kiosk, lint, check:routes, build (`gen:types:check` trivially — no migrations).
- **Staging smoke (HUMAN, the decisive gate):** kiosk tap → card ring + OS push (minimized) → Answer → **video connects through box LiveKit** (guest video + two-way audio) → captions live on the guest's speech → hang-up finalizes row + clears push. Plus: busy-webcam fallback (hold the camera in another app), kiosk reconnect (reload mid-call → ghost replaced, D9), a full 30-min-cap let-run (optional, once). This is also the first full Phase-C e2e — the "flying blind" exit.
- **Prod (post-merge, flag still agora):** unchanged-behavior smoke (one audio + one video call). **Post-flip:** same video smoke on prod LiveKit, then the 1-week real-nights soak (done-when: quality ≥ Agora, $0 marginal video cost).

## 7. Rollout / rollback (Kumar-approved sequence)
1. Build on `phase3-workspace` (PR #29 grows; retitle at merge).
2. Box: LiveKit up (snapshot first) + DNS + Traefik dynamic config + firewall.
3. Staging Coolify env → `VIDEO_PROVIDER=livekit` → redeploy → staging smoke (§6). Staging is now end-to-end testable.
4. Merge gate (Kumar): apply 0019 to prod via MCP FIRST, merge PR, prod re-smoke on Agora (behavior unchanged — flag=agora).
5. Prod flip (Kumar's timing): Vercel `VIDEO_PROVIDER=livekit` + redeploy. Rollback = flip back (env-only, no code).
6. ≥1 week of real nights on LiveKit → strip Agora (SDKs, `/api/agora/token`, `lib/agora/`, env vars, TEMP diagnostics; optional `agora_channel_name` rename) + drop the Agora account. Phase 4 DONE → resume Phase 3 D (tile on LiveKit) + E.

## 8. Human tasks (Kumar) — in order, with gates
1. **Now / at build start:** none — code build starts immediately.
2. **Box session (needs your network — SSH is IP-restricted; my attempt from this session timed out):** either you're present so I drive SSH, or you paste the command block I hand you. Contents: DO snapshot, `/opt/livekit/` files, ufw adds (7881/tcp, 7882-7885/udp), container up, health curl, port-conflict check. ~10 min.
3. **DO cloud firewall:** I handle via `doctl` (token authorized through migration end).
4. **Cloudflare (2 min):** DNS → A `livekit` → `159.203.124.112`, **grey cloud**, TTL auto.
5. **Coolify (5 min):** (a) Servers → Proxy → Dynamic Configurations → Add `livekit.yaml` (exact YAML from me, §2.3); (b) `lc-portal-staging` env: `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY=lc_staging`, `LIVEKIT_API_SECRET=<from me>`; (c) the `/api/video/*` carve-out label edit (exact string from me); (d) redeploy.
6. **Password manager:** store both LiveKit keypairs (values from me at build).
7. **Staging smoke:** run §6 with me (tablet or laptop kiosk + your agent login; browser minimized behind RustDesk for the push leg).
8. **Merge moment (your call, after staging passes):** I apply 0019 to prod; you merge PR #29; quick prod smoke on Agora (one audio + one video call — nothing should feel different).
9. **Vercel prod env:** I add the LiveKit vars + `VIDEO_PROVIDER=agora` via CLI at merge time (inert), or you via dashboard — say which.
10. **Flip day (your timing):** `VIDEO_PROVIDER=livekit` on Vercel + redeploy; we smoke one video call together; then the week-long soak on real nights.
11. **After the soak:** give the word → I strip Agora and stamp Phase 4 done.

## 9. Build order sketch (for the plan)
A) Server-side box bring-up (can run parallel to code; human steps §8.2-8.5) → B) DTO + token route + flag + boot-validation + CORS (TDD) → C) kiosk provider seam + `livekit.ts` (TDD) → D) portal `video-call.tsx` LiveKit branch (TDD; Agora branch byte-preserved — review requirement) → E) staging deploy + carve-out + smoke → F) merge/flip/soak/strip per §7. Subagent-driven with two-stage reviews per house discipline; the Agora-path byte-preservation and the 911-adjacent untouched surfaces get the byte-review treatment.

## 10. Sources (fetched 2026-07-05)
- Version: GitHub releases API (`livekit/livekit` latest = v1.13.3, published 2026-07-03); Docker Hub tags API.
- Server config/ports/TURN/keys/rooms: `github.com/livekit/livekit/blob/master/config-sample.yaml` (raw) — `port: 7880`; `tcp_port: 7881` ("this port *cannot* be behind load balancer or TLS"); `udp_port` mux comment ("recommend using a range of ports greater or equal to the number of vCPUs"); `port_range_start/end: 50000-60000`; `turn.enabled` "defaults to false" + `udp_port 3478`/`tls_port 5349`/`domain`/cert options/`external_tls`; multi-entry `keys:` map; `room.empty_timeout 300`/`departure_timeout 20` (defaults confirmed in `pkg/config/config.go`); `use_external_ip` semantics; prometheus `prometheus.port` (old key deprecated).
- Deployment/VM/ports docs: `docs.livekit.io/home/self-hosting/deployment/` ("host networking should be used for optimal performance"; TURN for firewalls blocking "non-secure TCP traffic, as well"; SSL termination by LB/reverse proxy); `/home/self-hosting/vm/` (generator uses Compose+Caddy; firewall list); `/home/self-hosting/ports-firewall/`; `/home/self-hosting/distributed/` ("In distributed mode, Redis is required"); `/home/self-hosting/benchmark/` (16-core c2-standard-16, 150x150 @ 85% CPU).
- Token semantics: `docs.livekit.io/frontends/reference/tokens-grants/` ("Expiration time only impacts the initial connection, and not subsequent reconnects"; server-issued refresh tokens; short-TTL advice for self-hosted).
- Health: `pkg/service/server.go` (`/` → `OK`/`Not Ready`); livekit-helm deployment.yaml probes.
- Client SDK (`livekit-client@2.20.0`, Apache-2.0, npm registry): `Room.connect(url, token)` (src/room/Room.ts:811); `createLocalAudioTrack`/`createLocalVideoTrack` independent getUserMedia (src/room/track/create.ts); `publishTrack(track)` (LocalParticipant.ts:771); `MediaDeviceFailure` + unwrapped `NotReadableError` (errors.ts + create.ts); `RoomEvent` string values incl. `TrackSubscribed` ("will always fire"), `ParticipantDisconnected`, `AudioPlaybackStatusChanged`; `Track.attach()/attach(el)/detach()` + `attachToElement` setting `playsInline`/autoplay (Track.ts); `mediaStreamTrack` getter inherited by `RemoteAudioTrack` (Track.ts:114 + RemoteAudioTrack.ts:10); `startAudio`/`canPlaybackAudio` (Room.ts); duplicate identity `DUPLICATE_IDENTITY` (events.ts + `docs.livekit.io/home/client/connect/`); browser-support table (README). Empirical: import-safe in plain Node 24; `new Room()` constructs.
- Server SDK (`livekit-server-sdk@2.16.0`, npm registry): `AccessToken` + `addGrant` + **async** `toJwt()` (jose; node-sdks AccessToken.ts:197 + README); `AccessTokenOptions.ttl` seconds|string, default `6h`; engines `>=18`. Empirical: HS256 JWT minted on Node 24.
- Coolify: `coolify.io/docs/knowledge-base/proxy/traefik/dynamic-config` (Servers → Proxy → Dynamic Configurations); community example proxying a non-Coolify host-port service (BlueMap docs) — the §2.3 YAML shape.
