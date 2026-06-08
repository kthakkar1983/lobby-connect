import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function SectionCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
