"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setPrimaryAgentAction, unassignPrimaryAgentAction } from "../actions";

export type AgentOption = { id: string; full_name: string; role: string };

type Props = {
  propertyId: string;
  currentAgentId: string | null;
  currentAgentName: string | null;
  agents: AgentOption[];
};

export function AssignmentCard({
  propertyId,
  currentAgentId,
  currentAgentName,
  agents,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(currentAgentId ?? "");

  function onSave() {
    setError(null);
    if (!selected) {
      setError("Choose an agent.");
      return;
    }
    startTransition(async () => {
      const result = await setPrimaryAgentAction(propertyId, selected);
      if (result.ok) {
        toast.success("Primary agent updated");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onUnassign() {
    setError(null);
    startTransition(async () => {
      const result = await unassignPrimaryAgentAction(propertyId);
      if (result.ok) {
        toast.success("Agent unassigned");
        setSelected("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <UserCog className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium text-foreground">Primary agent</h2>
      </div>
      <p className="text-xs text-text-muted">
        {currentAgentName
          ? `Currently assigned to ${currentAgentName}. This person is dialed first when a guest calls.`
          : "No agent assigned. Calls to this property won't reach a primary agent until one is assigned."}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent">Agent</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="agent">
            <SelectValue placeholder="Choose an agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.full_name} ({a.role === "ADMIN" ? "Admin" : "Agent"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onSave}
          disabled={pending || selected === (currentAgentId ?? "")}
        >
          {pending ? "Saving…" : "Save assignment"}
        </Button>
        {currentAgentId ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Unassign
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unassign the primary agent?</AlertDialogTitle>
                <AlertDialogDescription>
                  Calls to this property won&apos;t reach a primary agent until
                  you assign a new one. You can reassign at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onUnassign} disabled={pending}>
                  Unassign
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </section>
  );
}
