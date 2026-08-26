import { JobSource } from '../constants';

/**
 * URL normalisation — produces the canonical string used for duplicate detection.
 *
 * The goal is: two URLs that point at the same job posting normalise to the same string, while two
 * different postings never collide. So we strip only things that provably don't identify the posting
 * (scheme, `www.`, tracking params, trailing slash, fragment, case of the host) and we keep the path
 * verbatim, because on nearly every ATS the job id lives in the path.
 *
 * Deliberately NOT normalised away: query params that are not on the tracking deny-list — Workday and
 * Taleo often carry the requisition id in the query string, so dropping unknown params would merge
 * distinct jobs and silently destroy billable rows.
 */
const TRACKING_PARAM_PREFIXES = ['utm_', 'gh_', 'ref_'];
const TRACKING_PARAMS = new Set([
  'source',
  'src',
  'ref',
  'referrer',
  'trackingid',
  'trk',
  'trkinfo',
  'position',
  'pagenum',
  'origin',
  'originalsubdomain',
  'savedsearchid',
  'refid',
  'eburl',
  'from',
  'lipi',
  'licu',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ittk',
  'sid',
  'jobclick',
  'campaignid',
  'clickid',
  'applyflowversion',
]);

export function looksLikeUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/|$|\?|#)/i.test(s);
}

/** Adds a scheme when the user pasted a bare host, so `new URL()` succeeds. */
export function ensureScheme(raw: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function normalizeUrl(raw: string): string {
  const input = ensureScheme(raw);
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    // Unparseable: fall back to a lowercased, trimmed string so duplicate detection still works on
    // byte-identical garbage rather than throwing away the row.
    return raw.trim().toLowerCase();
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  // Path: strip trailing slash, collapse duplicate slashes. Case is preserved — many ATS ids are
  // case-sensitive tokens.
  let path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');

  const params = new URLSearchParams();
  const keys = [...u.searchParams.keys()].sort();
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) continue;
    for (const value of u.searchParams.getAll(key)) params.append(lower, value);
  }

  const qs = params.toString();
  return `${host}${path}${qs ? `?${qs}` : ''}`;
}

// ---------------------------------------------------------------------------
// Job source detection
// ---------------------------------------------------------------------------

/**
 * Host-pattern → platform. Order matters: the first match wins, so specific ATS hosts are listed
 * before the generic fallbacks.
 */
