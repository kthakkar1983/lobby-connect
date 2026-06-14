import type { Json } from "@lc/shared";

export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A detected field change. from/to are typed Json so callers can pass
 *  FieldChange values directly into AuditDetails without extra casts.
 *  diffFields only compares JSON-serializable fields, so the cast inside is safe. */
export interface FieldChange {
  field: string;
  from: Json;
  to: Json;
}

/**
 * Compare `next` against `current` over `fields`. Returns the changed subset
 * (`updates`) and a parallel `{field, from, to}` list for audit logging. Fields
 * whose value is unchanged are omitted from both. Identity comparison (`!==`),
 * matching the existing inline loops.
 */
export function diffFields<T extends Record<string, unknown>>(
  current: T,
  next: T,
  fields: readonly (keyof T)[],
): { updates: Partial<T>; changes: FieldChange[] } {
  const updates: Partial<T> = {};
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (next[field] !== current[field]) {
      updates[field] = next[field];
      // Fields passed to diffFields are always JSON-serializable; the Json cast
      // is safe and lets callers drop their own casts at log call sites.
      changes.push({
        field: String(field),
        from: current[field] as Json,
        to: next[field] as Json,
      });
    }
  }
  return { updates, changes };
}
