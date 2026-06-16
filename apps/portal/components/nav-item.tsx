"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Props = {
  readonly href: Route;
  readonly label: string;
  readonly icon: LucideIcon;
  // Index routes (/admin, /agent) must match exactly — otherwise startsWith
  // would mark them active for every nested route under them.
  readonly exact?: boolean;
};

export function NavItem({ href, label, icon: Icon, exact = false }: Props) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        // On the navy rail: muted-cream idle, lifted-navy hover (cva default),
        // teal-wash + full-cream + teal icon when active (teal = the nav role).
        className="text-sidebar-foreground/70 data-[active=true]:bg-accent/20 data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[active=true]:[&>svg]:text-accent"
      >
        <Link href={href}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
