import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * On-brand error state (Stage 3, spec §4.2) for route error boundaries. Sibling
 * of EmptyState. Deliberately **navy/muted, not red** — a load/render error is
 * not an emergency, and red stays reserved for 911/destructive. Pairs an icon +
 * title + calm description + a recovery action (the retry button).
 */
export function ErrorState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-pill bg-muted text-primary"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
