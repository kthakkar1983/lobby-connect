import { requireRole } from "@/lib/auth/require-role";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { createServerClient } from "@/lib/supabase/server";
import { Softphone } from "@/components/softphone/softphone";

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("ADMIN");

  // requireRole returns id/role/operator_id/active but we also need name + email
  // for the header. One extra small query — cheap and avoids changing the
  // requireRole signature for one consumer.
  const supabase = await createServerClient();
  const { data: identity } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <SidebarTrigger />
          <UserMenu
            fullName={identity?.full_name ?? ""}
            email={identity?.email ?? ""}
            role={profile.role as "ADMIN"}
          />
        </header>
        <div className="border-b border-border px-4 pb-4 pt-3">
          <Softphone role="ADMIN" />
        </div>
        <div className="p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
