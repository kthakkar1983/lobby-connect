# Phase 2 — self-hosted RustDesk relay (implementation plan)

**Date:** 2026-07-03 · **Spec:** `docs/specs/2026-07-03-phase2-rustdesk-relay-design.md` · **Parents:** migration plan Phase 2 · handoff `docs/handoffs/2026-07-03-phase2-relay-kickoff-handoff.md`

Machine tasks (T1–T6) run in this session; human tasks (H1–H5) are Kumar's runsheet, in order. Rollback for everything machine-side: `docker compose down` in `/opt/rustdesk` + remove the 4 firewall rules (or restore snapshot `pre-phase2-relay`). Client-side rollback: one Network-settings swap back to the public relay.

## Machine tasks

- [ ] **T1 — Step 0 snapshot** (phase-boundary rule). `doctl compute droplet-action snapshot 581936683 --snapshot-name pre-phase2-relay --wait`. Verify: snapshot listed with a size. **DONE 05:25 UTC (19.41 GiB).**
- [ ] **T2 — Repo artifacts.** `ops/rustdesk/compose.yaml` (pinned 1.1.15, host networking, `-k _`, `-r relay.lobby-connect.com`, `extra_hosts`, log rotation, `./data` volume) + `ops/rustdesk/provision-hotel-pc.ps1` (official silent-install flow, config-string placeholder). Verify: files lint clean by eye; compose validated on the box in T3.
- [ ] **T3 — Deploy on lc-box-1.** `mkdir -p /opt/rustdesk/data` · copy compose · add `relay.lobby-connect.com` to the box's `/etc/hosts` (D5) · `docker compose up -d`. Verify: both containers `Up`; hbbs log shows `relay-servers=["relay.lobby-connect.com"]` (D5 gotcha check) and a `Key: <pub>` line; hbbr logs the **same** key (spec risk 2); `ss -tulpn` shows 21115/tcp, 21116/tcp+udp, 21117/tcp listening.
- [ ] **T4 — Firewalls.** ufw: `allow 21115/tcp, 21116/tcp, 21116/udp, 21117/tcp`. DO fw `lc-box-fw` (`b25a8033-2af7-47ec-9ba4-761bb0400c7a`): add the same four inbound rules, all-sources. Verify from the Mac: `nc -vz` succeeds on 21115/21116/21117 tcp, **times out on 21118/21119** (stay-closed check); UDP 21116 packet from the Mac visible in `tcpdump` on the box.
- [ ] **T5 — Key discipline.** Copy `id_ed25519{,.pub}` off-box to `~/.ssh/lc_relay_id_ed25519{,.pub}` (0600) on the Mac; capture the public-key string for §5 configs + runbook §12; PM instructions into the runsheet + credentials register. Never in the repo.
- [ ] **T6 — Docs + commit.** Runbook §12 (relay ops: manage/upgrade/rotate/incident), §11 stub updated · credentials register: keypair row + PM checklist item · migration plan Phase-2 STATUS block · next-session handoff (supersedes 2026-07-03 kickoff) · MEMORY.md + `memory/project-status.md` · commit to `main`.

## Human runsheet (Kumar, in order — each step gates the next)

- [ ] **H1 — DNS record** (2 min): Cloudflare dashboard → zone `lobby-connect.com` → DNS → Add record: **A · name `relay` · IPv4 `159.203.124.112` · Proxy status: DNS only (grey cloud)**. Verify: `dig +short relay.lobby-connect.com` → `159.203.124.112`.
- [ ] **H2 — PM backup of the relay keypair** (5 min, do NOT defer): PM secure note "LC relay server keypair (id_ed25519)" ← contents of `~/.ssh/lc_relay_id_ed25519` (private) + `.pub` (public), per credentials register §2. This is the top of the never-lose list — losing it re-keys every client.
- [ ] **H3 — Kumar's own client test:** on your RustDesk client: Settings → Network → unlock → ID server `relay.lobby-connect.com` · Key = `cat ~/.ssh/lc_relay_id_ed25519.pub` (full string deliberately not in this public repo — runbook §12) · Relay server `relay.lobby-connect.com`. Confirm your client shows **Ready** (green, "Ready"). Connect to any test PC configured the same way; hover the connection/lock icon in-session: confirm **encrypted + direct P2P** where expected (same-LAN test will punch direct; the relay-path test is forcing it via a remote target). Then **Settings → Network → Export Server Config** → PM entry "RustDesk exported server config" — pasted into a **local** copy of `ops/rustdesk/provision-hotel-pc.ps1` at each provision (the repo keeps the placeholder; the string encodes the key).
- [ ] **H4 — India-side agent test** (locked consequence of the Phase-1 region record): coordinate who; she points her client at our server (same three fields), connects to a US-side test PC (NOT the pilot hotel PC), and reports felt latency vs the public relay + whether the session says direct or relay. Green = proceed.
- [ ] **H5 — Pilot hotel PC cutover, LAST** (scheduled daytime moment, agent available, no forced date): change the hotel PC's RustDesk Network settings to ours (same three fields) — or run the provisioning script if reinstalling. The agent's workflow does not change; her app now rides our relay. Verify together: she connects, encryption indicator green, session usable. **Rollback = swap the Network fields back to the public relay (both sides keep this documented forever).**
- [ ] **Phase-2 done-when:** the pilot agent works a real night through our relay → stamp the migration plan + tag.

## Explicitly deferred to Phase 3

Portal **Connect** button + `rustdesk://` deep link · `property_remote_access` schema + brokered credentials · per-property provisioning at fleet scale (the script template becomes the tool then).
