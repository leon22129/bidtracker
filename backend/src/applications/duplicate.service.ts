import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUrl } from '../common/utils/url.util';
import { createJobFingerprint } from '../common/utils/job-fingerprint.util';

/** Exact URL detection plus a recent workspace-local company/title signal for cross-site jobs. */
@Injectable()
export class DuplicateService {
  constructor(private readonly prisma: PrismaService) {}

  async classifyJobIdentities(
    workspaceId: string,
    items: Array<{ company_name?: string | null; job_title?: string | null }>,
    excludeIds: string[] = [],
  ): Promise<JobIdentityVerdict[]> {
    const fingerprints = items.map((item) => createJobFingerprint(item.company_name, item.job_title));
    const unique = [...new Set(fingerprints.filter((value): value is string => Boolean(value)))];
    const requested = new Set(unique);
    const cutoff = this.fingerprintCutoff();
    const existing = new Map<string, ExistingRef>();
    const select = existingRefSelect();

    for (let i = 0; i < unique.length; i += 400) {
      const rows = await this.prisma.jobApplication.findMany({
        where: {
          workspace_id: workspaceId,
          job_fingerprint: { in: unique.slice(i, i + 400) },
          created_at: { gte: cutoff },
          ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        },
        select: { ...select, job_fingerprint: true },
        orderBy: { created_at: 'desc' },
      });
      for (const row of rows) {
        if (row.job_fingerprint && !existing.has(row.job_fingerprint)) {
          existing.set(row.job_fingerprint, toExistingRef(row));
        }
      }
    }

    if (unique.length) {
      const legacy = await this.prisma.jobApplication.findMany({
        where: {
          workspace_id: workspaceId,
          job_fingerprint: null,
          created_at: { gte: cutoff },
          company_name: { not: null },
          job_title: { not: null },
          ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        },
        select,
        orderBy: { created_at: 'desc' },
      });
      for (const row of legacy) {
        const fingerprint = createJobFingerprint(row.company_name, row.job_title);
        if (fingerprint && requested.has(fingerprint) && !existing.has(fingerprint)) {
          existing.set(fingerprint, toExistingRef(row));
        }
      }
    }

    const seen = new Set<string>();
    return fingerprints.map((fingerprint) => {
      if (!fingerprint) return { fingerprint: null, is_duplicate: false, reason: null };
      const existingRow = existing.get(fingerprint);
      if (existingRow) {
        seen.add(fingerprint);
        return { fingerprint, is_duplicate: true, reason: 'existing' as const, existing: existingRow };
      }
      if (seen.has(fingerprint)) {
        return { fingerprint, is_duplicate: true, reason: 'within_batch' as const };
      }
      seen.add(fingerprint);
      return { fingerprint, is_duplicate: false, reason: null };
    });
  }

