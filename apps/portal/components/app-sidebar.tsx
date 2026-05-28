import Link from "next/link";
import { Building2, Settings, Users, UsersRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavItem } from "@/components/nav-item";

const NAV_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/assignments", label: "Assignments", icon: UsersRound },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/admin"
          className="flex h-10 items-center gap-2 px-2 font-semibold text-foreground"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground text-xs">
            LC
          </span>
          <span className="group-data-[collapsible=icon]:hidden">
            Lobby Connect
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
