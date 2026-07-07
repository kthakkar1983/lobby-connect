// RustDesk unattended-access credential validation (spec §3.5/D14).
// Follows the message-or-null convention of lib/properties/validate.ts.

const PEER_ID_RE = /^[\w-]{6,24}$/;

export function validatePeerId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!PEER_ID_RE.test(trimmed)) {
    return "Enter a valid RustDesk ID (6–24 characters, letters/digits/_/- only).";
  }
  return null;
}

export function validateUnattendedPassword(raw: string): string | null {
  if (raw !== raw.trim() || raw.length < 8 || raw.length > 128) {
    return "Password must be 8–128 characters, with no leading or trailing spaces.";
  }
  return null;
}