  /** Company/title matches are deliberately workspace-local and expire to allow later reposts. */
  async findRecentJobMatch(
    workspaceId: string,
    companyName?: string | null,
    jobTitle?: string | null,
    excludeId?: string,
  ): Promise<ExistingRef | null> {
    const fingerprint = createJobFingerprint(companyName, jobTitle);
    if (!fingerprint) return null;

    const cutoff = this.fingerprintCutoff();
    const select = existingRefSelect();

    const exact = await this.prisma.jobApplication.findFirst({
      where: {
        workspace_id: workspaceId,
        job_fingerprint: fingerprint,
        created_at: { gte: cutoff },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select,
      orderBy: { created_at: 'desc' },
    });
    if (exact) return toExistingRef(exact);

    // Rows created before this column was introduced remain useful without a large backfill.
    const legacy = await this.prisma.jobApplication.findMany({
      where: {
        workspace_id: workspaceId,
        job_fingerprint: null,
        created_at: { gte: cutoff },
        company_name: { not: null },
        job_title: { not: null },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select,
      orderBy: { created_at: 'desc' },
    });
    const match = legacy.find(
      (row) => createJobFingerprint(row.company_name, row.job_title) === fingerprint,
    );
    return match ? toExistingRef(match) : null;
  }

  private fingerprintCutoff() {
    const configuredDays = Number(process.env.JOB_FINGERPRINT_WINDOW_DAYS ?? 90);
    const windowDays = Number.isFinite(configuredDays)
      ? Math.min(365, Math.max(1, Math.trunc(configuredDays)))
      : 90;
    return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  }

  async findExisting(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
  ): Promise<Map<string, DuplicateReference>> {
    const normalized = urls.map(normalizeUrl);
    const byNormalized = new Map<string, DuplicateReference>();

    // Bounded chunks keep query payloads predictable for very large imports.
    const CHUNK = 400;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const rows = await this.prisma.jobApplication.findMany({
        where: {
          ...(excludeId ? { id: { not: excludeId } } : {}),
          normalized_url: { in: normalized.slice(i, i + CHUNK) },
        },
        select: {
          id: true,
          url: true,
          job_title: true,
          company_name: true,
          normalized_url: true,
          workspace_id: true,
          date: true,
          number: true,
        },
        orderBy: { created_at: 'asc' },
      });

      for (const row of rows) {
        const current = byNormalized.get(row.normalized_url);
        // Prefer a reference from the caller's workspace when both local and cross-workspace rows
        // exist. This preserves safe idempotent retries without exposing another workspace.
        if (current?.same_workspace || (current && row.workspace_id !== workspaceId)) continue;
        byNormalized.set(
          row.normalized_url,
          row.workspace_id === workspaceId
            ? toExistingRef(row)
            : { same_workspace: false },
        );
      }
    }

    return byNormalized;
  }

  async classifyBatch(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
  ): Promise<DuplicateVerdict[]> {
    const existing = await this.findExisting(workspaceId, urls, excludeId);
    const seenNormalized = new Set<string>();

    return urls.map((url) => {
      const normalizedUrl = normalizeUrl(url);
      const existingRow = existing.get(normalizedUrl);
      if (existingRow) {
        seenNormalized.add(normalizedUrl);
        return {
          url,
          normalized_url: normalizedUrl,
          is_duplicate: true,
          reason: 'existing' as const,
          duplicate_type: 'url' as const,
          existing: existingRow,
        };
      }
      if (seenNormalized.has(normalizedUrl)) {
        return {
          url,
          normalized_url: normalizedUrl,
          is_duplicate: true,
          reason: 'within_batch' as const,
          duplicate_type: 'url' as const,
        };
      }
      seenNormalized.add(normalizedUrl);
      return {
        url,
        normalized_url: normalizedUrl,
        is_duplicate: false,
        reason: null,
        duplicate_type: null,
      };
    });
  }
}

export interface ExistingRef {
  same_workspace: true;
  id: string;
  url: string;
  job_title: string | null;
  company_name: string | null;
  normalized_url: string;
  workspace_id: string;
  date: Date;
  number: number;
}

/** Deliberately contains no tenant or application metadata. */
export interface CrossWorkspaceDuplicateRef {
  same_workspace: false;
}

export type DuplicateReference = ExistingRef | CrossWorkspaceDuplicateRef;

export interface DuplicateVerdict {
  url: string;
  normalized_url: string;
  is_duplicate: boolean;
  reason: 'existing' | 'within_batch' | null;
  duplicate_type: 'url' | 'job_fingerprint' | null;
  existing?: DuplicateReference;
}

export interface JobIdentityVerdict {
  fingerprint: string | null;
  is_duplicate: boolean;
  reason: 'existing' | 'within_batch' | null;
  existing?: ExistingRef;
}

function existingRefSelect() {
  return {
    id: true,
    url: true,
    job_title: true,
    company_name: true,
    normalized_url: true,
    workspace_id: true,
    date: true,
    number: true,
  } as const;
}

function toExistingRef(row: {
  id: string;
  url: string;
  job_title: string | null;
  company_name: string | null;
  normalized_url: string;
  workspace_id: string;
  date: Date;
  number: number;
}): ExistingRef {
  return {
    same_workspace: true,
    id: row.id,
    url: row.url,
    job_title: row.job_title,
    company_name: row.company_name,
    normalized_url: row.normalized_url,
    workspace_id: row.workspace_id,
    date: row.date,
    number: row.number,
  };
}
