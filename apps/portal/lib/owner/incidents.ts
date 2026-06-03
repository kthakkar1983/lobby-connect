export const MAX_RESOLUTION_NOTE = 1000;

export function validateResolutionNote(
  note: string | null | undefined,
): string | null {
  if (!note) return null;
  if (note.trim().length > MAX_RESOLUTION_NOTE) {
    return "Note must be 1000 characters or fewer.";
  }
  return null;
}
