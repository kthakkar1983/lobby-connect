// Maps a Supabase sign-in AuthError to a specific user-facing message.
// `error.code` is unreliable at @supabase/supabase-js ^2.45, so the rate-limit
// branch keys on status 429 and the default covers invalid_credentials whether
// or not `code` is present. The deactivated-account case is NOT here — it is a
// post-success profiles.active check in signInAction.
//
// Forward-compat (spec): to later split "no account" vs "wrong password", add a
// profile-existence pre-check in signInAction and extend this mapper — no UI
// changes required.
import { copy } from "@/lib/copy";

export function mapSignInError(e: { code?: string; status?: number }): string {
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return copy.auth.rateLimit;
  }
  if (e.code === "email_not_confirmed") {
    return copy.auth.notConfirmed;
  }
  return copy.auth.invalidCredentials;
}
