import { Injectable, Logger } from '@nestjs/common';
import { extractCompanyFromUrl, extractTitleFromUrl, prettifyCompany } from '../common/utils/url.util';

export interface UrlMetadata {
  company_name: string | null;
  job_title: string | null;
}

/**
 * Best-effort company/title extraction.
 *
 * Design constraints that shaped this:
 *  1. Career sites are slow, rate-limit aggressively, and frequently bot-block. So enrichment must
 *     NEVER fail an insert — a blank field that a human can fix is the specified behaviour.
 *  2. A bidder pasting 200 URLs cannot wait 200 × 3s. So fetches are bounded-concurrency with a hard
 *     per-request timeout, and the URL-only heuristics run first as a free fallback.
 *  3. No heavy HTML parser dependency: we need exactly four things (og:title, og:site_name,
 *     <title>, application/ld+json JobPosting), all of which are reliably reachable with focused
 *     regexes over the first chunk of the document.
 */
@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  private readonly enabled = process.env.ENABLE_URL_ENRICHMENT !== 'false';
  private readonly timeoutMs = Number(process.env.URL_FETCH_TIMEOUT_MS || 6000);
  private readonly concurrency = Number(process.env.URL_FETCH_CONCURRENCY || 5);
  private readonly maxBytes = 512 * 1024; // enough for <head>; avoids downloading whole SPAs
  private readonly cacheTtlMs = 10 * 60 * 1000;
  private readonly urlCache = new Map<string, { expiresAt: number; metadata: UrlMetadata }>();

  /** URL-only guess. Always available, no network, never throws. */
  fromUrlOnly(url: string): UrlMetadata {
    return {
      company_name: safe(() => extractCompanyFromUrl(url)),
      job_title: safe(() => extractTitleFromUrl(url)),
    };
  }

  /**
   * Enriches many URLs with bounded concurrency. Returns a map keyed by the input URL.
   * Fields that could not be determined come back as null — callers leave the column blank.
   */
  async enrichMany(urls: string[], enable = true): Promise<Map<string, UrlMetadata>> {
    const result = new Map<string, UrlMetadata>();
    const uniqueUrls = [...new Set(urls)];

    for (const url of uniqueUrls) {
      const cached = this.getCached(url);
      result.set(url, cached ?? this.fromUrlOnly(url));
    }

    if (!enable || !this.enabled || uniqueUrls.length === 0) return result;

    const queue = uniqueUrls.filter((url) => !this.getCached(url));
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (queue.length) {
        const url = queue.shift();
        if (!url) break;
        const fetched = await this.fetchOne(url);
        if (!fetched) continue;
        const base = result.get(url)!;
        // Fetched metadata wins over URL heuristics, but never overwrites a value with null.
        const merged = {
          company_name: fetched.company_name ?? base.company_name,
          job_title: fetched.job_title ?? base.job_title,
        };
        this.setCache(url, merged);
        result.set(url, merged);
      }
    });
    await Promise.all(workers);
    return result;
  }

  private getCached(url: string): UrlMetadata | null {
    const cached = this.urlCache.get(url);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.urlCache.delete(url);
      return null;
    }
    return cached.metadata;
  }

  private setCache(url: string, metadata: UrlMetadata) {
    this.urlCache.set(url, {
      expiresAt: Date.now() + this.cacheTtlMs,
      metadata,
    });
  }

  private async fetchOne(url: string): Promise<UrlMetadata | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // A real UA materially reduces bot-blocking on ATS hosts.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok || !res.body) return null;

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('html')) return null;

      const html = await readCapped(res.body, this.maxBytes);
      return this.parseHtml(html, url);
    } catch (err) {
      // Timeouts, DNS failures, TLS errors, bot walls: all expected and all non-fatal.
      this.logger.debug(`Enrichment failed for ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exposed for unit testing. */
  parseHtml(html: string, url: string): UrlMetadata {
    const og = (prop: string) =>
      firstMatch(
        html,
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
          'i',
        ),
      ) ??
      firstMatch(
        html,
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
          'i',
        ),
      );

    const pageTitle = decodeEntities(
      firstMatch(html, /<title[^>]*>([\s\S]{1,400}?)<\/title>/i) ?? '',
    ).trim();

    const ldJson = this.parseJobPostingLd(html);

    // Explicit `string | null` (rather than inferred `string`) because every step below may legitimately
    // clear a value back to null, and the fallbacks at the end return null when they can't derive one.
    let company: string | null =
      nonEmpty(ldJson.company) ?? nonEmpty(decodeEntities(og('og:site_name') ?? ''));
    let title: string | null =
      nonEmpty(ldJson.title) ?? nonEmpty(decodeEntities(og('og:title') ?? ''));

    if (!title && pageTitle) title = pageTitle;

    if (title) title = this.cleanTitle(title, company);
    if (company) company = this.cleanCompany(company);

    // Greenhouse/Lever style: "Job Application for Senior Engineer at Acme"
    const atPattern = /^(?:job application for\s+)?(.+?)\s+(?:at|@|\|)\s+(.+?)$/i;
    if (title) {
      const m = atPattern.exec(title);
      if (m) {
        title = this.cleanTitle(m[1], company);
        if (!company) company = this.cleanCompany(m[2]);
      }
    }
    if (!company) company = safe(() => extractCompanyFromUrl(url));
    if (!title) title = safe(() => extractTitleFromUrl(url));

    return {
      company_name: nonEmpty(company),
      job_title: nonEmpty(title),
    };
  }

  /** schema.org JobPosting is the highest-quality signal when a site publishes it. */
  private parseJobPostingLd(html: string): { company?: string; title?: string } {
    const blocks = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    );
    if (!blocks) return {};
    for (const block of blocks) {
      const jsonText = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
      try {
        const parsed = JSON.parse(jsonText);
        const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] ?? [])];
        for (const node of candidates) {
          if (!node || typeof node !== 'object') continue;
          const type = String(node['@type'] ?? '');
          if (!/JobPosting/i.test(type)) continue;
          const org = node.hiringOrganization;
          return {
            title: typeof node.title === 'string' ? node.title : undefined,
            company:
              typeof org === 'string' ? org : typeof org?.name === 'string' ? org.name : undefined,
          };
        }
      } catch {
        // Malformed JSON-LD is extremely common; ignore and fall through to meta tags.
      }
    }
    return {};
  }

  private cleanTitle(raw: string, company?: string | null): string {
    let t = raw.replace(/\s+/g, ' ').trim();
    // Strip common suffix boilerplate: " - Careers", " | Acme Jobs", " at Acme"
    t = t.replace(/\s*[|\-–—]\s*(careers?|jobs?|job openings?|hiring|apply now|we are hiring).*$/i, '');
    if (company) {
      const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(`\\s*[|\\-–—]\\s*${escaped}\\s*$`, 'i'), '');
      t = t.replace(new RegExp(`\\s+at\\s+${escaped}\\s*$`, 'i'), '');
    }
    t = t.replace(/\s*[|\-–—]\s*[^|\-–—]{1,30}$/i, (m) => (/(engineer|developer|manager|analyst|designer|scientist|architect|lead|intern)/i.test(m) ? m : ''));
    return t.trim().slice(0, 200);
  }

  private cleanCompany(raw: string): string {
    let c = raw.replace(/\s+/g, ' ').trim();
    c = c.replace(/\s*[|\-–—]\s*(careers?|jobs?|job board|hiring|talent).*$/i, '');
    c = c.replace(/^(careers? at|jobs at|work at)\s+/i, '');
    if (/^[a-z0-9-]+$/.test(c)) c = prettifyCompany(c);
    return c.trim().slice(0, 120);
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let read = 0;
  try {
    while (read < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(out)) break; // everything we need lives in <head>
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out;
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[1] ?? null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function nonEmpty(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

function safe<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
