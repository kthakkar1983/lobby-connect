import { requireRole } from "@/lib/auth/require-role";
import { AppShell } from "@/components/app-shell";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const actor = await requireRole("AGENT");

  return (
    <AppShell role="AGENT" fullName={actor.full_name} email={actor.email} operatorId={actor.operator_id}>
      {children}
    </AppShell>
  );
}
