import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em]",
  {
    variants: {
      variant: {
        live: "bg-live/15 text-live-foreground",
        accent: "bg-accent/15 text-accent-text",
        attention: "bg-attention/15 text-attention-text",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "muted" },
  },
);

const DOT: Record<NonNullable<VariantProps<typeof statusBadgeVariants>["variant"]>, string> = {
  live: "bg-live",
  accent: "bg-accent",
  attention: "bg-attention",
  muted: "bg-muted-foreground/50",
};

export function StatusBadge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof statusBadgeVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="status-badge"
      data-variant={variant ?? "muted"}
      className={cn(statusBadgeVariants({ variant }), className)}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT[variant ?? "muted"])} />
      ) : null}
      {children}
    </span>
  );
}

export { statusBadgeVariants };
