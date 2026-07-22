import type { SignalStatus } from "@/lib/status/signals";

const DOT: Record<SignalStatus, string> = {
  ok: "bg-live",
  warn: "bg-attention",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/40",
};

const WORD: Record<SignalStatus, string> = { ok: "OK", warn: "Degraded", down: "Down", unknown: "Unknown" };

export function StatusCard({
  label,
  status,
  value,
  href,
}: {
  readonly label: string;
  readonly status: SignalStatus;
  readonly value: string;
  readonly href?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[status]}`}
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="ml-auto font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {WORD[status]}
        </span>
      </div>
      <span className="text-sm text-text-muted">{value}</span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary hover:underline"
        >
          View in Sentry
        </a>
      )}
    </div>
  );
}