const SOURCE_PATTERNS: Array<{ source: JobSource; test: RegExp }> = [
  { source: 'Greenhouse', test: /(^|\.)greenhouse\.io$|(^|\.)grnh\.se$/i },
  { source: 'Lever', test: /(^|\.)lever\.co$|(^|\.)hire\.lever\.co$/i },
  { source: 'Workday', test: /myworkdayjobs\.com$|myworkdaysite\.com$|(^|\.)workday\.com$|wd\d+\./i },
  { source: 'ADP', test: /(^|\.)adp\.com$|workforcenow\.adp\.com$/i },
  { source: 'Dayforce', test: /dayforcehcm\.com$|(^|\.)dayforce\.com$|(^|\.)ceridian\.com$/i },
  { source: 'SmartRecruiters', test: /(^|\.)smartrecruiters\.com$|(^|\.)smartapply\.io$/i },
  { source: 'iCIMS', test: /(^|\.)icims\.com$/i },
  { source: 'Taleo', test: /(^|\.)taleo\.net$|taleo\.com$|(^|\.)tbe\.taleo\.net$/i },
  { source: 'LinkedIn', test: /(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/i },
  { source: 'Indeed', test: /(^|\.)indeed\.com$|(^|\.)indeed\.[a-z.]{2,6}$/i },
  { source: 'ZipRecruiter', test: /(^|\.)ziprecruiter\.com$/i },
];

/** Hosts that are job boards/aggregators but not one of the named platforms. */
const OTHER_BOARDS =
  /(^|\.)(glassdoor|monster|dice|simplyhired|wellfound|angel\.co|builtin|remoteok|weworkremotely|jobvite|ashbyhq|workable|breezy\.hr|recruitee|teamtailor|personio|bamboohr|jazzhr|paylocity|paycom|ultipro|successfactors|brassring|avature|eightfold|phenom|jobs\.jobvite)\./i;

/** Path fragments that mark a company's own careers site. */
const CAREER_PATH = /\/(careers?|jobs?|join-us|opportunities|vacancies|openings|work-with-us)(\/|$)/i;

export function detectJobSource(raw: string): JobSource {
  let host: string;
  let pathname = '';
  try {
    const u = new URL(ensureScheme(raw));
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    pathname = u.pathname;
  } catch {
    return 'Other';
  }

  for (const { source, test } of SOURCE_PATTERNS) {
    if (test.test(host)) return source;
  }

  // Some ATS deployments are white-labelled onto a company host; the path still gives them away.
  if (/\/(job-boards|embed\/job_app|jobs\/\d{6,})/i.test(pathname) && /greenhouse/i.test(raw)) {
    return 'Greenhouse';
  }
  if (OTHER_BOARDS.test(`.${host}.`)) return 'Other';

  // A careers-looking path on a non-board host is the company's own career page.
  if (CAREER_PATH.test(pathname) || /^(careers?|jobs|apply|talent)\./i.test(host)) {
    return 'Company Career Page';
  }

  return 'Other';
}

// ---------------------------------------------------------------------------
// Company name extraction from the URL alone (no network)
// ---------------------------------------------------------------------------

const GENERIC_SUBDOMAINS = new Set([
  'www', 'jobs', 'job', 'careers', 'career', 'apply', 'boards', 'board', 'talent', 'hire', 'hiring',
  'recruiting', 'recruitment', 'work', 'people', 'join', 'my', 'app', 'employment', 'en', 'us',
]);

/**
 * Best-effort company guess from URL structure. Multi-tenant ATS hosts put the tenant either in the
 * path (`boards.greenhouse.io/acme`) or in the subdomain (`acme.wd5.myworkdayjobs.com`), so both are
 * handled explicitly before falling back to the registrable domain label.
 *
 * Returns null rather than a bad guess — the spec says leave it blank and let a human fix it.
 */
export function extractCompanyFromUrl(raw: string): string | null {
  let host: string;
  let segments: string[];
  try {
    const u = new URL(ensureScheme(raw));
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    segments = u.pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }

  const first = segments[0]?.toLowerCase();

  // Tenant-in-path ATS hosts
  if (/greenhouse\.io$|lever\.co$|smartrecruiters\.com$|ashbyhq\.com$|workable\.com$/i.test(host)) {
    const skip = new Set(['embed', 'jobs', 'job', 'careers', 'o', 'v', 'api']);
    const tenant = segments.find((s) => !skip.has(s.toLowerCase()) && !/^\d+$/.test(s));
    if (tenant) return prettifyCompany(tenant);
  }

  // Tenant-in-subdomain ATS hosts (Workday, iCIMS, Taleo, Dayforce, ADP)
  if (/myworkdayjobs\.com$|myworkdaysite\.com$|icims\.com$|taleo\.net$|dayforcehcm\.com$/i.test(host)) {
    const labels = host.split('.');
    const tenant = labels.find(
      (l) => !GENERIC_SUBDOMAINS.has(l) && !/^wd\d+$/.test(l) && !/^(cx|cs|tbe|chp)$/.test(l),
    );
    if (tenant) return prettifyCompany(tenant);
  }

  // Aggregators: the URL simply does not contain the company. Leave blank for enrichment/manual entry.
  if (/linkedin\.com$|indeed\./i.test(host) || /ziprecruiter\.com$/i.test(host)) {
    return null;
  }

  // Company's own domain: take the registrable label, skipping generic subdomains.
  const labels = host.split('.');
  if (labels.length >= 2) {
    const candidate =
      labels.length > 2 && !GENERIC_SUBDOMAINS.has(labels[0])
        ? labels[0]
        : labels[labels.length - 2];
    if (candidate && !GENERIC_SUBDOMAINS.has(candidate)) return prettifyCompany(candidate);
  }
  void first;
  return null;
}

export function prettifyCompany(slug: string): string {
  const cleaned = decodeURIComponent(slug)
    .replace(/[-_+.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Job title extraction from the URL alone (no network)
// ---------------------------------------------------------------------------

const TITLE_NOISE = new Set([
  'jobs', 'job', 'careers', 'career', 'apply', 'application', 'posting', 'postings', 'opening',
  'openings', 'position', 'positions', 'en', 'us', 'gb', 'view', 'details', 'detail', 'p', 'o',
]);

/**
 * Many ATS URLs end in a human-readable slug (`/jobs/senior-backend-engineer-1234`). When they do,
 * that slug is a better title than nothing. When the tail is a pure id, return null.
 */
export function extractTitleFromUrl(raw: string): string | null {
  let segments: string[];
  try {
    const u = new URL(ensureScheme(raw));
    segments = u.pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
  if (!segments.length) return null;

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = decodeURIComponent(segments[i]);
    if (/^\d+$/.test(seg)) continue;                     // pure id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(seg)) continue; // uuid
    if (TITLE_NOISE.has(seg.toLowerCase())) continue;

    // Strip a trailing numeric id from the slug: "backend-engineer-91827" -> "backend-engineer"
    const withoutId = seg.replace(/[-_](\d{3,})$/, '').replace(/[-_][0-9a-f]{8,}$/i, '');
    const words = withoutId.split(/[-_+]/).filter(Boolean);
    if (words.length < 2) continue; // single word is rarely a real title

    const title = words
      .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
    if (title.length > 90) return title.slice(0, 90);
    return title;
  }
  return null;
}
