// Gate 3.0 prototype route — temporary spike surface, judged live by Kumar +
// the pilot agent, then superseded by the real Phase-3 tile. Lives outside the
// (agent)/(admin) groups because BOTH roles test it and it must not mount the
// app shell (whose Softphone/VideoCallHost own the real ring paths); the gate
// below mirrors requireRole, which only accepts a single role.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionProfile } from "@/lib/auth/session";
import { DutyTilePrototype } from "@/components/duty-tile/duty-tile-prototype";

export const metadata: Metadata = {
  title: "Deskphone tile prototype — Lobby Connect",
};

export default async function DutyTilePrototypePage() {
  const profile = await getSessionProfile();

  if (!profile || !profile.active) redirect("/sign-in");
  if (profile.must_change_password) redirect("/onboarding");
  if (profile.role !== "AGENT" && profile.role !== "ADMIN") redirect("/");

  return <DutyTilePrototype agentName={profile.full_name} />;
}
