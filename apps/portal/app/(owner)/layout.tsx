import { requireRole } from "@/lib/auth/require-role";

export default async function OwnerLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("OWNER");
  return <>{children}</>;
}
