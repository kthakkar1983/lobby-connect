import { requireRole } from "@/lib/auth/require-role";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("ADMIN");

  return (
    <AppShell role="ADMIN" fullName={profile.full_name} email={profile.email} operatorId={profile.operator_id}>
      {children}
    </AppShell>
  );
}
