"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { validatePlaybookFile } from "@/lib/owner/playbook";

type Props = { propertyId: string; version: number | null };

export function PlaybookCard({ propertyId, version }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [viewing, setViewing] = useState(false);

  async function view() {
    setViewing(true);
    try {
      const res = await fetch(`/api/owner/properties/${propertyId}/playbook`);
      const body = await res.json();
      if (body.hasPlaybook && body.signedUrl) {
        window.open(body.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("No playbook uploaded yet.");
      }
    } catch {
      toast.error("Couldn't open the playbook.");
    } finally {
      setViewing(false);
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    const clientError = validatePlaybookFile({ type: file.type, size: file.size });
    if (clientError) {
      toast.error(clientError);
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/owner/properties/${propertyId}/playbook`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        toast.success("Playbook uploaded");
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Upload failed.");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Playbook</h2>
        <span className="text-sm text-text-muted">
          {version ? `v${version}` : "No playbook yet"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={view} disabled={viewing || !version}>
          {viewing ? "Opening…" : "View"}
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={pending}>
          {pending ? "Uploading…" : version ? "Replace" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPick}
        />
      </div>
    </section>
  );
}
