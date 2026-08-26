import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUrl } from '../common/utils/url.util';

export type DuplicateScope = 'global' | 'workspace';

/**
 * URL-based duplicate detection.
 *
 * Rules from the spec, restated precisely:
 *   - Primary key:   exact `url` match.
 *   - Secondary key: `normalized_url` match.
 *   - Company name is NEVER compared. The same company having many postings is normal and must all
 *     be billable, so comparing company names would destroy legitimate rows.
 *
 * Scope is configurable via DUPLICATE_SCOPE:
 *   global    (default) — a URL already present anywhere in the system flags the new row. This is the
 *                         scope that actually protects payment: two bidders pasting the same job is
 *                         exactly the abuse the flag exists to catch.
 *   workspace           — each bidder is only compared against their own tab.
 */
@Injectable()
export class DuplicateService {
  private readonly logger = new Logger(DuplicateService.name);
  readonly scope: DuplicateScope =
    process.env.DUPLICATE_SCOPE === 'workspace' ? 'workspace' : 'global';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up which of the given URLs already exist.
   * Returns sets of the exact URLs and normalized URLs that are already taken, plus a lookup of the
   * first existing row per key so the UI can say *where* the duplicate lives.
   */
  async findExisting(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
  ): Promise<{
    byUrl: Map<string, ExistingRef>;
    byNormalized: Map<string, ExistingRef>;
  }> {
    const normalized = urls.map((u) => normalizeUrl(u));
    const scopeFilter = this.scope === 'workspace' ? { workspace_id: workspaceId } : {};

    // Chunked IN() clauses: SQLite caps bound parameters (~32k), and a 20k-row import would blow it.
    const CHUNK = 400;
    const byUrl = new Map<string, ExistingRef>();
    const byNormalized = new Map<string, ExistingRef>();

    for (let i = 0; i < urls.length; i += CHUNK) {
      const urlChunk = urls.slice(i, i + CHUNK);
      const normChunk = normalized.slice(i, i + CHUNK);

      const rows = await this.prisma.jobApplication.findMany({
        where: {
          ...scopeFilter,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          OR: [{ url: { in: urlChunk } }, { normalized_url: { in: normChunk } }],
        },
        select: {
          id: true,
          url: true,
          job_title: true,
          normalized_url: true,
          workspace_id: true,
          date: true,
          number: true,
          workspace: { select: { name: true } },
        },
        orderBy: { created_at: 'asc' },
      });

      for (const row of rows) {
        const ref: ExistingRef = {
          id: row.id,
          url: row.url,
          job_title: row.job_title,
          workspace_id: row.workspace_id,
          workspace_name: row.workspace.name,
          date: row.date,
          number: row.number,
        };
        if (!byUrl.has(row.url)) byUrl.set(row.url, ref);
        if (!byNormalized.has(row.normalized_url)) byNormalized.set(row.normalized_url, ref);
      }
    }

    return { byUrl, byNormalized };
  }
  /**
   * Classifies a batch of URLs in one pass, including duplicates *within* the batch itself
   * (pasting the same URL twice in one textarea must flag the second occurrence).
   */
  async classifyBatch(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
  ): Promise<DuplicateVerdict[]> {
    const { byUrl, byNormalized } = await this.findExisting(workspaceId, urls, excludeId);

    const seenUrl = new Set<string>();
    const seenNormalized = new Set<string>();
    const verdicts: DuplicateVerdict[] = [];

    for (const url of urls) {
      const norm = normalizeUrl(url);

      const existing = byUrl.get(url) ?? byNormalized.get(norm);
      if (existing) {
        verdicts.push({ url, normalized_url: norm, is_duplicate: true, reason: 'existing', existing });
        continue;
      }
      if (seenUrl.has(url) || seenNormalized.has(norm)) {
        verdicts.push({ url, normalized_url: norm, is_duplicate: true, reason: 'within_batch' });
        continue;
      }
      seenUrl.add(url);
      seenNormalized.add(norm);
      verdicts.push({ url, normalized_url: norm, is_duplicate: false, reason: null });
    }
    return verdicts;
  }
}

export interface ExistingRef {
  id: string;
  url: string;
  job_title: string | null;
  workspace_id: string;
  workspace_name: string;
  date: Date;
  number: number;
}

export interface DuplicateVerdict {
  url: string;
  normalized_url: string;
  is_duplicate: boolean;
  reason: 'existing' | 'within_batch' | null;
  existing?: ExistingRef;
}
