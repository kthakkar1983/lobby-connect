import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { SectionCard } from "@/components/owner/section-card";
import { CallRow, type CallRowData } from "@/components/owner/call-row";
import { presenceLabel, presenceDotClass } from "@/lib/owner/format";
import { cn } from "@/lib/utils";
import { KioskContentCard } from "./kiosk-content-card";
import { PlaybookCard } from "./playbook-card";
import { KIOSK_FIELDS, type KioskContentInput, type KioskCtaStyle } from "@/lib/owner/kiosk";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import type { ProfileStatus } from "@lc/shared";

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">
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

  // Assigned agent + presence (2-query pattern).
  const { data: assignment } = await supabase
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", id)
    .is("effective_until", null)
    .maybeSingle();
  let agent: { full_name: string; status: ProfileStatus } | null = null;
  if (assignment?.primary_agent_id) {
    const { data: a } = await supabase
      .from("profiles")
      .select("full_name, status")
      .eq("id", assignment.primary_agent_id)
      .maybeSingle();
    if (a) agent = { full_name: a.full_name, status: a.status };
  }

  const { data: recent } = await supabase
    .from("calls")
    .select("id, channel, state, ring_started_at")
    .eq("property_id", id)
    .order("ring_started_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Home
      </Link>

      <div>
        <h1 className="font-display text-3xl text-foreground">{property.name}</h1>
        <p className="mt-1 text-sm text-text-muted">{property.timezone}</p>
        {agent ? (
          <span className="mt-2 flex items-center gap-2 text-sm text-text-muted">
            <span className={cn("size-2 rounded-full", presenceDotClass(agent.status))} aria-hidden="true" />
            {agent.full_name} · {presenceLabel(agent.status)}
          </span>
        ) : (
          <span className="mt-2 block text-sm text-text-muted">No agent assigned</span>
        )}
      </div>

      <SectionCard title="Property">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest phone" value={property.property_phone_number} />
          <Field label="After-hours support" value={property.after_hours_support_phone} />
          <Field label="Timezone" value={property.timezone} />
        </div>
      </SectionCard>

      <PlaybookCard propertyId={property.id} version={property.playbook_version} />

      <KioskContentCard
        propertyId={property.id}
        initial={kioskInitial}
        initialStyle={(property.kiosk_cta_style ?? "warm") as KioskCtaStyle}
      />

      <SectionCard
        title="Recent calls"
        action={
          <Link href={"/owner/calls" as never} className="text-sm font-medium text-accent-strong hover:underline">
            View all
          </Link>
        }
      >
        {(recent ?? []).length === 0 ? (
          <EmptyState
            icon={Phone}
            title={copy.empty.ownerPropertyCalls.title}
            description={copy.empty.ownerPropertyCalls.description}
            className="py-8"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {(recent ?? []).map((c) => {
              const item: CallRowData = {
                id: c.id,
                channel: c.channel,
                state: c.state,
                ring_started_at: c.ring_started_at,
                duration_seconds: null,
                timeZone: property.timezone,
                secondary: c.channel === "VIDEO" ? "Video" : "Audio",
              };
              return <CallRow key={c.id} call={item} />;
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
