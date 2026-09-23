import { createHash } from 'crypto';

const ROMAN_NUMERALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6',
};

function normalizeIdentityPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(i|ii|iii|iv|v|vi)\b/g, (token) => ROMAN_NUMERALS[token] ?? token)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCompany(value: string): string {
  const normalized = normalizeIdentityPart(value);
  const withoutSuffix = normalized.replace(
    /\s+(?:incorporated|inc|limited|ltd|llc|plc|corporation|corp)\.?$/,
    '',
  );
  return withoutSuffix || normalized;
}

/** Stable, compact identity for cross-site copies of the same advertised role. */
export function createJobFingerprint(
  companyName?: string | null,
  jobTitle?: string | null,
): string | null {
  if (!companyName?.trim() || !jobTitle?.trim()) return null;
  const company = normalizeCompany(companyName);
  const title = normalizeIdentityPart(jobTitle);
  if (!company || !title) return null;
  return createHash('sha256').update(`${company}|${title}`).digest('hex').slice(0, 32);
}
