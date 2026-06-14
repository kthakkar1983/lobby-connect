import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertyForm } from "../property-form";

export default async function NewPropertyPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("operator_id", actor.operator_id)
    .eq("role", "OWNER")
    .eq("active", true)
    .order("full_name");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/properties"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Properties
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          New property
        </h1>
      </div>

      <PropertyForm mode="create" owners={owners ?? []} />
    </div>
  );
}
