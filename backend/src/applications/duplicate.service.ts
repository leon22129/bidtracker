import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUrl } from '../common/utils/url.util';
import { normalizeCompanyIdentity } from '../common/utils/job-fingerprint.util';

/** Exact URL detection plus a workspace-local cooldown for recent applications at a company. */
@Injectable()
export class DuplicateService {
  constructor(private readonly prisma: PrismaService) {}

  async classifyCompanyIdentities(
    workspaceId: string,
    items: Array<{ company_name?: string | null }>,
    excludeIds: string[] = [],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<CompanyIdentityVerdict[]> {
    const identities = items.map((item) => item.company_name?.trim()
      ? normalizeCompanyIdentity(item.company_name)
      : null);
    const requested = new Set(identities.filter((value): value is string => Boolean(value)));
    const existing = new Map<string, ExistingRef>();
    const select = existingRefSelect();

    if (requested.size) {
      const rows = await db.jobApplication.findMany({
        where: this.companyCooldownWhere(workspaceId, excludeIds),
        select,
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      });
      for (const row of rows) {
        const identity = row.company_name ? normalizeCompanyIdentity(row.company_name) : null;
        if (identity && requested.has(identity) && !existing.has(identity)) {
          existing.set(identity, toExistingRef(row));
        }
      }
    }

    const seen = new Set<string>();
    return identities.map((companyIdentity) => {
      if (!companyIdentity) return { company_identity: null, is_duplicate: false, reason: null };
      const existingRow = existing.get(companyIdentity);
      if (existingRow) {
        seen.add(companyIdentity);
        return { company_identity: companyIdentity, is_duplicate: true, reason: 'existing' as const, existing: existingRow };
      }
      if (seen.has(companyIdentity)) {
        return { company_identity: companyIdentity, is_duplicate: true, reason: 'within_batch' as const };
      }
      seen.add(companyIdentity);
      return { company_identity: companyIdentity, is_duplicate: false, reason: null };
    });
  }

  /** Company matches are profile/workspace-local and expire after the configured cooldown. */
  async findRecentCompanyMatch(
    workspaceId: string,
    companyName?: string | null,
    excludeId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ExistingRef | null> {
    if (!companyName?.trim()) return null;
    const companyIdentity = normalizeCompanyIdentity(companyName);
    if (!companyIdentity) return null;

    const rows = await db.jobApplication.findMany({
      where: this.companyCooldownWhere(workspaceId, excludeId ? [excludeId] : []),
      select: existingRefSelect(),
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    });
    const match = rows.find((row) => row.company_name
      && normalizeCompanyIdentity(row.company_name) === companyIdentity);
    return match ? toExistingRef(match) : null;
  }

  companyCooldownDays() {
    const configuredDays = Number(
      process.env.COMPANY_APPLICATION_COOLDOWN_DAYS
        ?? process.env.JOB_FINGERPRINT_WINDOW_DAYS
        ?? 90,
    );
    return Number.isInteger(configuredDays) && configuredDays > 0
      ? configuredDays
      : 90;
  }

  private companyCooldownWhere(workspaceId: string, excludeIds: string[]): Prisma.JobApplicationWhereInput {
    return {
      workspace_id: workspaceId,
      date: { gte: this.companyCooldownCutoff() },
      company_name: { not: null },
      // Every recorded company row occupies the cooldown, regardless of status or note.
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    };
  }

  private companyCooldownCutoff() {
    const cutoff = new Date(Date.now() - this.companyCooldownDays() * 24 * 60 * 60 * 1000);
    // Application dates are UTC day buckets; include the entire boundary date.
    cutoff.setUTCHours(0, 0, 0, 0);
    return cutoff;
  }

  async findExisting(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, ExistingRef>> {
    const normalized = urls.map(normalizeUrl);
    const byNormalized = new Map<string, ExistingRef>();

    // Bounded chunks keep query payloads predictable for very large imports.
    const CHUNK = 400;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const rows = await db.jobApplication.findMany({
        where: {
          workspace_id: workspaceId,
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
        if (!byNormalized.has(row.normalized_url)) {
          byNormalized.set(row.normalized_url, toExistingRef(row));
        }
      }
    }

    return byNormalized;
  }

  async classifyBatch(
    workspaceId: string,
    urls: string[],
    excludeId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<DuplicateVerdict[]> {
    const existing = await this.findExisting(workspaceId, urls, excludeId, db);
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

export interface DuplicateVerdict {
  url: string;
  normalized_url: string;
  is_duplicate: boolean;
  reason: 'existing' | 'within_batch' | null;
  duplicate_type: 'url' | 'company' | null;
  existing?: ExistingRef;
}

export interface CompanyIdentityVerdict {
  company_identity: string | null;
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
