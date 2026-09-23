import { MetadataService } from './metadata.service';

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
    const urls = ['https://www.linkedin.com/jobs/view/123'];

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

  it('uses the Rippling tenant from the URL instead of the ATS vendor metadata', async () => {
    const service = new MetadataService();
    const metadata = service.parseHtml(
      '<html><head><title>Keebler Health | Rippling</title>' +
        '<meta property="og:site_name" content="Rippling" /></head></html>',
      'https://ats.rippling.com/keeblerhealth/jobs/88f20fbd-e190-4478-a99e-81c284e426bd',
    );

    expect(metadata.company_name).toBe('Keeblerhealth');
  });

  it('falls back to HTML company metadata when the URL has no company name', () => {
    const service = new MetadataService();
    const metadata = service.parseHtml(
      '<html><head><meta property="og:site_name" content="Acme Health" /></head></html>',
      'https://www.linkedin.com/jobs/view/123',
    );

    expect(metadata.company_name).toBe('Acme Health');
  });

});
