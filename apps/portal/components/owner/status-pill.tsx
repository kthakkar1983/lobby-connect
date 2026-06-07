import type { CallState, IncidentStatus } from "@lc/shared";
import { callPill, incidentPill } from "@/lib/owner/status-pill";
import { cn } from "@/lib/utils";

type Props =
  | { readonly kind: "call"; readonly status: CallState }
  | { readonly kind: "incident"; readonly status: IncidentStatus };

export function StatusPill(props: Props) {
  const pill = props.kind === "call" ? callPill(props.status) : incidentPill(props.status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em]",
        pill.className,
      )}
    >
      {pill.label}
    </span>
  );
}
