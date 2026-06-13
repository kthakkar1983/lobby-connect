import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { UserMenu } from "@/components/user-menu";
import { OwnerTopNav, OwnerBottomNav } from "@/components/owner/owner-nav";
import { Wordmark } from "@/components/brand/wordmark";
import { SkipLink } from "@/components/skip-link";

export default async function OwnerLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("OWNER");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink />
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/owner">
              <Wordmark />
            </Link>
            <OwnerTopNav />
          </div>
          <UserMenu
            fullName={profile.full_name}
            email={profile.email}
            role="OWNER"
          />
        </div>
        <div className="h-px w-full bg-[image:var(--gradient-seam)]" aria-hidden="true" />
      </header>
      <main id="main" className="flex-1 px-4 py-6 pb-24 md:pb-6">{children}</main>
      <OwnerBottomNav />
    </div>
  );
}
