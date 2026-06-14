import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertyForm } from "../property-form";
import { AssignmentCard, type AgentOption } from "./assignment-card";
import { KioskLinkCard } from "./kiosk-link-card";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, name, timezone, owner_user_id, routing_did, property_phone_number, after_hours_support_phone, kiosk_welcome_message, kiosk_apology_message, active",
    )
    .eq("id", id)
    .maybeSingle();

  if (!property) {
    notFound();
  }

  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("operator_id", actor.operator_id)
    .eq("role", "OWNER")
    .eq("active", true)
    .order("full_name");

  // Assignable primary agents: active AGENTs and ADMINs in this operator.
  const { data: agents } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("operator_id", actor.operator_id)
    .in("role", ["AGENT", "ADMIN"])
    .eq("active", true)
    .order("full_name");

  // Current active assignment (effective_until IS NULL).
  const { data: assignment } = await supabase
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("operator_id", actor.operator_id)
    .eq("property_id", id)
    .is("effective_until", null)
    .maybeSingle();

  const currentAgentId = assignment?.primary_agent_id ?? null;

  // Separate name lookup (2-query pattern): robust even if the assigned agent
  // was later deactivated and so is absent from the assignable list above.
  let currentAgentName: string | null = null;
  if (currentAgentId) {
    const { data: agent } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", currentAgentId)
      .maybeSingle();
    currentAgentName = agent?.full_name ?? null;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/properties"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Properties
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          {property.name}
        </h1>
      </div>

      <PropertyForm mode="edit" owners={owners ?? []} property={property} />

      <AssignmentCard
        propertyId={property.id}
        currentAgentId={currentAgentId}
        currentAgentName={currentAgentName}
        agents={(agents ?? []) as AgentOption[]}
      />

      <KioskLinkCard propertyId={property.id} />
    </div>
  );
}
