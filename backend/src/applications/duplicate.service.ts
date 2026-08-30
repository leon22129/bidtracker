import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUrl, normalizeCompanyName } from '../common/utils/url.util';

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
 *   workspace (default) — each workspace is compared only against its own rows.
 *   global               — a URL already present anywhere in the system flags the new row.
 */
@Injectable()
export class DuplicateService {
  private readonly logger = new Logger(DuplicateService.name);
  readonly scope: DuplicateScope =
    process.env.DUPLICATE_SCOPE === 'global' ? 'global' : 'workspace';

  constructor(private readonly prisma: PrismaService) {}

/**
 * Looks up which of the given URLs and company names already exist.
 * Returns:
 *   - byUrl: maps exact URLs to existing records
 *   - byNormalized: maps normalized URLs to existing records
 *   - byCompanyName: maps normalized company names to existing records (only non-empty normalizations)
 *
 * For company name lookups, empty and null names are not indexed. A new row with an empty company
 * name does not match existing rows with empty company names.
 */
  async findExisting(
    workspaceId: string,
    urls: string[],
    companyNames: (string | null | undefined)[] = [],
    excludeId?: string,
  ): Promise<{
    byUrl: Map<string, ExistingRef>;
    byNormalized: Map<string, ExistingRef>;
    byCompanyName: Map<string, ExistingRef>;
  }> {
    const normalized = urls.map((u) => normalizeUrl(u));
    const normalizedCompanyNames = companyNames.map((c) => normalizeCompanyName(c ?? '')).filter(Boolean);
    const scopeFilter = this.scope === 'workspace' ? { workspace_id: workspaceId } : {};

    // Chunked IN() clauses: SQLite caps bound parameters (~32k), and a 20k-row import would blow it.
    const CHUNK = 400;
    const byUrl = new Map<string, ExistingRef>();
    const byNormalized = new Map<string, ExistingRef>();
    const byCompanyName = new Map<string, ExistingRef>();

    // --- URL lookups ---
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
          company_name: true,
          normalized_url: true,
          normalized_company_name: true,
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
          company_name: row.company_name,
          normalized_url: row.normalized_url,
          normalized_company_name: row.normalized_company_name,
          workspace_id: row.workspace_id,
          workspace_name: row.workspace.name,
          date: row.date,
          number: row.number,
        };
        if (!byUrl.has(row.url)) byUrl.set(row.url, ref);
        if (!byNormalized.has(row.normalized_url)) byNormalized.set(row.normalized_url, ref);
      }
    }

    // --- Company name lookups (only for non-empty normalized names) ---
    if (normalizedCompanyNames.length > 0) {
      const uniqueCompanyNames = [...new Set(normalizedCompanyNames)];
      for (let i = 0; i < uniqueCompanyNames.length; i += CHUNK) {
        const companyChunk = uniqueCompanyNames.slice(i, i + CHUNK);

        const rows = await this.prisma.jobApplication.findMany({
          where: {
            ...scopeFilter,
            ...(excludeId ? { id: { not: excludeId } } : {}),
            normalized_company_name: { in: companyChunk },
          },
          select: {
            id: true,
            url: true,
            job_title: true,
            company_name: true,
            normalized_url: true,
            normalized_company_name: true,
            workspace_id: true,
            date: true,
            number: true,
            workspace: { select: { name: true } },
          },
          orderBy: { created_at: 'asc' },
        });

        for (const row of rows) {
          if (!row.normalized_company_name) continue; // Skip empty normalized names
          if (byCompanyName.has(row.normalized_company_name)) continue; // Already have first occurrence
          
          const ref: ExistingRef = {
            id: row.id,
            url: row.url,
            job_title: row.job_title,
            company_name: row.company_name,
            normalized_url: row.normalized_url,
            normalized_company_name: row.normalized_company_name,
            workspace_id: row.workspace_id,
            workspace_name: row.workspace.name,
            date: row.date,
            number: row.number,
          };
          byCompanyName.set(row.normalized_company_name, ref);
        }
      }
    }

    return { byUrl, byNormalized, byCompanyName };
  }
  /**
   * Classifies a batch of URLs and company names in one pass, including duplicates *within* the batch itself.
   * For each entry, returns whether it's a duplicate by URL or by company name.
   *
   * Duplicate precedence: URL duplicates are reported before company name duplicates.
   * Within-batch duplicates are reported before existing duplicates.
   *
   * For company names, empty or null values do NOT match each other or themselves.
   */
  async classifyBatch(
    workspaceId: string,
    urls: string[],
    companyNames: (string | null | undefined)[] = [],
    excludeId?: string,
  ): Promise<DuplicateVerdict[]> {
    // Ensure companyNames has the same length as urls
    while (companyNames.length < urls.length) {
      companyNames.push(null);
    }

    const { byUrl, byNormalized, byCompanyName } = await this.findExisting(
      workspaceId,
      urls,
      companyNames,
      excludeId,
    );

    const seenUrl = new Set<string>();
    const seenNormalized = new Set<string>();
    const seenCompanyName = new Set<string>();
    const verdicts: DuplicateVerdict[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const companyName = companyNames[i];
      const norm = normalizeUrl(url);
      const normalizedCompany = normalizeCompanyName(companyName ?? '');

      // Check URL duplicates first (existing takes precedence over within-batch)
      const existingByUrl = byUrl.get(url);
      if (existingByUrl) {
        verdicts.push({
          url,
          normalized_url: norm,
          company_name: companyName ?? null,
          normalized_company_name: normalizedCompany || null,
          is_duplicate: true,
          reason: 'existing',
          duplicate_type: 'url',
          existing: existingByUrl,
        });
        seenUrl.add(url);
        seenNormalized.add(norm);
        if (normalizedCompany) seenCompanyName.add(normalizedCompany);
        continue;
      }

      const existingByNormUrl = byNormalized.get(norm);
      if (existingByNormUrl) {
        verdicts.push({
          url,
          normalized_url: norm,
          company_name: companyName ?? null,
          normalized_company_name: normalizedCompany || null,
          is_duplicate: true,
          reason: 'existing',
          duplicate_type: 'url',
          existing: existingByNormUrl,
        });
        seenUrl.add(url);
        seenNormalized.add(norm);
        if (normalizedCompany) seenCompanyName.add(normalizedCompany);
        continue;
      }

      // Check within-batch URL duplicates
      if (seenUrl.has(url) || seenNormalized.has(norm)) {
        verdicts.push({
          url,
          normalized_url: norm,
          company_name: companyName ?? null,
          normalized_company_name: normalizedCompany || null,
          is_duplicate: true,
          reason: 'within_batch',
          duplicate_type: 'url',
        });
        seenUrl.add(url);
        seenNormalized.add(norm);
        if (normalizedCompany) seenCompanyName.add(normalizedCompany);
        continue;
      }

      // Check company name duplicates (only if company name normalized to non-empty)
      if (normalizedCompany) {
        const existingByCompany = byCompanyName.get(normalizedCompany);
        if (existingByCompany) {
          verdicts.push({
            url,
            normalized_url: norm,
            company_name: companyName ?? null,
            normalized_company_name: normalizedCompany,
            is_duplicate: true,
            reason: 'existing',
            duplicate_type: 'company_name',
            existing: existingByCompany,
          });
          seenUrl.add(url);
          seenNormalized.add(norm);
          seenCompanyName.add(normalizedCompany);
          continue;
        }

        // Check within-batch company name duplicates
        if (seenCompanyName.has(normalizedCompany)) {
          verdicts.push({
            url,
            normalized_url: norm,
            company_name: companyName ?? null,
            normalized_company_name: normalizedCompany,
            is_duplicate: true,
            reason: 'within_batch',
            duplicate_type: 'company_name',
          });
          seenUrl.add(url);
          seenNormalized.add(norm);
          seenCompanyName.add(normalizedCompany);
          continue;
        }
      }

      // Not a duplicate
      seenUrl.add(url);
      seenNormalized.add(norm);
      if (normalizedCompany) seenCompanyName.add(normalizedCompany);
      verdicts.push({
        url,
        normalized_url: norm,
        company_name: companyName ?? null,
        normalized_company_name: normalizedCompany || null,
        is_duplicate: false,
        reason: null,
        duplicate_type: null,
      });
    }

    return verdicts;
  }
}

export interface ExistingRef {
  id: string;
  url: string;
  job_title: string | null;
  company_name: string | null;
  normalized_url: string;
  normalized_company_name: string | null;
  workspace_id: string;
  workspace_name: string;
  date: Date;
  number: number;
}

export interface DuplicateVerdict {
  url: string;
  normalized_url: string;
  company_name: string | null;
  normalized_company_name: string | null;
  is_duplicate: boolean;
  reason: 'existing' | 'within_batch' | null;
  duplicate_type: 'url' | 'company_name' | null;
  existing?: ExistingRef;
}
