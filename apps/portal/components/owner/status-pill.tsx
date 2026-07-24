import type { CallState, CallDirection, IncidentStatus } from "@lc/shared";
import { callPill, incidentPill } from "@/lib/owner/status-pill";
import { StatusBadge } from "@/components/ui/status-badge";

type Props =
  | { readonly kind: "call"; readonly status: CallState; readonly direction?: CallDirection }
  | { readonly kind: "incident"; readonly status: IncidentStatus };

export function StatusPill(props: Props) {
  const pill = props.kind === "call" ? callPill(props.status, props.direction) : incidentPill(props.status);
  return <StatusBadge variant={pill.variant}>{pill.label}</StatusBadge>;
}
