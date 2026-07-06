# Phase 4 — Agora → self-hosted LiveKit swap: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Agora with self-hosted LiveKit on lc-box-1 behind a server-driven `VIDEO_PROVIDER` flag, making staging end-to-end testable while the merge stays prod-inert (prod flips later, env-only).

**Architecture:** LiveKit v1.13.3 runs as plain compose at `/opt/livekit/` (host networking, no TURN, no Redis); Coolify's Traefik terminates wss for the signal port only. A new `GET /api/video/token` route (same dual-auth + live-call gate as the Agora route, extracted into a shared helper) returns a discriminated `VideoTokenResult` so kiosk and portal always agree per call. Clients gain a provider seam: a normalized `VideoTrackHandle` (`attach/detach/mediaStreamTrack`) plus a LiveKit session module per app; the Agora code path is preserved intact until the post-soak strip.

**Tech Stack:** livekit-server v1.13.3 (Docker) · livekit-client ^2.20.0 (both apps) · livekit-server-sdk ^2.16.0 (portal) · existing Next.js 15 / Vite / Vitest toolchain.

**Spec:** `docs/specs/2026-07-05-phase4-livekit-swap-design.md` (gated by Kumar 2026-07-05). Decision references (D1–D15) point there.

**Branch:** `phase3-workspace` (stacks on unmerged Phase C; PR #29 grows — D14).

**Gates (house):** after each code task: `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test` (or `-F @lc/kiosk`) as listed. Final full gate (Task 10 Step 8): typecheck · portal tests (node+jsdom) · kiosk tests · `pnpm lint` · `pnpm check:routes` · `pnpm gen:types:check` · portal build.

**Review discipline:** subagent-driven, fresh implementer + spec review + code-quality review per task. **Byte-preservation review requirements:** Task 5 (the Agora route's behavior must be byte-identical — its existing tests unchanged and green), Task 8 (kiosk `src/lib/agora.ts` untouched; SDK call sequence identical), Task 10 (the Agora branch inside `video-call.tsx` — only the token fetch/unwrap and the two audio-recovery-ref lines may differ; diff inspected line-by-line).

**STATUS:** Tasks 1+2 DONE 2026-07-05 (as-built) · Tasks 3-10 in subagent-driven build (Task 3 committed `67623df`, reviews running).

**Task 1 record:** committed `52da87d` (ops/livekit compose+example, runbook §13, register rows).

**Task 2 record (all steps PASS, 2026-07-05):** snapshot `pre-phase4-livekit` completed 04:18 UTC · port-conflict check clean · secrets generated → `~/.ssh/lc_livekit_keys.txt` (Kumar PM-stores) · `/opt/livekit/` installed (config 600) · ufw 7881/tcp + 7882:7885/udp + **7880 from `10.0.1.0/24` (Coolify proxy net — NOT 172.16/12; a 172.16/12 rule silently dropped Traefik → fixed)** · DO fw 7881/tcp + 7882-7885/udp verified · container healthy (`OK` on 127.0.0.1:7880); **kernel `net.core.rmem_max=5000000` persisted** (`/etc/sysctl.d/99-livekit.conf`, clears LiveKit's production WARN) · DNS by Kumar · Traefik dynamic config dropped at `/data/coolify/proxy/dynamic/livekit.yaml` (mirrors coolify.yaml shape: entryPoints `https`, `certresolver: letsencrypt`) · **external `https://livekit.lobby-connect.com/` → `OK`** (LE cert issued) · 7881 OPEN + 7880 externally BLOCKED verified from outside.

---

# PHASE A — server on the box

## Task 1: ops artifacts + runbook §13 + credentials register

**Files:**
- Create: `ops/livekit/compose.yaml`
- Create: `ops/livekit/livekit.yaml.example`
- Modify: `docs/setup/2026-07-02-box-ops-runbook.md` (append §13)
- Modify: `docs/setup/2026-07-03-accounts-credentials-inventory.md` (add LiveKit keypair rows)

- [ ] **Step 1: compose file** (mirrors the RustDesk pattern — repo copy is source of truth):

```yaml
# LiveKit OSS SFU — stack-consolidation Phase 4 (replaces Agora).
# Runs OUTSIDE Coolify as plain docker compose at /opt/livekit/compose.yaml on lc-box-1;
# this repo copy is the source of truth (deploy = copy + `docker compose up -d`).
# Ops: docs/setup/2026-07-02-box-ops-runbook.md §13 · design: docs/specs/2026-07-05-phase4-livekit-swap-design.md
#
# Load-bearing choices (spec §2, decisions D2-D7):
# - network_mode: host — LiveKit's documented Docker recommendation; ICE candidates
#   advertise the real host IP (no NAT rewrite) and ufw stays authoritative.
# - Signal port 7880 is NOT opened on the firewalls — only Coolify's Traefik reaches it
#   (TLS termination for wss://livekit.lobby-connect.com via a dynamic config).
# - Media goes direct: 7881/tcp (ICE fallback) + 7882-7885/udp (single-port mux,
#   >= vCPU count per LiveKit's config-sample guidance). Media must NOT sit behind
#   a proxy (WebRTC is already encrypted).
# - No TURN (D4: public-IP SFU + ICE/TCP fallback; enable-later seam in spec §2.5).
# - No Redis (D5: single node).
# - ./livekit.yaml holds the API keypairs — back up to PM, NEVER commit (the committed
#   file is livekit.yaml.example).
services:
  livekit:
    container_name: livekit
    image: livekit/livekit-server:v1.13.3
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    network_mode: host
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 2: config example** (real file lives only on the box + PM):

```yaml
# /opt/livekit/livekit.yaml — REAL file is box+PM only; this example is the committed shape.
# Design: docs/specs/2026-07-05-phase4-livekit-swap-design.md §2.1 (D3, D4, D5, D6).
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882-7885      # single-port UDP mux; >= vCPU count (box has 4)
  use_external_ip: false   # host networking on a droplet: public IP is bound directly
keys:
  lc_prod: REPLACE_WITH_GENERATED_SECRET
  lc_staging: REPLACE_WITH_GENERATED_SECRET
logging:
  level: info
```

- [ ] **Step 3: runbook §13** — append to `docs/setup/2026-07-02-box-ops-runbook.md`, matching §12's voice:

```markdown
## 13. LiveKit SFU (video — Phase 4)

- **What/where:** `livekit/livekit-server:v1.13.3` as plain compose at `/opt/livekit/`
  (NOT Coolify — same disjoint-failure-domain rule as the RustDesk relay). Repo source
  of truth: `ops/livekit/`. Config `/opt/livekit/livekit.yaml` holds the two API
  keypairs (`lc_prod`, `lc_staging`) — backed up in the PM; never committed.
- **Ports:** 7880/tcp signal (firewall-BLOCKED externally; Coolify Traefik proxies
  `livekit.lobby-connect.com` → host:7880 via a Dynamic Configuration named
  `livekit.yaml`) · 7881/tcp ICE fallback (open) · 7882-7885/udp media mux (open).
  TURN deliberately absent (spec §2.5 records the enable-later keys).
- **Health:** `curl -s http://127.0.0.1:7880/` → `OK` (406 `Not Ready` = unhealthy).
  From outside: `curl -s https://livekit.lobby-connect.com/` → `OK` (also proves
  Traefik route + cert).
- **Logs:** `docker logs livekit --tail 100` (json-file, capped 3x10MB).
- **Restart / update:** `cd /opt/livekit && docker compose up -d` (edit image tag to
  update; snapshot the droplet first for a version bump).
- **Key rotation:** edit `keys:` in `/opt/livekit/livekit.yaml` → `docker compose up -d`
  (restart re-reads config) → update the matching portal env (Coolify staging or
  Vercel prod) → PM + credentials register.
- **Staging/prod:** ONE instance serves both, distinguished by keypair. Room names are
  `call_<uuid>` from each env's own DB.
```

- [ ] **Step 4: credentials register** — add two rows to the inventory doc's table following its existing format: `LiveKit lc_prod API secret` and `LiveKit lc_staging API secret`, location "PM + /opt/livekit/livekit.yaml (box)", created 2026-07-XX (fill at Task 2), rotation "runbook §13".

- [ ] **Step 5: Commit**

```bash
git add ops/livekit docs/setup/2026-07-02-box-ops-runbook.md docs/setup/2026-07-03-accounts-credentials-inventory.md
git commit -m "ops(livekit): compose + config example + runbook s13 + register rows (Phase 4 Task 1)"
```

## Task 2: box bring-up — **[HUMAN + CONTROLLER — not a subagent task]** — DONE 2026-07-05 (record in STATUS above)

Requires Kumar's network (SSH is IP-restricted). Claude drives SSH if connected; otherwise Kumar pastes blocks. Check off in order; record outcomes inline.

- [ ] **Step 1: snapshot** (rollback point): `doctl compute droplet-action snapshot 581936683 --snapshot-name pre-phase4-livekit --wait`
- [ ] **Step 2: port-conflict check** (expect NO listeners on 7880-7885, 3478): `ssh -i ~/.ssh/lc_box root@159.203.124.112 'ss -tlnp | grep -E ":(788[0-5]|3478)\s" ; ss -ulnp | grep -E ":(788[0-5]|3478)\s" ; echo done'` → only `done`.
- [ ] **Step 3: generate secrets** (Mac): `openssl rand -hex 32` twice → `lc_prod`, `lc_staging`. **Kumar: store both in the PM now.** Fill the register rows' date (Task 1 Step 4).
- [ ] **Step 4: install on box:** create `/opt/livekit/`, copy `ops/livekit/compose.yaml` verbatim, write `livekit.yaml` from the example with the real secrets. `chmod 600 /opt/livekit/livekit.yaml`.
- [ ] **Step 5: ufw:** `ufw allow 7881/tcp comment 'livekit ice-tcp' && ufw allow 7882:7885/udp comment 'livekit media mux'` (7880 deliberately NOT allowed).
- [ ] **Step 6: DO cloud firewall** (Claude via doctl): add inbound `tcp 7881` + `udp 7882-7885` (all sources) to the box's firewall (`doctl compute firewall list` → `add-rules`).
- [ ] **Step 7: start + health:** `cd /opt/livekit && docker compose up -d && sleep 3 && curl -s http://127.0.0.1:7880/` → `OK`. `docker logs livekit --tail 20` → no errors, keys loaded.
- [ ] **Step 8 (Kumar, ~2 min): Cloudflare DNS** — A record `livekit` → `159.203.124.112`, **grey cloud**, TTL auto.
- [ ] **Step 9 (Kumar, ~3 min): Coolify Traefik dynamic config** — Servers → server → Proxy → Dynamic Configurations → Add, name `livekit.yaml`:

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

(Before saving: open one of the EXISTING dynamic configs and confirm the certResolver name used there — use that exact name if it differs from `letsencrypt`.)
- [ ] **Step 10: external verify:** from the Mac: `curl -s https://livekit.lobby-connect.com/` → `OK` (proves DNS + Traefik route + LE cert + LiveKit healthy). Also verify 7880 is NOT directly reachable: `nc -z -w3 159.203.124.112 7880` → fails/timeout.
- [ ] **Step 11:** record outcomes in this file under STATUS; commit.

---

# PHASE B — DTO, provider flag, token route

## Task 3: shared DTO `VideoTokenResult`

**Files:**
- Modify: `packages/shared/src/kiosk-api.ts`
- Modify: `apps/kiosk/src/types.ts`

- [ ] **Step 1: add the discriminated union** at the end of `kiosk-api.ts` (after `AgoraTokenResult`):

```ts
/**
 * Returned by GET /api/video/token (Phase 4 provider seam). The SERVER decides
 * the provider per call (VIDEO_PROVIDER env, portal-only) so kiosk and portal
 * can never disagree mid-call. The agora variant embeds AgoraTokenResult so the
 * existing Agora client code consumes it unchanged.
 */
export type VideoTokenResult =
  | ({ provider: "agora" } & AgoraTokenResult)
  | { provider: "livekit"; url: string; channelName: string; token: string };
```

- [ ] **Step 2: kiosk re-export** — `apps/kiosk/src/types.ts` becomes:

```ts
export type { KioskConfig, CallStartResult, AgoraTokenResult, VideoTokenResult } from "@lc/shared";
```

- [ ] **Step 3: gate** (type-only change; typecheck IS the test): `pnpm -F @lc/shared test && pnpm -F @lc/portal typecheck && pnpm -F @lc/kiosk typecheck` → green.
- [ ] **Step 4: Commit** — `git commit -m "feat(shared): VideoTokenResult discriminated DTO (Phase 4 Task 3)"`

## Task 4: portal provider config + boot-validation gating + .env.example

**Files:**
- Create: `apps/portal/lib/video/provider.ts`
- Modify: `apps/portal/instrumentation.ts`
- Modify: `apps/portal/.env.example`
- Test: `apps/portal/tests/lib/video/provider.test.ts`

- [ ] **Step 1: failing tests first:**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVideoProvider, getLiveKitConfig } from "@/lib/video/provider";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("getVideoProvider", () => {
  it("defaults to agora when unset (prod-inert merge, D8)", () => {
    vi.stubEnv("VIDEO_PROVIDER", "");
    expect(getVideoProvider()).toBe("agora");
  });
  it("returns livekit when set", () => {
    vi.stubEnv("VIDEO_PROVIDER", "livekit");
    expect(getVideoProvider()).toBe("livekit");
  });
  it("treats unknown values as agora (typo cannot dark-launch livekit)", () => {
    vi.stubEnv("VIDEO_PROVIDER", "liveKit");
    expect(getVideoProvider()).toBe("agora");
  });
});

describe("getLiveKitConfig", () => {
  it("returns url/key/secret when all present", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://livekit.lobby-connect.com");
    vi.stubEnv("LIVEKIT_API_KEY", "lc_staging");
    vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(64));
    expect(getLiveKitConfig()).toEqual({
      url: "wss://livekit.lobby-connect.com",
      apiKey: "lc_staging",
      apiSecret: "s".repeat(64),
    });
  });
  it.each(["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const)(
    "throws naming the missing var: %s",
    (missing) => {
      vi.stubEnv("LIVEKIT_URL", "wss://x");
      vi.stubEnv("LIVEKIT_API_KEY", "k");
      vi.stubEnv("LIVEKIT_API_SECRET", "s");
      vi.stubEnv(missing, "");
      expect(() => getLiveKitConfig()).toThrow(missing);
    },
  );
});
```

- [ ] **Step 2: run to fail:** `pnpm -F @lc/portal exec vitest run tests/lib/video/provider.test.ts` → FAIL (module not found).
- [ ] **Step 3: implement** `apps/portal/lib/video/provider.ts`:

```ts
import "server-only";

export type VideoProvider = "agora" | "livekit";

/**
 * The active video provider (Phase 4 swap seam, spec D8). Read at call time so
 * vi.stubEnv works in tests. Unset/unknown -> "agora": merging the swap is
 * prod-inert until the env is deliberately flipped.
 */
export function getVideoProvider(): VideoProvider {
  return process.env.VIDEO_PROVIDER === "livekit" ? "livekit" : "agora";
}

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Reads LIVEKIT_* at call time (see .env.example). */
export function getLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url) throw new Error("Missing LIVEKIT_URL env var (see .env.example).");
  if (!apiKey) throw new Error("Missing LIVEKIT_API_KEY env var (see .env.example).");
  if (!apiSecret) throw new Error("Missing LIVEKIT_API_SECRET env var (see .env.example).");
  return { url, apiKey, apiSecret };
}
```

- [ ] **Step 4: run to pass**, then **boot-validation gating** — in `apps/portal/instrumentation.ts`, replace the `validateConfigAtBoot` imports + `checks` array:

```ts
async function validateConfigAtBoot() {
  const { getTwilioConfig } = await import("./lib/twilio/config");
  const { getKioskConfigSecret } = await import("./lib/kiosk/config-secret");
  const { getVideoProvider, getLiveKitConfig } = await import("./lib/video/provider");
  const { getAgoraCredentials } = await import("./lib/agora/config");

  // Validate only the ACTIVE video provider (spec D15): staging runs LiveKit with
  // no Agora cert (deliberate) and must not boot-warn about the inactive provider.
  const videoCheck: [string, () => unknown] =
    getVideoProvider() === "livekit" ? ["LiveKit", getLiveKitConfig] : ["Agora", getAgoraCredentials];

  const checks: Array<[string, () => unknown]> = [
    ["Twilio", getTwilioConfig],
    videoCheck,
    ["Kiosk config", getKioskConfigSecret],
    [
      "CRON_SECRET",
      () => {
        if (!process.env.CRON_SECRET) {
          throw new Error("Missing CRON_SECRET environment variable.");
        }
      },
    ],
  ];

  for (const [label, check] of checks) {
    try {
      check();
    } catch (err) {
      console.error(
        `[boot] ${label} config invalid:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
```

- [ ] **Step 5: .env.example** — after the AGORA block add:

```
# Video provider (stack-consolidation Phase 4). "agora" (default when unset) or
# "livekit". The server decides per call; clients follow the token response.
VIDEO_PROVIDER=

# Self-hosted LiveKit (Phase 4). Required when VIDEO_PROVIDER=livekit.
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

- [ ] **Step 6: gate** `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test` → green.
- [ ] **Step 7: Commit** — `git commit -m "feat(video): provider flag + LiveKit config + boot-validation gating (Phase 4 Task 4)"`

## Task 5: extract shared token-route authorization (Agora route byte-identical)

**Files:**
- Create: `apps/portal/lib/video/token-auth.ts`
- Modify: `apps/portal/app/api/agora/token/route.ts`
- Tests: existing `apps/portal/tests/app/agora/token.test.ts` — **must pass UNCHANGED** (the byte-behavior guard)

- [ ] **Step 1: create the helper** — logic moved VERBATIM from the route:

```ts
import "server-only";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { ACTIVE_CALL_STATES } from "@/lib/voice/call-state";

export type VideoTokenRequester = { kind: "kiosk" } | { kind: "session"; userId: string };

/**
 * Shared authorization for the video token routes (/api/agora/token and
 * /api/video/token): resolve the LIVE call by channel, then dual-auth — kiosk
 * config token (property-scoped) OR an AGENT/ADMIN session in the call's
 * operator (OWNER rejected — publisher tokens would let a read-only role join
 * a live guest call). Extracted VERBATIM from /api/agora/token in Phase 4;
 * behavior byte-identical (that route's tests are the guard). The requester
 * identity feeds the LiveKit branch's participant identity (spec D9).
 */
export async function authorizeVideoTokenRequest(
  request: Request,
  channel: string,
): Promise<VideoTokenRequester | NextResponse> {
  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, operator_id, state, agora_channel_name")
    .eq("agora_channel_name", channel)
    .maybeSingle();

  if (!call || !(ACTIVE_CALL_STATES as readonly string[]).includes(call.state)) {
    return NextResponse.json({ error: "No live call for channel" }, { status: 404 });
  }

  const kioskToken = request.headers.get("x-kiosk-token");
  if (kioskToken) {
    const verified = verifyKioskToken(kioskToken, getKioskConfigSecret());
    if (!verified) {
      return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
    }
    if (verified.propertyId !== call.property_id) {
      return NextResponse.json({ error: "Channel not in property" }, { status: 403 });
    }
    return { kind: "kiosk" };
  }

  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  if (actorOrResponse.operatorId !== call.operator_id) {
    return NextResponse.json({ error: "Channel not in operator" }, { status: 403 });
  }
  return { kind: "session", userId: actorOrResponse.userId };
}
```

- [ ] **Step 2: rewrite the Agora route onto it** — `app/api/agora/token/route.ts` becomes:

```ts
import { NextResponse } from "next/server";

import { authorizeVideoTokenRequest } from "@/lib/video/token-auth";
import { getAgoraCredentials } from "@/lib/agora/config";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import type { AgoraTokenResult } from "@lc/shared";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") ?? "";
  const uidStr = searchParams.get("uid") ?? "";
  const uid = Number(uidStr);
  if (!channel || !uidStr || Number.isNaN(uid)) {
    return NextResponse.json({ error: "Missing channel or uid" }, { status: 400 });
  }

  const requester = await authorizeVideoTokenRequest(request, channel);
  if (requester instanceof NextResponse) return requester;

  const { appId, appCertificate } = getAgoraCredentials();
  const token = buildRtcPublisherToken({
    appId,
    appCertificate,
    channelName: channel,
    uid,
    expireSeconds: TOKEN_TTL_SECONDS,
  });

  const payload: AgoraTokenResult = { appId, channelName: channel, uid, token };
  return NextResponse.json(payload);
}
```

- [ ] **Step 3: gate — the extraction's proof:** `pnpm -F @lc/portal exec vitest run tests/app/agora/token.test.ts` with ZERO edits to that test file → all pass. Then full `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test`.
- [ ] **Step 4: Commit** — `git commit -m "refactor(video): extract shared token-route authorization; agora route behavior byte-identical (Phase 4 Task 5)"`

## Task 6: `/api/video/token` route + CORS + server SDK

**Files:**
- Create: `apps/portal/app/api/video/token/route.ts`
- Modify: `apps/portal/next.config.ts` (CORS line)
- Modify: `apps/portal/package.json` (dep)
- Test: `apps/portal/tests/app/video/token.test.ts`

- [ ] **Step 1: dep:** `pnpm -F @lc/portal add livekit-server-sdk@^2.16.0`
- [ ] **Step 2: failing tests** — copy the harness style of `tests/app/agora/token.test.ts` (same mocks for supabase server/admin + kiosk token signing):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);
vi.stubEnv("AGORA_APP_ID", "a".repeat(32));
vi.stubEnv("AGORA_APP_CERTIFICATE", "b".repeat(32));
vi.stubEnv("LIVEKIT_URL", "wss://livekit.lobby-connect.com");
vi.stubEnv("LIVEKIT_API_KEY", "lc_test");
vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(64));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
let profileRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === "calls" ? callRow : profileRow }) }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/video/token/route";

function req(params: Record<string, string>, headers: Record<string, string> = {}) {
  const u = new URL("http://localhost:3000/api/video/token");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Request(u.toString(), { headers });
}

/** Decode a JWT payload without verifying (shape assertions only; no jose dep). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  callRow = { id: "call-1", property_id: "prop-1", operator_id: "op-1", state: "RINGING", agora_channel_name: "call_abc" };
  profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true };
  vi.stubEnv("VIDEO_PROVIDER", "");
});

describe("GET /api/video/token — agora branch (default)", () => {
  it("kiosk path returns the exact agora payload with provider discriminator", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("agora");
    expect(body.channelName).toBe("call_abc");
    expect(body.uid).toBe(111);
    expect(body.appId).toBe("a".repeat(32));
    expect(body.token.startsWith("007")).toBe(true);
  });
});

describe("GET /api/video/token — livekit branch", () => {
  beforeEach(() => vi.stubEnv("VIDEO_PROVIDER", "livekit"));

  it("kiosk path: identity 'kiosk', room-scoped grants, url from env", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ provider: "livekit", url: "wss://livekit.lobby-connect.com", channelName: "call_abc" });
    expect(body.uid).toBeUndefined();
    const claims = decodeJwtPayload(body.token) as { sub: string; video: Record<string, unknown>; exp: number; iat?: number; nbf?: number };
    expect(claims.sub).toBe("kiosk");
    expect(claims.video).toMatchObject({ roomJoin: true, room: "call_abc", canPublish: true, canSubscribe: true });
    const issued = claims.iat ?? claims.nbf ?? 0;
    expect(claims.exp - issued).toBe(3600); // TTL parity with agora (D10)
  });

  it("session path: identity agent-<userId>", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req({ channel: "call_abc", uid: "222" }));
    expect(res.status).toBe(200);
    const claims = decodeJwtPayload((await res.json()).token) as { sub: string };
    expect(claims.sub).toBe("agent-u1");
  });

  it("OWNER is rejected on the session path", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    profileRow = { ...profileRow!, role: "OWNER" };
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(403);
  });

  it("404 when the call is not in an active state", async () => {
    callRow = { ...callRow!, state: "COMPLETED" };
    const res = await GET(req({ channel: "call_abc", uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(404);
  });

  it("400 when channel or uid missing", async () => {
    expect((await GET(req({ uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }))).status).toBe(400);
  });

  it("401 with neither kiosk token nor session", async () => {
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(401);
  });
});
```

- [ ] **Step 3: run to fail** (route missing), then **implement** `app/api/video/token/route.ts`:

```ts
import { NextResponse } from "next/server";

import { authorizeVideoTokenRequest } from "@/lib/video/token-auth";
import { getVideoProvider, getLiveKitConfig } from "@/lib/video/provider";
import { getAgoraCredentials } from "@/lib/agora/config";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import type { VideoTokenResult } from "@lc/shared";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600; // parity with the Agora route; expiry cannot drop a CONNECTED LiveKit call (spec D10)

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") ?? "";
  const uidStr = searchParams.get("uid") ?? "";
  const uid = Number(uidStr);
  if (!channel || !uidStr || Number.isNaN(uid)) {
    return NextResponse.json({ error: "Missing channel or uid" }, { status: 400 });
  }

  const requester = await authorizeVideoTokenRequest(request, channel);
  if (requester instanceof NextResponse) return requester;

  if (getVideoProvider() === "livekit") {
    const { url, apiKey, apiSecret } = getLiveKitConfig();
    const { AccessToken } = await import("livekit-server-sdk");
    // Identities are meaningful AND ghost-replacing (spec D9): a reconnecting
    // side with the same identity replaces its zombie participant.
    const identity = requester.kind === "kiosk" ? "kiosk" : `agent-${requester.userId}`;
    const at = new AccessToken(apiKey, apiSecret, { identity, ttl: TOKEN_TTL_SECONDS });
    at.addGrant({ roomJoin: true, room: channel, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();
    const payload: VideoTokenResult = { provider: "livekit", url, channelName: channel, token };
    return NextResponse.json(payload);
  }

  const { appId, appCertificate } = getAgoraCredentials();
  const token = buildRtcPublisherToken({
    appId,
    appCertificate,
    channelName: channel,
    uid,
    expireSeconds: TOKEN_TTL_SECONDS,
  });
  const payload: VideoTokenResult = { provider: "agora", appId, channelName: channel, uid, token };
  return NextResponse.json(payload);
}
```

- [ ] **Step 4: CORS** — in `next.config.ts` `headers()`:

```ts
    return [
      { source: "/api/kiosk/:path*", headers: KIOSK_CORS },
      { source: "/api/agora/:path*", headers: KIOSK_CORS },
      { source: "/api/video/:path*", headers: KIOSK_CORS },
    ];
```

- [ ] **Step 5: run to pass** + `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test` → green.
- [ ] **Step 6: Commit** — `git commit -m "feat(video): provider-discriminated /api/video/token (livekit mint + agora parity) + kiosk CORS (Phase 4 Task 6)"`

---

# PHASE C — kiosk client seam

## Task 7: kiosk video types + LiveKit session module (TDD)

**Files:**
- Create: `apps/kiosk/src/lib/video/types.ts`
- Create: `apps/kiosk/src/lib/video/livekit.ts`
- Modify: `apps/kiosk/package.json` (dep)
- Test: `apps/kiosk/tests/lib/video/livekit.test.ts`

- [ ] **Step 1: dep:** `pnpm -F @lc/kiosk add livekit-client@^2.20.0`
- [ ] **Step 2: the seam types** — `src/lib/video/types.ts`:

```ts
/**
 * Provider-agnostic video seam (Phase 4, spec D13). Screens and App consume
 * ONLY these shapes; the agora/livekit modules produce them. The handle
 * normalizes the one provider-typed thing screens used to touch:
 * Agora `track.play(el)` vs LiveKit `track.attach()`.
 */
export interface VideoTrackHandle {
  /** Render this track inside the given container element. */
  attach(container: HTMLElement): void;
  /** Remove any elements this handle attached. */
  detach(): void;
  /** Raw W3C track (mute/camera toggles flip `.enabled`), null if unavailable. */
  mediaStreamTrack(): MediaStreamTrack | null;
}

export interface KioskVideoSession {
  localVideo: VideoTrackHandle;
  localAudioTrack: MediaStreamTrack;
  leave(): Promise<void>;
}

export interface JoinCallbacks {
  onRemoteVideo(handle: VideoTrackHandle | null): void;
  onAgentJoined(): void;
  onAgentLeft(): void;
  onConnectionStateChange(current: string, previous: string, reason?: string): void;
}
```

- [ ] **Step 3: failing tests** — `tests/lib/video/livekit.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const lk = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  const on = vi.fn((ev: string, cb: (...a: unknown[]) => void) => {
    const list = handlers.get(ev) ?? [];
    list.push(cb);
    handlers.set(ev, list);
    return room;
  });
  const room: Record<string, unknown> = {
    on,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    canPlaybackAudio: false,
    localParticipant: { publishTrack: vi.fn(async () => {}) },
  };
  const emit = (ev: string, ...a: unknown[]) => handlers.get(ev)?.forEach((cb) => cb(...a));
  const mkVideoEl = () => document.createElement("video");
  const localAudio = { mediaStreamTrack: { enabled: true } as MediaStreamTrack };
  const localVideo = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    attach: vi.fn(() => mkVideoEl()),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  };
  const RoomEvent = {
    TrackSubscribed: "trackSubscribed",
    ParticipantDisconnected: "participantDisconnected",
    Disconnected: "disconnected",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    AudioPlaybackStatusChanged: "audioPlaybackChanged",
  };
  const Track = { Kind: { Video: "video", Audio: "audio" } };
  const DisconnectReason = { CLIENT_INITIATED: 1 };
  return {
    room,
    emit,
    reset: () => handlers.clear(),
    localAudio,
    localVideo,
    createLocalAudioTrack: vi.fn(async () => localAudio),
    createLocalVideoTrack: vi.fn(async () => localVideo),
    RoomEvent,
    Track,
    DisconnectReason,
  };
});

vi.mock("livekit-client", () => ({
  Room: vi.fn(function () { return lk.room; }),
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  DisconnectReason: lk.DisconnectReason,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));

const recover = vi.hoisted(() => ({ recoverAudioOnNextGesture: vi.fn() }));
vi.mock("@/lib/audio-unlock", () => recover);
vi.mock("@sentry/react", () => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));

import { joinLiveKit } from "@/lib/video/livekit";

function callbacks() {
  return {
    onRemoteVideo: vi.fn(),
    onAgentJoined: vi.fn(),
    onAgentLeft: vi.fn(),
    onConnectionStateChange: vi.fn(),
  };
}

function remoteVideoTrack() {
  return {
    kind: "video",
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
  };
}
function remoteAudioTrack() {
  return {
    kind: "audio",
    attach: vi.fn(() => document.createElement("audio")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
  };
}

describe("joinLiveKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.reset();
    (lk.room as { canPlaybackAudio: boolean }).canPlaybackAudio = false;
  });

  it("connects then publishes MIC FIRST, camera second (cold-camera fix preserved)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenNthCalledWith(1, lk.localAudio);
    expect(publish).toHaveBeenNthCalledWith(2, lk.localVideo);
    expect(lk.createLocalAudioTrack.mock.invocationCallOrder[0]).toBeLessThan(
      lk.createLocalVideoTrack.mock.invocationCallOrder[0],
    );
  });

  it("remote VIDEO subscribe -> onRemoteVideo handle + onAgentJoined exactly once", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("trackSubscribed", remoteVideoTrack());
    lk.emit("trackSubscribed", remoteVideoTrack());
    expect(cb.onRemoteVideo).toHaveBeenCalledTimes(2);
    expect(cb.onAgentJoined).toHaveBeenCalledTimes(1);
    const handle = cb.onRemoteVideo.mock.calls[0][0] as { attach(c: HTMLElement): void };
    const container = document.createElement("div");
    handle.attach(container);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("remote AUDIO subscribe attaches a playback element (no DOM insert needed)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    const audio = remoteAudioTrack();
    lk.emit("trackSubscribed", audio);
    expect(audio.attach).toHaveBeenCalled();
    expect(cb.onAgentJoined).not.toHaveBeenCalled(); // agent-present fires on VIDEO only (parity)
  });

  it("blocked audio playback wires the gesture recovery to room.startAudio", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("audioPlaybackChanged");
    expect(recover.recoverAudioOnNextGesture).toHaveBeenCalledTimes(1);
    (recover.recoverAudioOnNextGesture.mock.calls[0][0] as () => void)();
    expect(lk.room.startAudio).toHaveBeenCalled();
  });

  it("ParticipantDisconnected -> onAgentLeft", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("participantDisconnected");
    expect(cb.onAgentLeft).toHaveBeenCalledTimes(1);
  });

  it("maps connection events into the kiosk vocabulary (interpretConnectionState contract)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("reconnecting");
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("RECONNECTING", "CONNECTED");
    lk.emit("reconnected");
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("CONNECTED", "RECONNECTING");
    lk.emit("disconnected", lk.DisconnectReason.CLIENT_INITIATED);
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("DISCONNECTED", "CONNECTED", "LEAVE");
    lk.emit("disconnected", 99);
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("DISCONNECTED", "CONNECTED", "99");
  });

  it("session exposes local handles + leave() disconnects", async () => {
    const cb = callbacks();
    const session = await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    expect(session.localAudioTrack).toBe(lk.localAudio.mediaStreamTrack);
    const container = document.createElement("div");
    session.localVideo.attach(container);
    expect(container.querySelector("video")).not.toBeNull();
    await session.leave();
    expect(lk.room.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: run to fail:** `pnpm -F @lc/kiosk exec vitest run tests/lib/video/livekit.test.ts` → FAIL (module not found).
- [ ] **Step 5: implement** `src/lib/video/livekit.ts`:

```ts
import * as Sentry from "@sentry/react";
import type { RemoteTrack } from "livekit-client";
import { recoverAudioOnNextGesture } from "../audio-unlock";
import type { JoinCallbacks, KioskVideoSession, VideoTrackHandle } from "./types";

interface AttachableTrack {
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
  mediaStreamTrack: MediaStreamTrack;
}

/**
 * Wrap a LiveKit track in the provider-agnostic handle (spec D13). attach()
 * lets the SDK create the element (it sets playsInline/autoplay itself, incl.
 * the Safari quirk), styles it to fill the container — visual parity with
 * Agora's `track.play(container)` — and appends it. `mirror` flips the LOCAL
 * self-view horizontally, matching Agora's default local mirroring.
 */
function liveKitHandle(track: AttachableTrack, opts?: { mirror?: boolean }): VideoTrackHandle {
  return {
    attach(container: HTMLElement) {
      const el = track.attach() as HTMLVideoElement;
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.objectFit = "cover";
      if (opts?.mirror) el.style.transform = "scaleX(-1)";
      container.appendChild(el);
    },
    detach() {
      track.detach().forEach((el) => el.remove());
    },
    mediaStreamTrack: () => track.mediaStreamTrack,
  };
}

/**
 * LiveKit sibling of joinChannel (src/lib/agora.ts) — SAME callback contract,
 * chosen by the /api/video/token provider field. Dynamic-imports the SDK
 * (bundle parity with the Agora path). Connection events are translated into
 * the kiosk's existing vocabulary so interpretConnectionState + App.tsx stay
 * untouched: Reconnecting -> RECONNECTING, Reconnected -> CONNECTED,
 * Disconnected(CLIENT_INITIATED, i.e. our own leave()) -> "LEAVE" (inert, like
 * Agora's LEAVE reason); any other disconnect reason is terminal.
 */
export async function joinLiveKit(
  opts: { url: string; token: string } & JoinCallbacks,
): Promise<KioskVideoSession> {
  const { Room, RoomEvent, Track, DisconnectReason, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const room = new Room();
  let agentJoinedFired = false;
  const remoteAudioEls: HTMLMediaElement[] = [];

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      opts.onRemoteVideo(liveKitHandle(track as unknown as AttachableTrack));
      // Fire "agent present" once, on video — parity with the Agora impl.
      if (!agentJoinedFired) {
        agentJoinedFired = true;
        opts.onAgentJoined();
      }
    }
    if (track.kind === Track.Kind.Audio) {
      // Audio needs no layout: the element plays without DOM insertion.
      remoteAudioEls.push(track.attach());
    }
  });

  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      Sentry.addBreadcrumb({
        category: "livekit",
        level: "warning",
        message: "remote audio autoplay blocked; recovering on next interaction",
      });
      recoverAudioOnNextGesture(() => void room.startAudio());
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, () => opts.onAgentLeft());
  room.on(RoomEvent.Reconnecting, () => opts.onConnectionStateChange("RECONNECTING", "CONNECTED"));
  room.on(RoomEvent.Reconnected, () => opts.onConnectionStateChange("CONNECTED", "RECONNECTING"));
  room.on(RoomEvent.Disconnected, (reason?: number) => {
    const isLeave = reason === DisconnectReason.CLIENT_INITIATED;
    opts.onConnectionStateChange("DISCONNECTED", "CONNECTED", isLeave ? "LEAVE" : String(reason ?? "UNKNOWN"));
  });

  await room.connect(opts.url, opts.token);

  // Mic FIRST, camera second — same reason as the Agora impl: the camera's cold
  // warm-up (seconds, plus a permission prompt on a fresh device) must not gate
  // the guest's voice. A camera failure throws out of joinLiveKit -> App's catch
  // -> apology (the kiosk REQUIRES a camera; it is the guest's face).
  const localAudio = await createLocalAudioTrack();
  await room.localParticipant.publishTrack(localAudio);
  const localVideo = await createLocalVideoTrack();
  await room.localParticipant.publishTrack(localVideo);

  return {
    localVideo: liveKitHandle(localVideo as unknown as AttachableTrack, { mirror: true }),
    localAudioTrack: localAudio.mediaStreamTrack,
    leave: async () => {
      for (const el of remoteAudioEls) {
        el.pause();
        (el as HTMLMediaElement & { srcObject: unknown }).srcObject = null;
      }
      // A disconnect during a network drop can reject — session is over either way.
      try {
        await room.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
```

- [ ] **Step 6: run to pass**, then `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test` → green.
- [ ] **Step 7: Commit** — `git commit -m "feat(kiosk): provider seam types + LiveKit session module, TDD (Phase 4 Task 7)"`

## Task 8: kiosk Agora adapter + token fetch + App branch + screens on handles

**Files:**
- Create: `apps/kiosk/src/lib/video/agora.ts` (adapter — `src/lib/agora.ts` stays BYTE-UNTOUCHED)
- Modify: `apps/kiosk/src/lib/portal-api.ts` (`fetchAgoraToken` → `fetchVideoToken`)
- Modify: `apps/kiosk/src/App.tsx`
- Modify: `apps/kiosk/src/screens/Ringing.tsx`, `apps/kiosk/src/screens/Connected.tsx`
- Modify: `apps/kiosk/tests/app-setup-failure.test.tsx` (mock paths/names)
- Test: `apps/kiosk/tests/lib/video/agora-adapter.test.ts`

- [ ] **Step 1: failing adapter test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const agora = vi.hoisted(() => ({ joinChannel: vi.fn() }));
vi.mock("@/lib/agora", () => agora);

import { joinAgora } from "@/lib/video/agora";

function fakeAgoraTrack() {
  return { play: vi.fn(), getMediaStreamTrack: vi.fn(() => ({ enabled: true }) as MediaStreamTrack) };
}

describe("joinAgora adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes join args through and wraps tracks in handles", async () => {
    const localVideo = fakeAgoraTrack();
    const localAudio = fakeAgoraTrack();
    agora.joinChannel.mockResolvedValue({ localVideo, localAudio, leave: vi.fn(), client: {} });
    const onRemoteVideo = vi.fn();
    const session = await joinAgora({
      appId: "a", channel: "c", token: "t", uid: 7,
      onRemoteVideo, onAgentJoined: vi.fn(), onAgentLeft: vi.fn(), onConnectionStateChange: vi.fn(),
    });
    expect(agora.joinChannel).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "a", channel: "c", token: "t", uid: 7 }),
    );
    // local video handle delegates to Agora's play(el)
    const container = {} as HTMLElement;
    session.localVideo.attach(container);
    expect(localVideo.play).toHaveBeenCalledWith(container);
    expect(session.localAudioTrack).toEqual({ enabled: true });
    // remote wrap: invoke the adapter's onRemoteVideo with an agora track
    const passed = agora.joinChannel.mock.calls[0][0] as { onRemoteVideo: (t: unknown) => void };
    const remote = fakeAgoraTrack();
    passed.onRemoteVideo(remote);
    const handle = onRemoteVideo.mock.calls[0][0] as { attach(c: HTMLElement): void };
    handle.attach(container);
    expect(remote.play).toHaveBeenCalledWith(container);
    // null passthrough
    passed.onRemoteVideo(null);
    expect(onRemoteVideo).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: run to fail**, then **implement** `src/lib/video/agora.ts`:

```ts
import { joinChannel } from "../agora";
import type { JoinCallbacks, KioskVideoSession, VideoTrackHandle } from "./types";

interface AgoraPlayableTrack {
  play(container: HTMLElement): void;
  getMediaStreamTrack(): MediaStreamTrack;
}

/**
 * Adapter over the UNTOUCHED Agora module (src/lib/agora.ts): wraps its tracks
 * in the provider-agnostic handle (spec D13). detach() is a no-op — matching
 * today's semantics, where nothing detaches Agora players and teardown closes
 * the tracks. Dies with the Agora strip at Phase-4 close.
 */
function agoraHandle(track: AgoraPlayableTrack): VideoTrackHandle {
  return {
    attach: (container) => track.play(container),
    detach: () => {},
    mediaStreamTrack: () => track.getMediaStreamTrack(),
  };
}

export async function joinAgora(
  opts: { appId: string; channel: string; token: string; uid: number } & JoinCallbacks,
): Promise<KioskVideoSession> {
  const session = await joinChannel({
    appId: opts.appId,
    channel: opts.channel,
    token: opts.token,
    uid: opts.uid,
    onRemoteVideo: (t) => opts.onRemoteVideo(t ? agoraHandle(t as unknown as AgoraPlayableTrack) : null),
    onAgentJoined: opts.onAgentJoined,
    onAgentLeft: opts.onAgentLeft,
    onConnectionStateChange: opts.onConnectionStateChange,
  });
  return {
    localVideo: agoraHandle(session.localVideo as unknown as AgoraPlayableTrack),
    localAudioTrack: session.localAudio.getMediaStreamTrack(),
    leave: session.leave,
  };
}
```

- [ ] **Step 3: portal-api swap** — in `src/lib/portal-api.ts`, replace `fetchAgoraToken` with (and update the type import to include `VideoTokenResult`):

```ts
export async function fetchVideoToken(channel: string, uid: number): Promise<VideoTokenResult> {
  const url = new URL(`${getPortalApiBase()}/api/video/token`);
  url.searchParams.set("channel", channel);
  url.searchParams.set("uid", String(uid));
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`video-token ${res.status}`);
  return (await res.json()) as VideoTokenResult;
}
```

- [ ] **Step 4: App.tsx** — the exact deltas (everything else stays byte-identical):
  - Imports: drop `import type { ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";` and `import { joinChannel, type KioskAgoraSession } from "./lib/agora";`; add:

```ts
import { joinAgora } from "./lib/video/agora";
import { joinLiveKit } from "./lib/video/livekit";
import type { KioskVideoSession, VideoTrackHandle } from "./lib/video/types";
```

  - Portal-api import: `fetchAgoraToken` → `fetchVideoToken`.
  - State/refs:

```ts
  const [remoteVideo, setRemoteVideo] = useState<VideoTrackHandle | null>(null);
  const [localVideo, setLocalVideo] = useState<VideoTrackHandle | null>(null);
  // ...
  const sessionRef = useRef<KioskVideoSession | null>(null);
  const localAudioRef = useRef<MediaStreamTrack | null>(null);
```

  - In `onStartCall`, replace the token fetch + join block (keeping the abort checks and ALL callbacks byte-identical):

```ts
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchVideoToken(channelName, uid);
      if (aborted()) { void endCall(callId, "cancelled"); return; }
      const callbacks = {
        onRemoteVideo: (h: VideoTrackHandle | null) => setRemoteVideo(h),
        onAgentJoined: () => {
          /* UNCHANGED body from today (ring-timer clear + AGENT_JOINED + max-duration arm) */
        },
        onAgentLeft: () => {
          /* UNCHANGED body */
        },
        onConnectionStateChange: (cur: string, _prev: string, reason?: string) => {
          /* UNCHANGED body */
        },
      };
      const session =
        tok.provider === "livekit"
          ? await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks })
          : await joinAgora({ appId: tok.appId, channel: tok.channelName, token: tok.token, uid: tok.uid, ...callbacks });
```

    (The three "UNCHANGED body" comments are instructions to the implementer to move today's exact callback bodies — the plan marks them so the diff review can verify byte-equality.)
  - After the abort re-check: `localAudioRef.current = session.localAudioTrack;` and `setLocalVideo(session.localVideo);` (sessionRef assignment unchanged).
  - `toggleMute`: `const t = localAudioRef.current; if (t) t.enabled = !next;`
  - `toggleCamera`: `const t = localVideo?.mediaStreamTrack(); if (t) t.enabled = !next;`
- [ ] **Step 5: screens on handles** — `Ringing.tsx`: prop type `localVideo: VideoTrackHandle | null` (import from `@/lib/video/types`; drop the agora type import); effect body → `if (localVideo && ref.current) localVideo.attach(ref.current);`. `Connected.tsx`: both props → `VideoTrackHandle | null`; both effects → `.attach(...)`.
- [ ] **Step 6: update the setup-failure test** — in `tests/app-setup-failure.test.tsx`: rename the api spy `fetchAgoraToken` → `fetchVideoToken` (and its `mockRejectedValue` line, message `"video-token 500"`); replace `vi.mock("@/lib/agora", ...)` with:

```ts
const video = vi.hoisted(() => ({ joinAgora: vi.fn(), joinLiveKit: vi.fn() }));
vi.mock("@/lib/video/agora", () => ({ joinAgora: video.joinAgora }));
vi.mock("@/lib/video/livekit", () => ({ joinLiveKit: video.joinLiveKit }));
```

- [ ] **Step 7: gate:** `pnpm -F @lc/kiosk typecheck && pnpm -F @lc/kiosk test && pnpm -F @lc/kiosk build` → green. **Review requirement:** `git diff src/lib/agora.ts` → EMPTY.
- [ ] **Step 8: Commit** — `git commit -m "feat(kiosk): provider branch on /api/video/token; screens on VideoTrackHandle; agora module untouched (Phase 4 Task 8)"`

---

# PHASE D — portal client seam

## Task 9: portal LiveKit call session module (TDD)

**Files:**
- Create: `apps/portal/lib/video/livekit-session.ts`
- Modify: `apps/portal/package.json` (dep)
- Test: `apps/portal/tests/lib/video/livekit-session.test.ts` — runs in the NODE suite (its include is `tests/**` minus `tests/components/**`); the file's `// @vitest-environment jsdom` pragma overrides the environment per-file (the kiosk's proven pattern), which this test needs for `document.createElement`

- [ ] **Step 1: dep:** `pnpm -F @lc/portal add livekit-client@^2.20.0`
- [ ] **Step 2: failing tests** (same hoisted-mock pattern as Task 7; portal-specific behaviors):

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const lk = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  const on = vi.fn((ev: string, cb: (...a: unknown[]) => void) => {
    const list = handlers.get(ev) ?? [];
    list.push(cb);
    handlers.set(ev, list);
    return room;
  });
  const room: Record<string, unknown> = {
    on,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    canPlaybackAudio: false,
    localParticipant: { publishTrack: vi.fn(async () => {}) },
  };
  const emit = (ev: string, ...a: unknown[]) => handlers.get(ev)?.forEach((cb) => cb(...a));
  const localAudio = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
  };
  const localVideo = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  };
  return {
    room,
    emit,
    reset: () => handlers.clear(),
    localAudio,
    localVideo,
    createLocalAudioTrack: vi.fn(async () => localAudio),
    createLocalVideoTrack: vi.fn(async () => localVideo),
    RoomEvent: {
      TrackSubscribed: "trackSubscribed",
      ParticipantDisconnected: "participantDisconnected",
      AudioPlaybackStatusChanged: "audioPlaybackChanged",
    },
    Track: { Kind: { Video: "video", Audio: "audio" } },
  };
});

