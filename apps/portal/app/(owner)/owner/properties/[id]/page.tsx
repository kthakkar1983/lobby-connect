import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  callStateLabel,
  callStateBadgeVariant,
  formatCallTime,
} from "@/lib/owner/format";
import { KioskContentCard } from "./kiosk-content-card";
import { PlaybookCard } from "./playbook-card";
import { KIOSK_FIELDS, type KioskContentInput, type KioskCtaStyle } from "@/lib/owner/kiosk";

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="text-sm text-foreground">
        {value && value.length > 0 ? value : "—"}
      </span>
    </div>
  );
}

export default async function OwnerPropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, name, timezone, property_phone_number, after_hours_support_phone, playbook_version, kiosk_welcome_heading, kiosk_welcome_message, kiosk_checkin_time, kiosk_checkout_time, kiosk_wifi_network, kiosk_wifi_password, kiosk_breakfast_hours, kiosk_apology_message, kiosk_cta_style",
    )
    .eq("id", id)
    .maybeSingle();

  if (!property) notFound();

  const kioskInitial = Object.fromEntries(
    KIOSK_FIELDS.map((f) => [f, (property[f] as string | null) ?? ""]),
  ) as KioskContentInput;

  const { data: recent } = await supabase
    .from("calls")
    .select("id, channel, state, ring_started_at")
    .eq("property_id", id)
    .order("ring_started_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/owner"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Home
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">{property.name}</h1>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Guest phone" value={property.property_phone_number} />
        <Field label="After-hours support" value={property.after_hours_support_phone} />
        <Field label="Timezone" value={property.timezone} />
      </section>

      <PlaybookCard propertyId={property.id} version={property.playbook_version} />

      <KioskContentCard
        propertyId={property.id}
        initial={kioskInitial}
        initialStyle={(property.kiosk_cta_style ?? "warm") as KioskCtaStyle}
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Recent calls</h2>
          <Link
            href={"/owner/calls" as never}
            className="text-sm text-primary hover:underline"
          >
            View all
          </Link>
        </div>
        {(recent ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No calls yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(recent ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/owner/calls/${c.id}` as never}
                  className="flex items-center justify-between py-2.5 text-sm hover:text-primary"
                >
                  <span className="text-foreground">
                    {formatCallTime(c.ring_started_at, property.timezone)}
                  </span>
                  <span className="flex items-center gap-2 text-text-muted">
                    {c.channel === "VIDEO" ? "Video" : "Audio"}
                    <Badge variant={callStateBadgeVariant(c.state)}>
                      {callStateLabel(c.state)}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
