export const SHARED_PACKAGE_VERSION = "0.0.0";

export function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value);
}
