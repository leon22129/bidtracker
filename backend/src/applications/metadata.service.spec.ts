import { MetadataService } from './metadata.service';
import { isBannedUrl } from '../common/utils/url.util';

describe('MetadataService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reuses enrichment results for the same URL set so duplicate preview and add do not refetch titles', async () => {
    const fetchSpy = jest.fn(async (url: string) => {
      const html = `
        <html><head>
          <title>Senior Engineer | Acme</title>
          <meta property="og:site_name" content="Acme" />
          <meta property="og:title" content="Senior Engineer" />
        </head></html>
      `;
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(html));
            controller.close();
          },
        }),
      } as Response;
    });

    global.fetch = fetchSpy as typeof fetch;

    const service = new MetadataService();
    const urls = ['https://example.com/jobs/senior-engineer'];

    const first = await service.enrichMany(urls, true);
    const second = await service.enrichMany(urls, true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.get(urls[0])).toEqual({
      company_name: 'Acme',
      job_title: 'Senior Engineer',
    });
    expect(second.get(urls[0])).toEqual({
      company_name: 'Acme',
      job_title: 'Senior Engineer',
    });
  });

  it('flags URLs containing any configured banned fragment', () => {
    const previous = process.env.BANNED_URL_PATTERNS;
    process.env.BANNED_URL_PATTERNS = 'example.com, recruiter';

    try {
      expect(isBannedUrl('https://example.com/jobs/senior-engineer')).toBe(true);
      expect(isBannedUrl('https://jobs.example.com/openings/123')).toBe(true);
      expect(isBannedUrl('https://acme.com/jobs/senior-engineer')).toBe(false);
      expect(isBannedUrl('https://careers.company.com/recruiter-role')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.BANNED_URL_PATTERNS;
      else process.env.BANNED_URL_PATTERNS = previous;
    }
  });
});
