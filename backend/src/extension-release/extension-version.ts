export const DEFAULT_RESUME_BUILDER_MIN_VERSION = '0.9.3';

export function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part <= 65535) ? parts : null;
}

export function atLeast(current: number[], minimum: number[]): boolean {
  for (let index = 0; index < 4; index++) {
    const difference = (current[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
