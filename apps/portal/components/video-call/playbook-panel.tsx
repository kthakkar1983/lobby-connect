"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

interface PlaybookState {
  status: "loading" | "no-playbook" | "ready" | "error";
  signedUrl?: string;
}

export function PlaybookPanel({ callId }: { callId: string }) {
  const [state, setState] = useState<PlaybookState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calls/${callId}/playbook`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const body = (await res.json()) as { hasPlaybook: boolean; signedUrl?: string };
        if (!cancelled) {
          setState(
            body.hasPlaybook && body.signedUrl
              ? { status: "ready", signedUrl: body.signedUrl }
              : { status: "no-playbook" }
          );
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  if (state.status === "loading") {
    return (
      <div className="flex basis-3/5 flex-col gap-2 bg-background p-4 border-l border-border">
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        {[100, 95, 88, 70, 100, 80].map((w, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (state.status === "no-playbook") {
    return (
      <div className="flex basis-3/5 items-center justify-center border-l border-border bg-card text-sm text-text-muted">
        No playbook uploaded yet.
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex basis-3/5 items-center justify-center border-l border-border bg-card text-sm text-text-muted">
        Playbook unavailable.
      </div>
    );
  }

  return (
    <div className="flex basis-3/5 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">Playbook</span>
        <a
          href={state.signedUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-text-muted hover:text-foreground"
        >
          <ExternalLink size={12} />
          Open in new tab
        </a>
      </div>
      {/* No `sandbox` attribute: Chrome's built-in PDF viewer is an out-of-process
          iframe that refuses to load inside a sandboxed frame — it renders a
          broken-document icon even with `allow-scripts allow-same-origin` (verified
          2026-06-02). The PDF is a short-lived signed URL from our own (cross-origin)
          Supabase Storage, so the same-origin policy already stops it from scripting
          the portal. Do not re-add `sandbox` here without re-testing PDF rendering. */}
      <iframe src={state.signedUrl} className="min-h-0 flex-1 border-0" title="Property playbook" />
    </div>
  );
}
