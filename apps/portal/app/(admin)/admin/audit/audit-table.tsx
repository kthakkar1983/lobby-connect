"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";

export type AuditTableRow = {
  id: string;
  actorName: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};

export function AuditTable({
  rows,
  actions,
  activeAction,
  limit,
  hasMore,
}: {
  readonly rows: AuditTableRow[];
  readonly actions: readonly string[];
  readonly activeAction: string | null;
  readonly limit: number;
  readonly hasMore: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setAction(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("action");
    else sp.set("action", value);
    sp.delete("limit");
    router.push(`/admin/audit?${sp.toString()}` as never);
  }

  function loadMore() {
    const sp = new URLSearchParams(params.toString());
    sp.set("limit", String(limit + 50));
    router.push(`/admin/audit?${sp.toString()}` as never);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Action</span>
        <Select value={activeAction ?? "all"} onValueChange={setAction}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border">
          <EmptyState
            icon={ScrollText}
            title={copy.empty.adminAudit.title}
            description={copy.empty.adminAudit.description}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Time</TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Actor</TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Action</TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Entity</TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="even:bg-muted/40">
                <TableCell
                  className="whitespace-nowrap text-text-muted"
                  title={new Date(r.created_at).toLocaleString()}
                >
                  {new Date(r.created_at).toLocaleString()}
                </TableCell>
                <TableCell>{r.actorName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.action}</Badge>
                </TableCell>
                <TableCell className="text-text-muted">
                  {r.entity_type}
                  {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}
                </TableCell>
                <TableCell>
                  {r.details ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-primary">
                        view
                      </summary>
                      <pre className="mt-1 max-w-md overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          className="self-center text-sm text-primary hover:underline"
        >
          Load more
        </button>
      )}
    </div>
  );
}
