import { AuthShell } from "@/components/auth/auth-shell";

// Wraps the page routes under /auth (currently update-password) in the shared auth
// chrome so they match the (auth)-group pages. Route handlers in this segment
// (confirm, signout) are unaffected — layouts don't wrap route.ts handlers.
export default function AuthSegmentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <AuthShell>{children}</AuthShell>;
}
