import { requireRole } from "@/lib/auth/require-role";
import { getAgentCoverage } from "@/lib/auth/agent-coverage";
import { AppShell } from "@/components/app-shell";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const actor = await requireRole("AGENT");
  const { properties: coverage } = await getAgentCoverage(actor.id);

  return (
    <AppShell
      role="AGENT"
      fullName={actor.full_name}
      email={actor.email}
      coverage={coverage}
    >
      {children}
    </AppShell>
  );
}
