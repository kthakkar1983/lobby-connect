import { requireRole } from "@/lib/auth/require-role";

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("ADMIN");
  return <>{children}</>;
}
