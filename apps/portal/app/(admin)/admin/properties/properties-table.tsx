"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { copy } from "@/lib/copy";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PropertyListRow = {
  id: string;
  name: string;
  timezone: string;
  routing_did: string | null;
  active: boolean;
  owner_name: string;
};

type Props = {
  readonly properties: PropertyListRow[];
};

export function PropertiesTable({ properties }: Props) {
  const [query, setQuery] = useState("");

  const filtered = properties.filter((p) => {
    if (!query) return true;
    return p.name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Button asChild>
          <Link href="/admin/properties/new">
            <Plus className="size-4" />
            New property
          </Link>
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            icon={Building2}
            title={copy.empty.adminProperties.title}
            description={copy.empty.adminProperties.description}
            action={
              <Button asChild>
                <Link href="/admin/properties/new">
                  <Plus className="size-4" />
                  New property
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="rounded-card border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Name</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Owner</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Timezone</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Routing #</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="even:bg-muted/40">
                  <TableCell className="font-medium text-foreground">
                    <Link
                      href={`/admin/properties/${p.id}` as Route}
                      className="hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.owner_name}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.timezone}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.routing_did ?? "—"}
                  </TableCell>
                  <TableCell>
                    {p.active ? (
                      <StatusBadge variant="live">Active</StatusBadge>
                    ) : (
                      <StatusBadge variant="muted">Inactive</StatusBadge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
