import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  value, label, alert = false, href,
}: {
  readonly value: string | number;
  readonly label: string;
  readonly alert?: boolean;
  readonly href?: Route;
}) {
  const body = (
    <>
      <div className={cn("font-mono text-lg font-semibold", alert ? "text-attention-text" : "text-foreground")}>{value}</div>
      <div className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="group flex-1 rounded-input bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">{body}</div>
          <ChevronRight className="size-3.5 shrink-0 text-text-muted transition-colors group-hover:text-accent-text" aria-hidden="true" />
        </div>
      </Link>
    );
  }
  return <div className="flex-1 rounded-input bg-background px-3 py-2">{body}</div>;
}
