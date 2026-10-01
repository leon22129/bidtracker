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

export const BANNED_URL_NOTE = 'this job is in banned list';

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
