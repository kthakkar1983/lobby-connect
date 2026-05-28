import { requireRole } from "@/lib/auth/require-role";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("AGENT");
  return <>{children}</>;
}
