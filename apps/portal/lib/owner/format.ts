import type { CallState, IncidentStatus, ProfileStatus } from "@lc/shared";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const CALL_STATE_LABELS: Record<CallState, string> = {
  RINGING: "Ringing",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NO_ANSWER: "Missed",
  FAILED: "Failed",
};

export function callStateLabel(state: CallState): string {
  return CALL_STATE_LABELS[state];
}

const CALL_STATE_VARIANTS: Record<CallState, BadgeVariant> = {
  RINGING: "secondary",
  IN_PROGRESS: "default",
  COMPLETED: "default",
  NO_ANSWER: "destructive",
  FAILED: "destructive",
};

export function callStateBadgeVariant(state: CallState): BadgeVariant {
  return CALL_STATE_VARIANTS[state];
}

export function incidentStatusLabel(status: IncidentStatus): string {
  return status === "RESOLVED" ? "Resolved" : "Open";
}

export function incidentStatusBadgeVariant(status: IncidentStatus): BadgeVariant {
  return status === "RESOLVED" ? "secondary" : "destructive";
}

const PRESENCE_LABELS: Record<ProfileStatus, string> = {
  AVAILABLE: "Available",
  ON_CALL: "On call",
  AWAY: "Away",
  OFFLINE: "Offline",
};

export function presenceLabel(status: ProfileStatus): string {
  return PRESENCE_LABELS[status];
}

const PRESENCE_DOTS: Record<ProfileStatus, string> = {
  AVAILABLE: "bg-emerald-500",
  ON_CALL: "bg-blue-500",
  AWAY: "bg-amber-500",
  OFFLINE: "bg-zinc-300",
};

export function presenceDotClass(status: ProfileStatus): string {
  return PRESENCE_DOTS[status];
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
