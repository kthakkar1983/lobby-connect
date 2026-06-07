"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KIOSK_FIELDS, KIOSK_CTA_STYLES, type KioskContentInput, type KioskCtaStyle } from "@/lib/owner/kiosk";
import { updateKioskContentAction } from "./actions";

const LABELS: Record<(typeof KIOSK_FIELDS)[number], string> = {
  kiosk_welcome_heading: "Welcome heading",
  kiosk_welcome_message: "Welcome message",
  kiosk_checkin_time: "Check-in",
  kiosk_checkout_time: "Check-out",
  kiosk_wifi_network: "Wi-Fi network",
  kiosk_wifi_password: "Wi-Fi password",
  kiosk_breakfast_hours: "Breakfast hours",
  kiosk_apology_message: "Apology message",
};

const LONG_FIELDS = new Set(["kiosk_welcome_message", "kiosk_apology_message"]);

const STYLE_META: Record<KioskCtaStyle, { name: string; panel: string; greet: string }> = {
  warm: { name: "Warm", panel: "bg-accent-strong", greet: "text-foreground" },
  accent: { name: "Accent", panel: "bg-primary", greet: "text-foreground" },
  classic: { name: "Classic", panel: "bg-primary", greet: "text-accent-strong" },
};

type Props = { propertyId: string; initial: KioskContentInput; initialStyle: KioskCtaStyle };

export function KioskContentCard({ propertyId, initial, initialStyle }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<KioskContentInput>(initial);
  const [style, setStyle] = useState<KioskCtaStyle>(initialStyle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(field: (typeof KIOSK_FIELDS)[number], v: string) {
    setValues((prev) => ({ ...prev, [field]: v }));
  }

  function cancel() {
    setValues(initial);
    setStyle(initialStyle);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateKioskContentAction(propertyId, values, style);
      if (result.ok) {
        toast.success("Kiosk content updated");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">
          Guest-facing kiosk content
        </h2>
        {editing ? null : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Appearance</Label>
          <div className="flex gap-2">
            {KIOSK_CTA_STYLES.map((s) => {
              const meta = STYLE_META[s];
              const selected = style === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!editing}
                  onClick={() => setStyle(s)}
                  aria-pressed={selected}
                  className={`flex-1 rounded-input border-2 p-1.5 text-left transition-colors disabled:cursor-default ${
                    selected ? "border-accent-strong" : "border-border"
                  } ${editing ? "cursor-pointer" : ""}`}
                >
                  <span className="flex aspect-[16/10] overflow-hidden rounded-[6px] border border-border">
                    <span className="flex-[0_0_55%] bg-card p-1">
                      <span className={`block font-display text-[10px] leading-none ${meta.greet}`}>Hi.</span>
                    </span>
                    <span className={`flex-[0_0_45%] ${meta.panel}`} />
                  </span>
                  <span className="mt-1 block text-center text-xs font-medium text-foreground">
                    {meta.name}
                    {s === "warm" ? <span className="text-muted-foreground"> · default</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {KIOSK_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={field}>{LABELS[field]}</Label>
            {editing ? (
              LONG_FIELDS.has(field) ? (
                <Textarea
                  id={field}
                  rows={2}
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                />
              ) : (
                <Input
                  id={field}
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                />
              )
            ) : (
              <span className="text-sm text-foreground">
                {initial[field].length > 0 ? initial[field] : "—"}
              </span>
            )}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : null}
    </section>
  );
}
