import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { requireApiActor } from "@/lib/auth/api-actor";

export const runtime = "nodejs";

// TEMPORARY diagnostic sink — remove with the client probe once the "agent can't
// hear guest on the cold first call" cause is pinned.
//
// The agent video overlay POSTs its guest-audio energy reading here so it can be
// read off SERVER Sentry + Vercel logs — no agent DevTools, and not dependent on
// the (apparently unwired) client Sentry DSN. The POST arriving AT ALL also proves
// the agent's browser is on the fresh build (the old bundle doesn't call this).
export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* best-effort diagnostic — ignore a malformed body */
  }

  const build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const msg =
    `DIAG guest-audio: phase=${body.phase ?? "?"} energy=${body.energy ?? "?"} ` +
    `autoplayBlocked=${body.autoplayBlocked ?? "?"} maxVolume=${body.maxVolume ?? "?"} serverBuild=${build}`;
  console.log("[LC DIAG]", msg, body);
  Sentry.captureMessage(msg, { level: "warning", extra: { ...body, serverBuild: build } });

  return NextResponse.json({ ok: true });
}
