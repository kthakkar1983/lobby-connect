# Handoff — Phase-5 cutover PREP COMPLETE; next chat EXECUTES it — START HERE

**Written:** 2026-07-08. **Supersedes:** `2026-07-08-phase5-cutover-prep-handoff.md`. **`main` = PR #41 merged** (runsheet + operator playbook + step-7 wiring). Everything for the cutover is now written and reviewed; **the next session's job is to *execute* it — no more building.**

## The one-line state

The whole stack-consolidation migration is built and merged. The **only** remaining work is the **Phase-5 blue-green cutover** — moving the pilot from the frozen Vercel/Agora standby onto the owned box (Coolify + self-hosted LiveKit). All prep artifacts exist. Kumar drives the consoles; Claude assists + can apply the prod migrations via MCP.

## The two documents that run the cutover (READ THESE FIRST)

1. **`docs/setup/2026-07-08-phase5-cutover-operator-playbook.md`** — the **do-this, click-by-click checklist.** Start here to execute. Part 0 → Part 11, in order.
2. **`docs/setup/2026-07-08-phase5-cutover-runsheet.md`** — the **why/reference** (pointer sets, invariants, night-1 smoke §6, risks). The playbook links back to it.

Master plan Phase 5 (steps 5–10): `docs/plans/2026-07-01-stack-consolidation-migration.md` (step 7 now points at the runsheet).

## Decisions locked this session (2026-07-08, Kumar)

- **Pointer model = STRAIGHT-TO-BOX.** `app.`/`kiosk.` DNS is created → box during *stand-up* (DNS+TLS proven days early), so **DNS is NOT a go-live pointer.** Go-live flips only **(a) Twilio webhooks, (b) the tablet's kiosk bookmark, (c) Supabase auth URLs** (the last is a near-no-op — cookies are per-app-origin, email flows dormant). Rollback = the same three back to Vercel.
- **Night-1 IS the live test.** Both passed extensive non-shift testing; only a real prod shift proves them, so the cutover night simultaneously satisfies the Phase-2 relay real-night gate + the video-quality gate, with the frozen Vercel standby as instant rollback if either fails. Includes a **live 933 emergency test** on the box.
- **Portal hostname = `app.lobby-connect.com`** (confirmed over `portal.` — SaaS convention, role-agnostic, clean split from the marketing apex). Kiosk = `kiosk.lobby-connect.com`.

## Next action (new chat)

Open the **operator playbook** and start **Part 0** (gather the console-only values). Then Part 1 (snapshot) → Part 2 (migrations — **Claude applies 0019+0020 to prod via the Supabase MCP on Kumar's go**) → Parts 3–9 (stand-up, zero pilot impact) → Part 10 (rollback rehearsal) → **Part 11 (GO LIVE)** → §6 night-1 smoke. Do it as a dedicated daytime block with the tablet on hand and Dilnoza lined up.

## Hard facts verified live this session (don't re-derive)

- **Prod Supabase (`ztunzdpmazwwwkxcpyfp`) is at migration `0018`** → the cutover applies exactly **`0019_push_subscriptions` + `0020_property_remote_access`**, both strictly additive (standby-safe).
- Portal LiveKit env names = **`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`**; **`VIDEO_PROVIDER` was removed with Agora** (dead env — don't set it); **no `AGORA_*` on the box** (they stay on Vercel).
- **`KIOSK_ORIGIN` is BUILD-TIME** — it bakes the `/api/kiosk/*` + `/api/video/*` CORS `Access-Control-Allow-Origin` in `next.config.ts`. Wrong at build → kiosk config + video both break; a restart won't fix it (redeploy). Must be `https://kiosk.lobby-connect.com` at build.
- **The `lc_prod` LiveKit secret is NOT on Vercel** (standby froze pre-Phase-4) — read it from `/opt/livekit/livekit.yaml` / PM.
- **Env method = mirror the working box-staging apps, prod-ify the values** (staging proves CORS+push+captions+video with this exact Dockerfile → copying its variable set + Build-Variable flags gets the build-vs-runtime split right by construction).

## The sharp risk (R1)

The box's **first-ever Twilio-through-Traefik call**: HMAC verifies over the *reconstructed* URL (`publicUrlFromRequest()` = host + x-forwarded-proto). A wrong host / **port (`:3000`)** / proto 403s **identically** to a bad `TWILIO_AUTH_TOKEN` (which must also match Vercel). Mitigation: the playbook's Part 10 rehearsal (flip Twilio box→self-test→back) + go-live is flip-then-immediately-self-test with instant revert; on a 403, inspect the reconstructed URL in logs, don't assume it's the token.

## Standby invariants (keep rollback valid — don't break these)

Additive-only migrations · shared prod DB never forks · `agora_channel_name` NOT renamed · Vercel `AGORA_*` envs + the Agora account STAY until decommission · `KIOSK_CONFIG_SECRET` byte-identical box↔Vercel · **Vercel prod stays frozen/untouched** (git-disconnected standby of record: portal `dpl_7PQ1P7Ui41UD8wrpZrV3FZ2koj6y` + kiosk `dpl_FxZhsJQVLEUn5V2M81gBwvKch5Mu`, both `main@f4af480`; reversal = `vercel git connect`).

## Carried gotchas

- **Don't judge video quality on a Mac** (software OpenH264 ≠ the iPad's hardware H.264). Night-1 on the real iPad is the quality gate.
- **Deep-link launches must NOT navigate the top window** while a WebRTC call is live (the Phase-E hidden-iframe fix).
- **White-bar tile-dock bug (open, low-confidence):** the call tile's bottom dock sometimes renders as a dead white bar when switching tabs kiosk↔dashboard — likely a staging-only softphone focus-flap (no Twilio there). Night-1 is the first prod look; check for it (runsheet §6), confirm-on-prod-before-investigating.
- **Coolify:** labels pass verbatim (single `$`); the "Readonly" labels toggle wipes hand-added labels — but **prod carries NO basic-auth anyway** (public), so this only matters for staging.

## After go-live

~2-week warm-standby window (also absorbs the former Phase-1 soak) → then decommission (runsheet §8: close Vercel+Agora, revoke `lc-claude` tokens, DO auto-backups, Supabase Pro, tags). Post-cutover / pre-second-hotel: the RustDesk credential-hardening (encrypt-at-rest + fail-closed audit) — its own brainstorm→spec→build, NOT a go-live gate.
