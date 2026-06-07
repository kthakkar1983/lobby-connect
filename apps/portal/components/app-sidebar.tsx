"use client";

import Link from "next/link";
import { Activity, Building2, ScrollText, Users } from "lucide-react";
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
import { Wordmark } from "@/components/brand/wordmark";

const NAV_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/status", label: "Status", icon: Activity },
] as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/admin"
          aria-label="Lobby Connect home"
          className="flex h-10 items-center px-2"
        >
          <Wordmark hideTextWhenCollapsed />
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