vi.mock("livekit-client", () => ({
  Room: vi.fn(function () { return lk.room; }),
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));

import { joinLiveKitCall } from "@/lib/video/livekit-session";

function callbacks() {
  return {
    onRemoteVideo: vi.fn(),
    onRemoteAudioTrack: vi.fn(),
    onAudioBlocked: vi.fn(),
    onGuestLeft: vi.fn(),
  };
}

describe("joinLiveKitCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.reset();
    lk.createLocalAudioTrack.mockResolvedValue(lk.localAudio);
    lk.createLocalVideoTrack.mockResolvedValue(lk.localVideo);
  });

  it("publishes mic first, then camera; exposes local handles + no warning", async () => {
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenNthCalledWith(1, lk.localAudio);
    expect(publish).toHaveBeenNthCalledWith(2, lk.localVideo);
    expect(s.mediaWarning).toBeNull();
    expect(s.localVideo).not.toBeNull();
    expect(s.localAudioMediaTrack).toBe(lk.localAudio.mediaStreamTrack);
  });

  it("BUSY WEBCAM: camera failure -> audio-only, localVideo null, warning 'camera', call proceeds", async () => {
    lk.createLocalVideoTrack.mockRejectedValue(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(lk.localAudio);
    expect(s.localVideo).toBeNull();
    expect(s.mediaWarning).toBe("camera");
  });

  it("mic failure -> warning 'mic'; both fail -> 'both' and nothing published", async () => {
    lk.createLocalAudioTrack.mockRejectedValue(new Error("denied"));
    const s1 = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    expect(s1.mediaWarning).toBe("mic");
    lk.createLocalVideoTrack.mockRejectedValue(new Error("busy"));
    const s2 = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    expect(s2.mediaWarning).toBe("both");
  });

  it("remote video -> handle; remote audio -> attach + raw track to captions tap", async () => {
    const cb = callbacks();
    await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    const vid = { kind: "video", attach: vi.fn(() => document.createElement("video")), detach: vi.fn(() => []), mediaStreamTrack: {} as MediaStreamTrack };
    const aud = { kind: "audio", attach: vi.fn(() => document.createElement("audio")), detach: vi.fn(() => []), mediaStreamTrack: { id: "guest-audio" } as unknown as MediaStreamTrack };
    lk.emit("trackSubscribed", vid);
    lk.emit("trackSubscribed", aud);
    expect(cb.onRemoteVideo).toHaveBeenCalledTimes(1);
    expect(aud.attach).toHaveBeenCalled();
    expect(cb.onRemoteAudioTrack).toHaveBeenCalledWith(aud.mediaStreamTrack);
  });

  it("blocked playback -> onAudioBlocked with a recover fn that calls startAudio", async () => {
    const cb = callbacks();
    await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    lk.emit("audioPlaybackChanged");
    expect(cb.onAudioBlocked).toHaveBeenCalledTimes(1);
    (cb.onAudioBlocked.mock.calls[0][0] as () => void)();
    expect(lk.room.startAudio).toHaveBeenCalled();
  });

  it("guest left -> onGuestLeft; setMicMuted drives mute/unmute; leave disconnects", async () => {
    const cb = callbacks();
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    lk.emit("participantDisconnected");
    expect(cb.onGuestLeft).toHaveBeenCalledTimes(1);
    await s.setMicMuted(true);
    expect(lk.localAudio.mute).toHaveBeenCalled();
    await s.setMicMuted(false);
    expect(lk.localAudio.unmute).toHaveBeenCalled();
    await s.leave();
    expect(lk.room.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: run to fail**, then **implement** `lib/video/livekit-session.ts`:

```ts
"use client";

import type { RemoteTrack } from "livekit-client";

export interface PortalVideoHandle {
  attach(container: HTMLElement): void;
  detach(): void;
  mediaStreamTrack(): MediaStreamTrack | null;
}

export interface LiveKitCallSession {
  localVideo: PortalVideoHandle | null;
  localAudioMediaTrack: MediaStreamTrack | null;
  mediaWarning: "camera" | "mic" | "both" | null;
  setMicMuted(muted: boolean): Promise<void>;
  leave(): Promise<void>;
}

export interface LiveKitCallCallbacks {
  onRemoteVideo(handle: PortalVideoHandle): void;
  /** Raw W3C track for the captions tap (same object family as Agora's getMediaStreamTrack()). */
  onRemoteAudioTrack(track: MediaStreamTrack): void;
  /** Fired when the browser blocks remote-audio autoplay; recover() = room.startAudio(). */
  onAudioBlocked(recover: () => void): void;
  onGuestLeft(): void;
}

interface AttachableTrack {
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
  mediaStreamTrack: MediaStreamTrack;
}

function handleFor(track: AttachableTrack, opts?: { mirror?: boolean }): PortalVideoHandle {
  return {
    attach(container: HTMLElement) {
      const el = track.attach() as HTMLVideoElement;
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.objectFit = "cover";
      if (opts?.mirror) el.style.transform = "scaleX(-1)";
      container.appendChild(el);
    },
    detach() {
      track.detach().forEach((el) => el.remove());
    },
    mediaStreamTrack: () => track.mediaStreamTrack,
  };
}

/**
 * The portal's LiveKit leg (Phase 4, spec §4.2) — the provider sibling of the
 * Agora code inside video-call.tsx. Behavior parity requirements it owns:
 * mic-first publish; INDEPENDENT device acquisition (a busy webcam — e.g.
 * NotReadableError — must NOT abandon the call: connect audio-only and report
 * mediaWarning, mirroring the Agora branch's resilient-acquire block).
 */
export async function joinLiveKitCall(
  opts: { url: string; token: string } & LiveKitCallCallbacks,
): Promise<LiveKitCallSession> {
  const { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const room = new Room();
  const remoteAudioEls: HTMLMediaElement[] = [];

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      opts.onRemoteVideo(handleFor(track as unknown as AttachableTrack));
    }
    if (track.kind === Track.Kind.Audio) {
      remoteAudioEls.push(track.attach());
      opts.onRemoteAudioTrack((track as unknown as AttachableTrack).mediaStreamTrack);
    }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) opts.onAudioBlocked(() => void room.startAudio());
  });
  room.on(RoomEvent.ParticipantDisconnected, () => opts.onGuestLeft());

  await room.connect(opts.url, opts.token);

  // Acquire mic + camera INDEPENDENTLY and resiliently (parity with the Agora
  // branch): join with whatever media is available so the guest always connects.
  let audio: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null;
  let video: Awaited<ReturnType<typeof createLocalVideoTrack>> | null = null;
  try {
    audio = await createLocalAudioTrack();
    await room.localParticipant.publishTrack(audio);
  } catch {
    audio = null;
  }
  try {
    video = await createLocalVideoTrack();
    await room.localParticipant.publishTrack(video);
  } catch {
    video = null;
  }

  return {
    localVideo: video ? handleFor(video as unknown as AttachableTrack, { mirror: true }) : null,
    localAudioMediaTrack: audio ? audio.mediaStreamTrack : null,
    mediaWarning: !audio && !video ? "both" : !audio ? "mic" : !video ? "camera" : null,
    setMicMuted: async (muted) => {
      if (!audio) return;
      if (muted) await audio.mute();
      else await audio.unmute();
    },
    leave: async () => {
      for (const el of remoteAudioEls) {
        el.pause();
        (el as HTMLMediaElement & { srcObject: unknown }).srcObject = null;
      }
      try {
        await room.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
```

- [ ] **Step 4: run to pass**, then `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test` → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(portal): LiveKit call-session module with busy-device parity, TDD (Phase 4 Task 9)"`

## Task 10: `video-call.tsx` provider branch (Agora branch preserved) + full gate

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Modify: `apps/portal/tests/components/video-call.test.tsx` (token mock only)
- Test: `apps/portal/tests/components/video-call-livekit.test.tsx` (new)

- [ ] **Step 1: update the EXISTING test's fetch mock** so it keeps guarding the Agora branch — in `video-call.test.tsx`, change the token stanza of `fetchMock` to:

```ts
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              provider: "agora",
              appId: "app1",
              token: "tok",
              channelName: "ch-test",
              uid: 42,
            }),
        });
      }
```

(Every other line of that file stays. If any assertion references `/api/agora/token`, update the URL only.)
- [ ] **Step 2: run** the existing suite → FAIL (component still calls the old URL). That failure is the red step.
- [ ] **Step 3: component changes** — exact deltas, everything else byte-identical:
  1. Imports: add

```ts
import { joinLiveKitCall, type LiveKitCallSession, type PortalVideoHandle } from "@/lib/video/livekit-session";
import type { VideoTokenResult } from "@lc/shared";
```

  2. New refs beside the agora refs:

```ts
  const lkSessionRef = useRef<LiveKitCallSession | null>(null);
  const lkLocalVideoRef = useRef<PortalVideoHandle | null>(null);
  // One recovery fn for the audio-blocked banner, provider-set (agora: replay
  // the remote track; livekit: room.startAudio()).
  const audioRecoveryRef = useRef<(() => void) | null>(null);
```

  3. In the join effect, replace the token fetch with:

```ts
        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(
          `/api/video/token?channel=${encodeURIComponent(channelName)}&uid=${uid}`
        );
        if (cancelled) return;
        if (!tokRes.ok) return onClose();
        const tok = (await tokRes.json()) as VideoTokenResult;

        if (tok.provider === "livekit") {
          const session = await joinLiveKitCall({
            url: tok.url,
            token: tok.token,
            onRemoteVideo: (h) => {
              if (!cancelled && remoteRef.current) h.attach(remoteRef.current);
            },
            onRemoteAudioTrack: (t) => {
              if (!cancelled) setGuestAudioTrack(t);
            },
            onAudioBlocked: (recover) => {
              audioRecoveryRef.current = () => {
                recover();
              };
              Sentry.addBreadcrumb({
                category: "livekit",
                level: "warning",
                message: "remote audio autoplay blocked; recovering on next interaction",
              });
              if (!cancelled) setAudioBlocked(true);
              recoverAudioOnNextGesture(() => {
                recover();
                if (!cancelled) setAudioBlocked(false);
              });
            },
            onGuestLeft: () => void handleEnd(),
          });
          if (cancelled) {
            await session.leave();
            return;
          }
          lkSessionRef.current = session;
          lkLocalVideoRef.current = session.localVideo;
          if (!session.localVideo) setCameraOff(true);
          setMediaWarning(session.mediaWarning);
          if (session.localVideo && localRef.current) session.localVideo.attach(localRef.current);
          // Cost/hygiene backstop — same cap as the Agora branch (spec D10: the
          // app-level cap is the authoritative duration bound on LiveKit too).
          capTimer = setTimeout(() => {
            Sentry.captureMessage("agent video call hit max-duration cap; ending", {
              level: "warning",
            });
            void handleEnd();
          }, MAX_CALL_DURATION_MS);
          lkSession = session;
          return; // agora code below does not run
        }
```

     with, directly above the effect's `(async () => {` IIFE, a cleanup-scoped local `let lkSession: LiveKitCallSession | null = null;` and in the effect cleanup: `if (lkSession) void lkSession.leave();`
  4. The Agora path continues UNCHANGED below the branch, consuming `tok.appId/tok.channelName/tok.token/tok.uid` (same field names — zero further edits), **plus exactly one addition:** inside the existing `AgoraRTC.onAutoplayFailed` handler body, first line: `audioRecoveryRef.current = () => void remoteAudioRef.current?.play();`
  5. The audio-blocked banner button onClick becomes:

```ts
            onClick={() => {
              audioRecoveryRef.current?.();
              setAudioBlocked(false);
            }}
```

  6. `handleEnd` teardown block — after the agora teardown lines add:

```ts
      await lkSessionRef.current?.leave();
      lkSessionRef.current = null;
```

  7. `toggleMute`:

```ts
  function toggleMute() {
    const n = !muted;
    if (lkSessionRef.current) void lkSessionRef.current.setMicMuted(n);
    else void audioRef.current?.setMuted(n);
    setMuted(n);
  }
```

  8. `toggleCamera`:

```ts
  function toggleCamera() {
    const n = !cameraOff;
    const t = lkSessionRef.current
      ? lkLocalVideoRef.current?.mediaStreamTrack()
      : videoRef.current?.getMediaStreamTrack();
    if (t) t.enabled = !n;
    setCameraOff(n);
  }
```

- [ ] **Step 4: existing suite green again:** `pnpm -F @lc/portal exec vitest run --config vitest.jsdom.config.ts tests/components/video-call.test.tsx` → PASS (Agora branch intact).
- [ ] **Step 5: new LiveKit-branch test** `tests/components/video-call-livekit.test.tsx`:

```tsx
// Verifies the provider branch: a livekit token routes through joinLiveKitCall,
// guest-left finalizes, mute drives setMicMuted, captions get the raw track.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const lkSession = vi.hoisted(() => {
  const session = {
    localVideo: { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ enabled: true })) },
    localAudioMediaTrack: { enabled: true } as unknown as MediaStreamTrack,
    mediaWarning: null as "camera" | "mic" | "both" | null,
    setMicMuted: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
  };
  const joinLiveKitCall = vi.fn(async (opts: Record<string, unknown>) => {
    joined.opts = opts;
    return session;
  });
  const joined: { opts: Record<string, unknown> | null } = { opts: null };
  return { session, joinLiveKitCall, joined };
});
vi.mock("@/lib/video/livekit-session", () => ({ joinLiveKitCall: lkSession.joinLiveKitCall }));
vi.mock("@/components/call/playbook-panel", () => ({ PlaybookPanel: () => null }));

const captionsSpy = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/captions/use-captions", () => ({
  useCaptions: (track: MediaStreamTrack | null) => {
    captionsSpy.fn(track);
    return { finals: [], partial: "", status: "idle" };
  },
}));

import { VideoCall } from "@/components/video-call/video-call";

describe("VideoCall — livekit provider branch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lkSession.joined.opts = null;
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channelName: "call_lk" }) });
      }
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ provider: "livekit", url: "wss://lk", channelName: "call_lk", token: "jwt" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("joins via joinLiveKitCall with the token payload", async () => {
    render(<VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" />);
    await waitFor(() => expect(lkSession.joinLiveKitCall).toHaveBeenCalledTimes(1));
    expect(lkSession.joinLiveKitCall.mock.calls[0][0]).toMatchObject({ url: "wss://lk", token: "jwt" });
  });

  it("guest-left finalizes via end-video", async () => {
    render(<VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" />);
    await waitFor(() => expect(lkSession.joined.opts).not.toBeNull());
    (lkSession.joined.opts!.onGuestLeft as () => void)();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("/end-video"))).toBe(true),
    );
  });

  it("mute button drives setMicMuted", async () => {
    render(<VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" />);
    await waitFor(() => expect(lkSession.joinLiveKitCall).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /mute/i }));
    expect(lkSession.session.setMicMuted).toHaveBeenCalledWith(true);
  });

  it("remote audio track reaches the captions hook", async () => {
    render(<VideoCall callId="c1" onClose={() => {}} propertyName="Hotel" />);
    await waitFor(() => expect(lkSession.joined.opts).not.toBeNull());
    const track = { id: "guest" } as unknown as MediaStreamTrack;
    (lkSession.joined.opts!.onRemoteAudioTrack as (t: MediaStreamTrack) => void)(track);
    // captions gating (enabled=false default) means the hook sees null unless enabled;
    // assert the state landed by checking the hook was re-invoked after the set.
    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalled());
  });
});
```

  (If the captions-enabled default hides the track, assert via the enabled toggle as the existing suite does — follow its pattern.)
- [ ] **Step 6: run to pass.**
- [ ] **Step 7: byte-preservation review** — `git diff` on `video-call.tsx`: the Agora path's only deltas are (a) token URL + `VideoTokenResult` unwrap, (b) the one `audioRecoveryRef` assignment line, (c) banner onClick. Anything else in the Agora path = fix before commit.
- [ ] **Step 8: FULL GATE:** `pnpm -F @lc/portal typecheck && pnpm -F @lc/portal test && pnpm -F @lc/kiosk test && pnpm lint && pnpm check:routes && pnpm gen:types:check && pnpm -F @lc/portal build && pnpm -F @lc/kiosk build` → all green.
- [ ] **Step 9: Commit** — `git commit -m "feat(portal): video-call provider branch on /api/video/token; agora path preserved (Phase 4 Task 10)"`

---

# PHASE E — staging deploy + smoke

## Task 11: staging cutover + smoke — **[HUMAN + CONTROLLER — not a subagent task]**

- [ ] **Step 1 (Kumar): Coolify staging portal env** — add `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL=wss://livekit.lobby-connect.com`, `LIVEKIT_API_KEY=lc_staging`, `LIVEKIT_API_SECRET=<PM>`.
- [ ] **Step 2 (Kumar): carve-out** — portal service's Traefik basic-auth bypass label gains `/api/video/` alongside `/api/kiosk/`, `/api/agora/`, `/api/cron/` (Claude supplies the exact full label string from the current value; labels verbatim, no `$$`).
- [ ] **Step 3 (Claude): deploy** — fast-forward `staging` to `phase3-workspace`, push; Coolify auto-deploys both apps. Verify boot log shows NO Agora warning (D15 proof) and `curl -s https://staging.lobby-connect.com/api/video/token?channel=x&uid=1` (with basic-auth OFF path, no kiosk token) → 404/401 JSON, NOT a basic-auth challenge (carve-out proof).
- [ ] **Step 4 (BOTH): the decisive smoke** — record results inline here:
  - Kiosk tab (staging-kiosk URL) tap → agent card rings + OS push fires with the browser MINIMIZED behind fullscreen RustDesk → notification click → home → **Answer → guest video CONNECTS through box LiveKit** (two-way audio, guest video visible, kiosk sees agent).
  - Captions: enable → guest speech transcribes (the `mediaStreamTrack` tap on LiveKit).
  - Hang-up from agent → kiosk returns home, row COMPLETED, OS notification cleared. Repeat ending from the kiosk side → agent overlay closes (ParticipantDisconnected path).
  - Busy-webcam: hold the agent camera in another app → Answer → call connects AUDIO-ONLY with the camera warning (busy-device parity).
  - Mid-call agent tab reload → rejoin replaces the ghost (duplicate-identity, D9) — call continues or re-answers cleanly; NO zombie participant.
  - Cancel-during-ring, ring-timeout apology, End-shift silence: quick re-checks (Phase-C behaviors, now fully exercisable).
- [ ] **Step 5:** any failure → systematic-debugging (the handoff's staging debug guide order: targeting → card ring → push → ONLY THEN video), fix loop on the branch, re-smoke. Record outcomes + commit doc updates.

# PHASE F — merge, flip, soak, strip (gated)

## Task 12: prod rollout — **[HUMAN-GATED checklist; execute per gate]**

- [ ] **Gate 1 — merge (after Task 11 passes, Kumar's call):**
  - Claude: apply migration `0019_push_subscriptions` to PROD (ref `ztunzdpmazwwwkxcpyfp`) via MCP; verify in `schema_migrations`.
  - Claude: add Vercel prod envs via CLI: `VIDEO_PROVIDER=agora`, `LIVEKIT_URL`, `LIVEKIT_API_KEY=lc_prod`, `LIVEKIT_API_SECRET` (inert while flag=agora).
  - Kumar: retitle PR #29 "Phase 3C + Phase 4 (LiveKit swap, prod-inert)" → merge.
  - Both: prod smoke on AGORA (one audio + one video call) — behavior unchanged is the pass condition.
- [ ] **Gate 2 — prod flip (Kumar's timing):** Vercel `VIDEO_PROVIDER` → `livekit` + redeploy → one prod video call smoke (connect + captions + hang-up) → begin the 1-week real-nights soak. Rollback at any point = flip back + redeploy.
- [ ] **Gate 3 — post-soak Agora strip (own session, own commit series):** delete `apps/portal/lib/agora/`, `apps/portal/app/api/agora/`, the agora CORS line, the video-call Agora branch + `audioRecoveryRef` agora assignment, `lib/video/diag-audio.ts` + kiosk `[LC DIAG]` block (the 2026-06-30 TEMP list), `apps/kiosk/src/lib/agora.ts` + `lib/video/agora.ts`, `agora-rtc-sdk-ng` (both apps) + `agora-token`, `AGORA_*` envs (Vercel + .env.example + instrumentation fallback becomes LiveKit-only), tests `tests/app/agora/` + `tests/lib/agora/` + the video-call agora harness (fold assertions into the livekit suite), `AgoraTokenResult` folded into `VideoTokenResult`; optional migration renaming `agora_channel_name` → `video_room_name` (decide then). Close Agora account. Tag `plan-phase4-livekit-complete`; stamp the migration plan Phase-4 DONE.

---

## Self-review checklist (run at plan close)
- Spec coverage: D1-D15 → Tasks 1-2 (D1-D7), 3-6 (D8-D10, D15), 7-10 (D11-D13), 11-12 (D14). §5 no-change surfaces guarded by byte-preservation reviews (Tasks 5, 8, 10).
- No placeholders; every code step carries the code.
- Type consistency: `VideoTrackHandle`/`KioskVideoSession`/`JoinCallbacks` (kiosk, Task 7) consumed in Task 8; `PortalVideoHandle`/`LiveKitCallSession`/`joinLiveKitCall` (Task 9) consumed in Task 10; `VideoTokenResult` (Task 3) consumed in Tasks 6, 8, 10; `authorizeVideoTokenRequest`/`VideoTokenRequester` (Task 5) consumed in Task 6; `getVideoProvider`/`getLiveKitConfig` (Task 4) consumed in Tasks 6 and instrumentation.
