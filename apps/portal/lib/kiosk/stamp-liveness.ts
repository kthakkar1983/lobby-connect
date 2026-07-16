import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Upsert kiosks.last_seen_at = now() for a property, resolving operator_id on
 * first insert. Best-effort (callers detach it via after()). Service-role
 * client only — kiosks has no client-write RLS policy (0023).
 */
export async function stampKioskLiveness(admin: Admin, propertyId: string): Promise<void> {
  const { data: property } = await admin
    .from("properties")
    .select("operator_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) return;

  await admin.from("kiosks").upsert(
    {
      operator_id: property.operator_id,
      property_id: propertyId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "property_id" },
  );
}
