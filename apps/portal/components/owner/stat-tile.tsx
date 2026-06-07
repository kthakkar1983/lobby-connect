import { cn } from "@/lib/utils";

export function StatTile({
  value,
  label,
  alert = false,
}: {
  readonly value: string | number;
  readonly label: string;
  readonly alert?: boolean;
}) {
  return (
    <div className="flex-1 rounded-input bg-background px-3 py-2">
      <div className={cn("font-mono text-lg font-semibold", alert ? "text-accent-strong" : "text-foreground")}>
        {value}
      </div>
      <div className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</div>
    </div>
  );
}
