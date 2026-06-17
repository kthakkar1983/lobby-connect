"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  Activity,
  Building2,
  LayoutDashboard,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavItem } from "@/components/nav-item";
import { LogoLockup, LogoMark } from "@/components/brand/wordmark";

type NavEntry = {
  readonly href: Route;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly exact?: boolean;
};

const ADMIN_NAV: readonly NavEntry[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/status", label: "Status", icon: Activity },
];

const AGENT_NAV: readonly NavEntry[] = [
  { href: "/agent", label: "Dashboard", icon: LayoutDashboard, exact: true },
];

export function AppSidebar({ role }: { readonly role: "ADMIN" | "AGENT" }) {
  const { setOpen } = useSidebar();
  const navItems = role === "ADMIN" ? ADMIN_NAV : AGENT_NAV;
  const home: Route = role === "ADMIN" ? "/admin" : "/agent";

  // Hover-expand with intent delay (locked decision #5): the rail rests
  // collapsed and opens only after the pointer lingers, so brushing past it
  // doesn't trigger it. Keyboard focus expands it too (the header has no toggle).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 450 : 180);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Sidebar
      collapsible="icon"
      onMouseEnter={() => schedule(true)}
      onMouseLeave={() => schedule(false)}
      onFocus={() => schedule(true)}
      onBlur={(e) => {
        // Only collapse when focus leaves the rail entirely (not when tabbing
        // between its own nav items).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          schedule(false);
        }
      }}
    >
      <SidebarHeader>
        <Link
          href={home}
          aria-label="Lobby Connect home"
          className="flex h-12 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          {/* Reversed for the navy rail. Expanded: full lockup; collapsed: the mark. */}
          <LogoLockup
            title=""
            onDark
            className="h-10 group-data-[collapsible=icon]:hidden"
          />
          <LogoMark
            onDark
            className="hidden group-data-[collapsible=icon]:block"
          />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
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
