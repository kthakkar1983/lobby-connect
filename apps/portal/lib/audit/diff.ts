export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
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
      changes.push({ field: String(field), from: current[field], to: next[field] });
    }
  }
  return { updates, changes };
}
