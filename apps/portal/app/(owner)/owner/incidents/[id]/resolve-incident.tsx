"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { resolveIncidentAction } from "./actions";

type Props = { incidentId: string; status: string };

export function ResolveIncident({ incidentId, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== "OPEN") return null;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await resolveIncidentAction(incidentId, note);
      if (result.ok) {
        toast.success("Incident resolved");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      {open ? (
        <>
          <Label htmlFor="resolution_note">Resolution note (optional)</Label>
          <Textarea
            id="resolution_note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened / how it was handled"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button onClick={confirm} disabled={pending}>
              {pending ? "Resolving…" : "Confirm resolve"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={() => setOpen(true)}>Resolve incident</Button>
      )}
    </section>
  );
}
