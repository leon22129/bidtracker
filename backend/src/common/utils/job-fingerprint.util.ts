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

export function normalizeCompanyIdentity(value: string): string {
  const normalized = normalizeIdentityPart(value);
  const withoutSuffix = normalized.replace(
    /\s+(?:incorporated|inc|limited|ltd|llc|plc|corporation|corp)\.?$/,
    '',
  );
  return withoutSuffix || normalized;
}

/**
 * Career milestones are intentionally free-form. Match only company-shaped values (headings,
 * labelled fields, or delimited entry headers) so prose such as "visa sponsorship" does not make
 * Visa look like a previous employer.
 */
export function careerPathIncludesCompany(
  careerPath: string | null | undefined,
  companyName: string | null | undefined,
): boolean {
  if (!careerPath?.trim() || !companyName?.trim()) return false;
  const target = normalizeCompanyIdentity(companyName);
  if (!target) return false;

  const matches = (value: string) => normalizeCompanyIdentity(value) === target;
  const dateToken = /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+|\d{1,2}[/-])?(?:19|20)\d{2}\b/i;

  for (const rawLine of careerPath.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .trim();
    if (!line) continue;

    if (matches(line)) return true;

    const labelled = line.match(/^(?:company(?:\s+name)?|employer|organization|client)\s*[:=]\s*(.+)$/i);
    if (labelled && (
      matches(labelled[1])
      || matches(labelled[1].split(/\s+(?:\||-|\u2013|\u2014)\s+|[;,\t]/, 1)[0])
    )) return true;

    const headerParts = line.split(/\s+(?:\||-|\u2013|\u2014)\s+|[;,\t]/);
    if (headerParts.some(matches)) return true;

    const dateIndex = line.search(dateToken);
    if (dateIndex > 0) {
      const beforeDate = line.slice(0, dateIndex).replace(/[\s([{|,:-]+$/, '').trim();
      if (matches(beforeDate) || beforeDate.split(/\s+(?:\||-|\u2013|\u2014)\s+|[;,\t]/).some(matches)) {
        return true;
      }
    }
  }

  return false;
}

/** Stable, compact identity for cross-site copies of the same advertised role. */
export function createJobFingerprint(
  companyName?: string | null,
  jobTitle?: string | null,
): string | null {
  if (!companyName?.trim() || !jobTitle?.trim()) return null;
  const company = normalizeCompanyIdentity(companyName);
  const title = normalizeIdentityPart(jobTitle);
  if (!company || !title) return null;
  return createHash('sha256').update(`${company}|${title}`).digest('hex').slice(0, 32);
}
