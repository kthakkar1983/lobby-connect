import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Playbook signed-URL lifetime — one hour, enough for a single call. */
export const PLAYBOOK_SIGNED_URL_TTL = 3600;

/**
 * Create a short-lived signed URL for a property's playbook PDF in the private
 * `playbooks` bucket. Returns null on any storage error or missing URL, so both
 * the agent and owner routes share one implementation (D9).
 */
export async function createPlaybookSignedUrl(
  admin: SupabaseClient,
  path: string,
  ttl: number = PLAYBOOK_SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from("playbooks")
    .createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
