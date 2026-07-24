"use client";

// Task 19 (shift-tracking plan): the admin timesheet table. Task 20 adds row
// actions (edit start/end, delete with a typed confirm) + an "Add shift"
// dialog, wired to `./actions`. Modeled on `admin/audit/audit-table.tsx` for
// the URL-driven filter state, and `admin/users/users-table.tsx` for the
// dialog/confirm/toast shape of the new mutations.

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Clock, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { DashTile } from "@/components/dashboard/dash-tile";
import { computeUtilization } from "@/lib/shifts/lifecycle";
import type { ShiftTimesheetRow, TimesheetRange } from "@/lib/shifts/query";
import { cn } from "@/lib/utils";
import { editShiftAction, deleteShiftAction, addShiftAction } from "./actions";

export type RosterEntry = {
  readonly id: string;
  readonly full_name: string;
  readonly role: string;
};

// ---------------------------------------------------------------------------
// Small pure display helpers (presentational only — no lib/ home needed for
// these; the metric math they format lives in lib/shifts/lifecycle.ts).
// ---------------------------------------------------------------------------

/** "8h 12m" / "45m" / "—" for a zero duration. */
function formatClocked(seconds: number): string {
  if (seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const SHIFT_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatShiftTime(iso: string): string {
  return SHIFT_TIME_FMT.format(new Date(iso));
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s.charAt(0) + s.slice(1).toLowerCase();
}

/** ISO instant -> a `datetime-local` input value in the BROWSER's local
 *  timezone ("YYYY-MM-DDTHH:mm"), since the input has no timezone of its own.
 *  Round-trips with `localInputToIso` below. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` input value -> ISO instant, interpreting the value as
 *  local time (per the ECMAScript Date-Time String spec, a date-time string
 *  with no offset parses as local — the same rule the input relies on to
 *  round-trip). Empty/unparseable input returns null (caller decides whether
 *  that's an error or "leave open"). */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const ENDED_BADGE: Record<
  "manual" | "lapsed" | "capped" | "open",
  { label: string; variant: "secondary" | "attention" | "live" }
> = {
  manual: { label: "Ended shift", variant: "secondary" },
  lapsed: { label: "Tab closed", variant: "attention" },
  capped: { label: "Capped 10h", variant: "attention" },
  open: { label: "On shift", variant: "live" },
};

function EndedBadge({ endedReason }: { readonly endedReason: ShiftTimesheetRow["endedReason"] }) {
  const key = endedReason ?? "open";
  const { label, variant } = ENDED_BADGE[key];
  return <Badge variant={variant}>{label}</Badge>;
}

function UtilizationBar({ value }: { readonly value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-text-muted">
        {clamped}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period selector — pushes ?from/?to (URL-driven, like audit-table's filter).
// "This week" sends only `from` (query layer defaults `to` to now); "Last
// week" sends both as fixed UTC-week boundaries; "Custom" reveals two date
// inputs. Fleet-wide report, no single property/timezone to anchor to, so
// week boundaries are UTC (mirrors query.ts's own range-default reasoning).
// ---------------------------------------------------------------------------

type PeriodValue = "default" | "this-week" | "last-week" | "custom";

function startOfUtcWeek(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return start.toISOString();
}

function PeriodSelector({ range }: { readonly range: TimesheetRange }) {
  const router = useRouter();
  const params = useSearchParams();

  const thisWeekFromIso = useMemo(() => startOfUtcWeek(new Date()), []);
  const lastWeekFromIso = useMemo(
    () => new Date(Date.parse(thisWeekFromIso) - 7 * 24 * 60 * 60 * 1000).toISOString(),
    [thisWeekFromIso],
  );

  const spFrom = params.get("from");
  const spTo = params.get("to");

  const detected: PeriodValue = !spFrom && !spTo
    ? "default"
    : spFrom === thisWeekFromIso && !spTo
      ? "this-week"
      : spFrom === lastWeekFromIso && spTo === thisWeekFromIso
        ? "last-week"
        : "custom";

  const [showCustom, setShowCustom] = useState(detected === "custom");
  const [customFrom, setCustomFrom] = useState(() => range.fromIso.slice(0, 10));
  const [customTo, setCustomTo] = useState(() => range.toIso.slice(0, 10));

  function navigate(next: URLSearchParams) {
    router.push(`/admin/shifts?${next.toString()}` as Route);
  }

  function setPeriod(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "default") {
      setShowCustom(false);
      sp.delete("from");
      sp.delete("to");
      navigate(sp);
      return;
    }
    if (value === "this-week") {
      setShowCustom(false);
      sp.set("from", thisWeekFromIso);
      sp.delete("to");
      navigate(sp);
      return;
    }
    if (value === "last-week") {
      setShowCustom(false);
      sp.set("from", lastWeekFromIso);
      sp.set("to", thisWeekFromIso);
      navigate(sp);
      return;
    }
    // "custom": reveal the date inputs; don't navigate until Apply.
    setShowCustom(true);
  }

  function applyCustomRange() {
    if (!customFrom || !customTo) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("from", new Date(`${customFrom}T00:00:00.000Z`).toISOString());
    sp.set("to", new Date(`${customTo}T23:59:59.999Z`).toISOString());
    navigate(sp);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={detected === "custom" ? "custom" : detected} onValueChange={setPeriod}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Last 7 days</SelectItem>
          <SelectItem value="this-week">This week</SelectItem>
          <SelectItem value="last-week">Last week</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-sm text-text-muted">{range.label}</span>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-40"
            aria-label="Range start"
          />
          <span className="text-text-muted">–</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-40"
            aria-label="Range end"
          />
          <Button size="sm" onClick={applyCustomRange}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ rows }: { readonly rows: ShiftTimesheetRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      clocked: acc.clocked + r.clockedSeconds,
      talk: acc.talk + r.talkSeconds,
      capped: acc.capped + (r.endedReason === "capped" ? 1 : 0),
    }),
    { clocked: 0, talk: 0, capped: 0 },
  );
  const fleetUtilization = computeUtilization(totals.clocked, totals.talk);

  return (
    <div className="flex flex-wrap gap-3">
      <DashTile value={formatClocked(totals.clocked)} label="Clocked" />
      <DashTile value={formatClocked(totals.talk)} label="Actual work" />
      <DashTile
        value={`${fleetUtilization}%`}
        label="Fleet utilization"
        tone={fleetUtilization >= 50 ? "live" : "default"}
      />
      <DashTile
        value={totals.capped}
        label="Shifts capped"
        tone={totals.capped > 0 ? "attention" : "default"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row actions — edit dialog + delete confirm (Task 20)
// ---------------------------------------------------------------------------

function EditShiftDialog({
  row,
  open,
  onOpenChange,
}: {
  readonly row: ShiftTimesheetRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState(() => toLocalInputValue(row.startedAt));
  const [end, setEnd] = useState(() => (row.endedAt ? toLocalInputValue(row.endedAt) : ""));

  function onSave() {
    setError(null);
    const startedAtIso = localInputToIso(start);
    if (!startedAtIso) {
      setError("Start time is invalid.");
      return;
    }
    if (end && !localInputToIso(end)) {
      setError("End time is invalid.");
      return;
    }
    const endedAtIso = end ? localInputToIso(end) : null;

    startTransition(async () => {
      const result = await editShiftAction({
        id: row.id,
        started_at: startedAtIso,
        ended_at: endedAtIso,
      });
      if (result.ok) {
        toast.success("Shift updated");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit shift: {row.name}</DialogTitle>
          <DialogDescription>
            Adjust the start and end time. Leave End blank to reopen this shift
            as on-duty.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-shift-start">Start</Label>
            <Input
              id="edit-shift-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-shift-end">End</Label>
            <Input
              id="edit-shift-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteShiftDialog({
  row,
  open,
  onOpenChange,
}: {
  readonly row: ShiftTimesheetRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmName, setConfirmName] = useState("");

  function onDelete() {
    startTransition(async () => {
      const result = await deleteShiftAction({ id: row.id });
      if (result.ok) {
        toast.success("Shift deleted");
        onOpenChange(false);
        setConfirmName("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setConfirmName("");
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently removes {row.name}&apos;s shift ({formatShiftTime(row.startedAt)} –{" "}
            {row.endedAt ? formatShiftTime(row.endedAt) : "open"}) and its break
            history. This can&apos;t be undone. Type their name to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={row.name}
          autoComplete="off"
          className="mt-2"
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={
              pending ||
              confirmName.trim().toLowerCase() !== row.name.trim().toLowerCase()
            }
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RowActions({ row }: { readonly row: ShiftTimesheetRow }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Shift actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditShiftDialog row={row} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteShiftDialog row={row} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Add shift dialog (Task 20) — backfills a missed/untracked shift.
// ---------------------------------------------------------------------------

function AddShiftDialog({ roster }: { readonly roster: ReadonlyArray<RosterEntry> }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>(roster[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  function onSubmit() {
    setError(null);
    if (!userId) {
      setError("Choose an agent.");
      return;
    }
    const startedAtIso = localInputToIso(start);
    if (!startedAtIso) {
      setError("Start time is invalid.");
      return;
    }
    const endedAtIso = localInputToIso(end);
    if (!endedAtIso) {
      setError("End time is invalid.");
      return;
    }

    startTransition(async () => {
      const result = await addShiftAction({
        user_id: userId,
        started_at: startedAtIso,
        ended_at: endedAtIso,
      });
      if (result.ok) {
        toast.success("Shift added");
        setOpen(false);
        setStart("");
        setEnd("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={roster.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Add shift
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a missed shift</DialogTitle>
          <DialogDescription>
            Backfill a completed shift that wasn&apos;t tracked automatically
            (e.g. the system was down).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-shift-user">Agent</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="add-shift-user">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {roster.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name} ({titleCase(u.role)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-shift-start">Start</Label>
            <Input
              id="add-shift-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-shift-end">End</Label>
            <Input
              id="add-shift-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? "Adding…" : "Add shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function ShiftsTable({
  rows,
  range,
  roster,
}: {
  readonly rows: ShiftTimesheetRow[];
  readonly range: TimesheetRange;
  readonly roster: ReadonlyArray<RosterEntry>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector range={range} />
        <AddShiftDialog roster={roster} />
      </div>
      <SummaryStrip rows={rows} />

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border">
          <EmptyState
            icon={Clock}
            title="No shifts in this period"
            description="Shifts open when an agent goes on duty and close on end-shift, a lapsed heartbeat, or the 10h cap."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Agent
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Shift
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Clocked
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Calls
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Talk
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Remote
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Utilization
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Ended
              </TableHead>
              <TableHead className="text-right font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="even:bg-muted/40">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground"
                      aria-hidden="true"
                    >
                      {initialsOf(row.name) || "?"}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{row.name}</div>
                      <div className="font-label text-[10px] uppercase tracking-[0.08em] text-text-muted">
                        {titleCase(row.role)}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn("whitespace-nowrap tabular-nums text-foreground")}>
                  {formatShiftTime(row.startedAt)} – {row.endedAt ? formatShiftTime(row.endedAt) : "—"}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">
                  {formatClocked(row.clockedSeconds)}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">{row.callCount}</TableCell>
                <TableCell className="tabular-nums text-foreground">
                  {formatClocked(row.talkSeconds)}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">{row.remoteCount}</TableCell>
                <TableCell>
                  <UtilizationBar value={row.utilization} />
                </TableCell>
                <TableCell>
                  <EndedBadge endedReason={row.endedReason} />
                </TableCell>
                <TableCell className="text-right">
                  <RowActions row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
