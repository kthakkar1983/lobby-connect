"use client";

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateKioskLinkAction } from "../actions";
import { SectionCard } from "@/components/owner/section-card";

export function KioskLinkCard({ propertyId }: { readonly propertyId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    const res = await generateKioskLinkAction(propertyId);
    setLoading(false);
    if (res.ok) setUrl(res.url);
    else setError(res.error);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy manually.");
    }
  }

  return (
    <SectionCard
      title="Kiosk device link"
      action={
        !url ? (
          <Button type="button" size="sm" onClick={generate} disabled={loading}>
            <Link2 className="h-4 w-4" />
            {loading ? "Generating…" : "Generate link"}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          Open this URL once on the tablet to pair it to this property. It carries
          a long-lived signed token — treat it like a password.
        </p>

        {url ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              Generating a new link doesn&apos;t invalidate older ones (tokens are
              long-lived). Re-pair only if the tablet was lost or reset.
            </p>
          </>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </SectionCard>
  );
}
