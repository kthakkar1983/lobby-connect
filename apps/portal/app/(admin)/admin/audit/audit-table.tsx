"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
  readonly actions: string[];
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
        <p className="rounded-lg border border-border py-16 text-center text-sm text-text-muted">
          No audit events.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
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
