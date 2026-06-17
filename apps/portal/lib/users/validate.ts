import type { Role } from "@lc/shared";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: ReadonlyArray<Role> = ["ADMIN", "AGENT", "OWNER"];

export function validateEmail(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter an email address.";
  if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
  return null;
}

export function validateFullName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter a full name.";
  if (trimmed.length > 120) {
    return "Full name must be 120 characters or fewer.";
  }
  return null;
}

export function validateRole(input: string): string | null {
  if (!VALID_ROLES.includes(input as Role)) return "Choose a valid role.";
  return null;
}

export function validatePassword(input: string): string | null {
  if (input.length < 8) return "Password must be at least 8 characters.";
  return null;
}
