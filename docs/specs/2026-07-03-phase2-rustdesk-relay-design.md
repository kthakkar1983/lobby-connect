# Phase 2 — self-hosted RustDesk relay (design spec)

**Date:** 2026-07-03 · **Status:** server side BUILT same session (Kumar's "continue building phase 2" = the go; client cutover = scheduled human steps) · **Parents:** target architecture `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` §4 · migration plan `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 2) · kickoff handoff `docs/handoffs/2026-07-03-phase2-relay-kickoff-handoff.md`

Sourcing per CLAUDE.md discipline: facts below are **source-backed** (linked, or verified live via `doctl`/SSH/source on 2026-07-03) unless labeled *estimate*, *prior knowledge*, or *verify at build*. Note: `rustdesk.com/docs` 403s automated fetchers — doc citations were pulled from the official docs **source repo** [rustdesk/doc.rustdesk.com](https://github.com/rustdesk/doc.rustdesk.com) (same content, canonical URLs kept below); server behavior was verified directly in [rustdesk/rustdesk-server](https://github.com/rustdesk/rustdesk-server) source (master, fetched 2026-07-03).

---

## 0. Context (2026-07-03)

- Phase 1 soak is RUNNING (checkpoint ~2026-07-10); Phase 2 proceeds concurrently per the recorded decision. Prod (Vercel + Twilio + Agora) is untouched by everything here; the pilot agent's standalone-RustDesk-via-public-relay routine is untouched until the deliberately scheduled cutover.
- **Step 0 done before any box change:** snapshot `pre-phase2-relay` (19.41 GiB, completed 05:25 UTC, action `3271220349` — `doctl`-verified).
- Box preflight: healthy (disk 12%, all Coolify containers up, no `211xx` ports in use).
- `relay.lobby-connect.com` does **not** resolve yet (dig-verified); no Cloudflare API token exists on the Mac (by design — CF secret lives in Kumar's PM only) → the DNS record is a Kumar dashboard step.

## 1. Scope

**Delivers (this session, machine-side):** hbbs + hbbr live on `lc-box-1`, key-enforced (`-k _`) · DO firewall + ufw rules for 21115/tcp, 21116/tcp+udp, 21117/tcp · server keypair generated, pinned, and backed up · client-config values + per-hotel-PC provisioning script template in the repo · runbook §12 + credentials-register rows · runsheet for the human steps.

**Human steps (Kumar, in order):** DNS record → PM key backup confirm → his own client test → India-side agent test (locked consequence of the Phase-1 region record) → **pilot hotel PC repoint LAST**, at a scheduled daytime moment with the agent available.

**Non-goals:** portal **Connect** button, `property_remote_access` schema, credential brokering (all Phase 3 — the target spec §4 flow) · web client (locked REJECTED) · any pilot-PC change in this session · relay for anything but RustDesk (LiveKit/TURN = Phase 4).

## 2. Build decisions (with sources)

- **D1 — plain `docker compose` at `/opt/rustdesk/`, NOT a Coolify app.** The migration plan left "Coolify service with published ports vs compose `network_mode: host`" to build time. Host networking (D2) means Traefik/domains/PR-deploys — Coolify's value — are all irrelevant to this stack, and keeping the relay outside Coolify preserves the **disjoint failure domains** argument that justified running Phase 2 concurrent with the Phase-1 soak (a Coolify hiccup can't touch the relay and vice-versa). Trade-off (second management surface) is accepted and mitigated: compose file committed at `ops/rustdesk/compose.yaml` (repo = source of truth), ops in runbook §12, `restart: unless-stopped` + Docker's boot restart cover day-2.
- **D2 — `network_mode: host` (the official pattern).** The official compose uses it; the docs state host networking "makes hbbs/hbbr see the real incoming IP Address" ([docker guide](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/)) — required for NAT-type detection + hole-punching, i.e. for **direct P2P to be the norm and the relay the fallback**, which is the bandwidth mitigation the target spec §3 depends on. Bonus: with host networking there are no Docker DNAT rules, so **ufw stays authoritative** (published ports would bypass ufw via the DOCKER chain — *prior knowledge, well-documented Docker/ufw footgun*).
- **D3 — image pinned `rustdesk/rustdesk-server:1.1.15`** — latest release, published 2026-01-12 ([releases](https://github.com/rustdesk/rustdesk-server/releases), gh-verified 2026-07-03). Upgrade procedure in runbook §12.
- **D4 — key enforcement `-k _` on BOTH hbbs and hbbr.** Source-verified (master, 2026-07-03): the flag is `-k, --key=[KEY] 'Only allow the client with the same key'` ([main.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/main.rs), [hbbr.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/hbbr.rs)); with `_` the required key becomes the generated public key ([rendezvous_server.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/rendezvous_server.rs) `secure_tcp`/key-init block: `key == "_"` → `key = pk`), and a client presenting a different/absent key is rejected (`LICENSE_MISMATCH` punch-hole response; hbbr: "Relay authentication failed"). **Effect: key-less/unencrypted use of our infra is impossible at the server boundary** — the server-side complement of the spec-§4 "unencrypted session = incident" rule. Public relay had no such gate.
- **D5 — `-r relay.lobby-connect.com` + hostname self-resolution on the box.** `-r, --relay-servers` is what hbbs hands to clients ([main.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/main.rs)). **Gotcha (source-verified):** hbbs validates `-r` entries at startup via `test_if_valid_server` → `to_socket_addrs()` — a real DNS resolve — and silently filters failures ([common.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/common.rs) `get_servers`). Since the public record is a later Kumar step, the compose carries `extra_hosts: relay.lobby-connect.com → 159.203.124.112` (+ the same entry in the box's `/etc/hosts`) so the hostname resolves locally from first boot; clients resolve via public DNS at connect time. Verified at build by the hbbs `relay-servers=[…]` startup log line.
- **D6 — no `ALWAYS_USE_RELAY`.** Default behavior prefers direct P2P; the env forces relay ([docker guide](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/)) — the opposite of what we want.
- **D7 — keypair lifecycle.** hbbs/hbbr generate/read `id_ed25519` + `id_ed25519.pub` in their working dir = mounted `./data` ([common.rs](https://github.com/rustdesk/rustdesk-server/blob/master/src/common.rs) `gen_sk`; shared volume + `depends_on` ⇒ one keypair for both). The **public** key string is what every client pins. Losing the **private** key = re-keying every client → backup to Kumar's PM immediately (top of the never-lose list, target spec §3); interim copy on the Mac at `~/.ssh/lc_relay_id_ed25519{,.pub}` (0600). **Never in the repo.** Regenerate-by-deleting is the rotation mechanism (runbook §12).
- **D8 — container log rotation** (`json-file`, 10 MB × 3) — cheap hygiene; hbbs logs every connection attempt.

## 3. Ports + firewall

| Port | Owner | Purpose | Action |
|---|---|---|---|
| 21115/tcp | hbbs | NAT type test | **open** (DO fw + ufw) |
| 21116/tcp + udp | hbbs | ID registration, heartbeat, connection | **open** (both) |
| 21117/tcp | hbbr | relay | **open** (both) |
| 21118/tcp, 21119/tcp | hbbs/hbbr | web client | **STAY CLOSED** (locked; processes still listen under host networking — both firewalls block) |
| 21114/tcp | hbbs | Pro web console | not opened (OSS unused) |

Port purposes: [docker guide](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/). Two-layer firewall = the Phase-1 defense-in-depth pattern (DO fw `lc-box-fw` + ufw mirrored).

## 4. DNS

`relay.lobby-connect.com` A → `159.203.124.112`, **DNS-only/grey-cloud** (locked: Cloudflare's proxy cannot carry raw TCP/UDP relay traffic). Kumar dashboard step; exact values in the plan runsheet. Until it lands, nothing client-side can be tested — it's the first human step on purpose.

## 5. Client configuration (the values everything downstream uses)

| Field | Value |
|---|---|
| ID server | `relay.lobby-connect.com` |
| Relay server | `relay.lobby-connect.com` (or blank — hbbs hands it out per D5; explicit beats implicit on hotel PCs) |
| API server | *(blank — Pro-only)* |
| Key | contents of `id_ed25519.pub` — **kept OUT of this public repo** (under `-k _` the public key doubles as the relay's *access token*: hotel-PC sessions stay behind per-PC passwords, but anyone holding the key could freeload relay bandwidth). Sources: the box, Mac `~/.ssh/lc_relay_id_ed25519.pub`, PM; fingerprint `oH2Lzh…3GY=` in runbook §12 |

Per the [client-configuration guide](https://rustdesk.com/docs/en/self-host/client-configuration/): ID server + Key are the required fields for OSS; manual entry lives at Settings → Network (elevated). Mass-deploy uses the **exported config string** (Settings → Network → Export Server Config on a configured client) fed to `rustdesk.exe --config <string>` — the string is produced by Kumar's client at his test step and then pasted into the provisioning script (placeholder until then; the script also carries the manual-field fallback).

## 6. Provisioning script (Phase-3 onboarding tool, template now)

`ops/rustdesk/provision-hotel-pc.ps1`, following the official [client-deployment flow](https://rustdesk.com/docs/en/self-host/client-deployment/): `--silent-install` → wait → `--install-service` → wait → `--get-id` + `--config <string>` + `--password <unattended-pw>` (paths/service/20-second waits per that doc). Per-PC unattended password: generated at provision time, recorded in PM (v1); the `property_remote_access` schema + brokered just-in-time reads arrive in Phase 3 (target spec §4) — the script is deliberately schema-free so Phase 3 only changes where the password is *stored*, not how PCs are provisioned.

## 7. Cutover sequencing + rollback (restated, load-bearing)

Order: **snapshot ✓ → deploy ✓ → Kumar's own client → India-side agent (the path that matters, ~95% India workforce) → pilot hotel PC LAST** at a scheduled daytime moment with the agent available (no forced date). The cutover changes only the app's server config, not her workflow; standalone-RustDesk-via-public-relay remains the documented fallback forever. **Rollback = one config swap back to the public relay** (both directions are a single Network-settings change). During her test: verify the session shows **direct connection** when network conditions allow, relay fallback otherwise, and that the **encryption indicator is green/closed — an unencrypted session = incident** (target spec §4; `-k _` makes this structurally unlikely on our server).

## 8. Done-when

- **Session (machine side):** hbbs/hbbr up with our key enforced · ports reachable from outside (TCP-verified; UDP verified to the box by packet capture, end-to-end at first client registration) · keypair backed up off-box · artifacts + docs + runsheet committed.
- **Phase 2 (the real gate, unchanged):** the pilot agent works a real night through our relay.

## 9. Recorded risks

1. **Private-key loss before PM backup** — mitigated same-session (Mac copy + PM instruction first in the runsheet).
2. **hbbr/hbbs key race on very first start** — hbbr waits 300 ms then generates; hbbs then reads the same file (shared `./data`, `depends_on` ordering). Worst case is detectable in logs (`Key:` lines differ) and fixable by restart; verified at build that both log the same key.
3. **Soak contamination** — relay is outside Coolify (D1), ports are additive, no shared state with staging apps; snapshot covers the catastrophic case.
4. **Hotel-network NAT hostility** (symmetric NAT → relay-only) — acceptable: that's exactly what hbbr is for; the India-agent test measures the felt latency of that worst case.
5. **`latest`-drift** — avoided by the 1.1.15 pin (D3).
