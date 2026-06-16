"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  readonly fullName: string;
  readonly email: string;
  readonly role: "ADMIN" | "AGENT" | "OWNER";
};

// The sign-out form lives OUTSIDE the DropdownMenuItem on purpose. Putting
// `<form><button type=submit/></form>` inside `<DropdownMenuItem asChild>` is a
// known Radix gotcha: the item's pointer-event handling intercepts the click
// before the browser dispatches the form's submit event, so the POST never
// fires. Instead we render a hidden form and trigger it via requestSubmit() in
// the item's onSelect (with preventDefault so Radix doesn't close + unmount the
// menu before navigation starts).
//
// This is the owner portal's account menu. The agent/admin shell uses the
// header `AccountMenu` (the "boarding pass") instead.
export function UserMenu({ fullName, email, role }: Props) {
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
          <Button variant="outline" size="sm" className="gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
              {initials || "?"}
            </span>
            <span className="hidden md:inline">{fullName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-sm font-medium">{fullName}</span>
            <span className="text-xs text-text-muted">{email}</span>
            <Badge variant="secondary" className="mt-1 w-fit">
              {role}
            </Badge>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
