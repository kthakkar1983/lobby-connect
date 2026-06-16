"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  readonly fullName: string;
  readonly email: string;
  readonly role: "ADMIN" | "AGENT";
};

/**
 * The agent/admin account menu — an avatar-only trigger in the header that opens
 * the "boarding pass": a credential beside a perforated tear-off Sign-out stub,
 * the avatar wearing the brand connection-ring halo. The owner portal keeps its
 * own `UserMenu`.
 *
 * The sign-out form is rendered outside the menu item to dodge the Radix
 * pointer-event gotcha (see UserMenu for the full explanation).
 */
export function AccountMenu({ fullName, email, role }: Props) {
  const initials = fullName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={formRef}
        action="/auth/signout"
        method="post"
        className="hidden"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Avatar-only trigger; identity + sign-out live in the menu. */}
          <button
            type="button"
            aria-label={`Account menu, ${fullName}`}
            className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground outline-none transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {initials || "?"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[300px] overflow-hidden p-0"
        >
          <div className="flex items-stretch">
            <div className="min-w-0 flex-1 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                Lobby Connect
              </p>
              <div className="mt-3.5 flex items-center gap-3">
                <span className="lc-avatar-halo inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  {initials || "?"}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-medium leading-tight text-foreground">
                    {fullName}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {email}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-text">
                    {role}
                  </span>
                </div>
              </div>
            </div>
            <div
              className="my-2.5 border-l-2 border-dashed border-border"
              aria-hidden="true"
            />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }}
              className="w-[78px] shrink-0 cursor-pointer flex-col justify-center gap-1.5 rounded-none px-2 text-foreground"
            >
              <LogOut className="size-5" />
              <span className="text-xs">Sign out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
