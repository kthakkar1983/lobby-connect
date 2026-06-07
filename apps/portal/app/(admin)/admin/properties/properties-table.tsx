"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
          <Link href={"/admin/properties/new" as never}>
            <Plus className="mr-2 h-4 w-4" />
            New property
          </Link>
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-text-muted/40" />
          <p className="text-sm font-medium text-foreground">
            No properties yet
          </p>
          <p className="text-xs text-text-muted">
            Add your first property to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Routing #</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    <Link
                      href={`/admin/properties/${p.id}` as never}
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
                    <Badge variant={p.active ? "secondary" : "outline"}>
                      {p.active ? "Active" : "Inactive"}
                    </Badge>
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
