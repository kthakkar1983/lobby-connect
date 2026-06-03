export const MAX_PLAYBOOK_BYTES = 10 * 1024 * 1024; // 10 MB

export function validatePlaybookFile(file: {
  type: string;
  size: number;
}): string | null {
  if (file.type !== "application/pdf") return "Playbook must be a PDF.";
  if (file.size === 0) return "File is empty.";
  if (file.size > MAX_PLAYBOOK_BYTES) return "Playbook must be 10 MB or smaller.";
  return null;
}

// Canonical key already used in production (see 6b). One PDF per property.
export function playbookStorageKey(
  operatorId: string,
  propertyId: string,
): string {
  return `${operatorId}/${propertyId}/playbook.pdf`;
}
