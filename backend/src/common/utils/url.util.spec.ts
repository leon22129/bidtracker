import {
  detectJobSource,
  extractCompanyFromUrl,
  extractTitleFromUrl,
  normalizeUrl,
} from './url.util';

describe('normalizeUrl', () => {
  it('treats scheme, www, trailing slash and fragment as insignificant', () => {
    const canonical = 'company.com/jobs/123';
    expect(normalizeUrl('https://company.com/jobs/123')).toBe(canonical);
    expect(normalizeUrl('http://www.company.com/jobs/123/')).toBe(canonical);
    expect(normalizeUrl('company.com/jobs/123#apply')).toBe(canonical);
    expect(normalizeUrl('HTTPS://COMPANY.COM/jobs/123')).toBe(canonical);
  });

  it('strips tracking params but keeps identifying ones', () => {
    expect(normalizeUrl('https://c.com/j?utm_source=li&gh_src=x&id=42')).toBe('c.com/j?id=42');
  });

  it('does not merge two different postings', () => {
    expect(normalizeUrl('https://c.com/jobs/123')).not.toBe(normalizeUrl('https://c.com/jobs/124'));
  });
});

describe('detectJobSource', () => {
  const cases: Array<[string, string]> = [
    ['https://boards.greenhouse.io/acme/jobs/4012345', 'Greenhouse'],
    ['https://jobs.lever.co/acme/1a2b3c', 'Lever'],
    ['https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123', 'Workday'],
    ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/x.html', 'ADP'],
    ['https://acme.dayforcehcm.com/CandidatePortal/en-US/acme/Posting/View/1', 'Dayforce'],
    ['https://jobs.smartrecruiters.com/Acme/743999', 'SmartRecruiters'],
    ['https://careers-acme.icims.com/jobs/1234/engineer/job', 'iCIMS'],
    ['https://acme.taleo.net/careersection/jobdetail.ftl?job=99', 'Taleo'],
    ['https://www.linkedin.com/jobs/view/4012345678', 'LinkedIn'],
    ['https://www.indeed.com/viewjob?jk=abc123', 'Indeed'],
    ['https://www.ziprecruiter.com/c/Acme/Job/Engineer', 'ZipRecruiter'],
    ['https://www.acme.com/careers/backend-engineer', 'Company Career Page'],
    ['https://randomsite.io/page', 'Other'],
  ];
  it.each(cases)('%s -> %s', (url, expected) => {
    expect(detectJobSource(url)).toBe(expected);
  });
});

describe('extractCompanyFromUrl', () => {
  it('reads the tenant out of path-based ATS hosts', () => {
    expect(extractCompanyFromUrl('https://boards.greenhouse.io/acme-corp/jobs/1')).toBe('Acme Corp');
    expect(extractCompanyFromUrl('https://jobs.lever.co/nubank/xyz')).toBe('Nubank');
  });

  it('reads the tenant out of subdomain-based ATS hosts', () => {
    expect(extractCompanyFromUrl('https://acme.wd5.myworkdayjobs.com/en-US/careers')).toBe('Acme');
  });

  it('returns null for aggregators that do not name the company in the URL', () => {
    expect(extractCompanyFromUrl('https://www.linkedin.com/jobs/view/123')).toBeNull();
    expect(extractCompanyFromUrl('https://www.indeed.com/viewjob?jk=1')).toBeNull();
  });

  it('falls back to the company domain', () => {
    expect(extractCompanyFromUrl('https://careers.stripe.com/jobs/1')).toBe('Stripe');
  });
});

describe('extractTitleFromUrl', () => {
  it('uses a readable slug and drops the trailing id', () => {
    expect(extractTitleFromUrl('https://c.com/jobs/senior-backend-engineer-91827')).toBe(
      'Senior Backend Engineer',
    );
  });
  it('returns null when the tail is only an id', () => {
    expect(extractTitleFromUrl('https://www.linkedin.com/jobs/view/4012345678')).toBeNull();
  });
});
