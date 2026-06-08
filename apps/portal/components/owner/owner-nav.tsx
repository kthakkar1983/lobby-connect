"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Phone, Siren, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeOwnerTab, type OwnerTab } from "@/lib/owner/nav";

type Tab = { readonly tab: OwnerTab; readonly href: string; readonly label: string; readonly icon: LucideIcon };

const TABS: readonly Tab[] = [
  { tab: "home", href: "/owner", label: "Home", icon: Home },
  { tab: "calls", href: "/owner/calls", label: "Calls", icon: Phone },
  { tab: "incidents", href: "/owner/incidents", label: "Incidents", icon: Siren },
];

export function OwnerTopNav() {
  const active = activeOwnerTab(usePathname());
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
      {TABS.map(({ tab, href, label }) => (
        <Link
          key={tab}
          href={href as never}
          aria-current={active === tab ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === tab
              ? "bg-accent/10 text-accent-strong"
              : "text-text-muted hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function OwnerBottomNav() {
  const active = activeOwnerTab(usePathname());
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card md:hidden"
      aria-label="Primary"
    >
      {TABS.map(({ tab, href, label, icon: Icon }) => (
        <Link
          key={tab}
          href={href as never}
          aria-current={active === tab ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
            active === tab ? "text-accent-text" : "text-text-muted",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
