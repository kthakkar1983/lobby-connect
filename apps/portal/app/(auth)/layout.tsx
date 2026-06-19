import { AuthShell } from "@/components/auth/auth-shell";

export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <AuthShell>{children}</AuthShell>;
}
