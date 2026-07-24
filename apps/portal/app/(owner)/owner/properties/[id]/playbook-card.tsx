"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { validatePlaybookFile } from "@/lib/owner/playbook";

type Props = { propertyId: string; version: number | null };

export function PlaybookCard({ propertyId, version }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [viewing, setViewing] = useState(false);

  async function view() {
    // Open the tab synchronously, inside the click handler, so the browser keeps
    // it tied to the user gesture. Calling window.open() *after* the await is
    // treated as an unsolicited pop-up and silently blocked — the old bug.
    const win = window.open("about:blank", "_blank");
    setViewing(true);
    try {
      const res = await fetch(`/api/owner/properties/${propertyId}/playbook`);
      const body = await res.json();
      if (body.hasPlaybook && body.signedUrl) {
        if (win) {
          win.opener = null; // the signed-URL page can't reach back into the portal
          win.location.replace(body.signedUrl);
        } else {
          toast.error("Pop-up blocked. Allow pop-ups for this site to view the playbook.");
        }
      } else {
        win?.close();
        toast.error("No playbook uploaded yet.");
      }
    } catch {
      win?.close();
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
    <Card className="gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">Playbook</h2>
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
    </Card>
  );
}
