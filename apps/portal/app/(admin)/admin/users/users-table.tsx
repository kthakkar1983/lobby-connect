"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: "ADMIN" | "AGENT" | "OWNER";
  status: "AVAILABLE" | "ON_CALL" | "OFFLINE";
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

type Props = {
  readonly users: UserRow[];
  readonly actorId: string;
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function UsersTable({ users, actorId: _actorId }: Props) {
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <UserRound className="h-10 w-10 text-text-muted/40" />
        <p className="text-sm font-medium text-foreground">No users yet</p>
        <p className="text-xs text-text-muted">
          Invite your first user to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium text-foreground">
                  {u.full_name}
                </TableCell>
                <TableCell className="text-text-muted">{u.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{u.role}</Badge>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span
                      className={
                        u.status === "AVAILABLE"
                          ? "h-2 w-2 rounded-full bg-green-500"
                          : u.status === "ON_CALL"
                            ? "h-2 w-2 rounded-full bg-amber-500"
                            : "h-2 w-2 rounded-full bg-gray-300"
                      }
                    />
                    {u.status}
                  </span>
                </TableCell>
                <TableCell>{u.active ? "Yes" : "No"}</TableCell>
                <TableCell className="text-text-muted">
                  {relative(u.created_at)}
                </TableCell>
                <TableCell className="text-right text-text-muted">
                  {/* Actions menu added in Task 10 */}—
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
