import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * On-brand zero-item state (Stage 3, spec §4.1): a muted icon chip, a title,
 * a one-line description, and an optional action. Plain (non-client) component
 * so it renders from both Server pages and client tables — it accepts the icon
 * as a component and renders it internally (server→server passing is fine; the
 * RSC fatal is only server→client, which this never does).
 *
 * `action` is a ReactNode (a pre-rendered <Button>), kept optional: only offer
 * one where the user can actually act (Stage 0 voice — no CTA without a target).
 */
export function EmptyState({
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
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-pill bg-muted text-muted-foreground"
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
