"use client";

import { useLineStatus } from "@/lib/dashboard/line-status";
import { cn } from "@/lib/utils";

export function LineBeacon() {
  const { status } = useLineStatus();
  const up = status === "up";
  return (
    <span
      role="status"
      aria-label={up ? "Phone line connected" : "Phone line disconnected"}
      className={cn(
        "inline-block h-3 w-3 rounded-full",
        up
          ? "bg-live shadow-[0_0_0_3px_rgba(6,214,160,0.18)]"
          : "bg-destructive animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}
