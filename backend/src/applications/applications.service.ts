import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { MetadataService } from './metadata.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  APPLICATION_STATUSES, ApplicationStatus, DEFAULT_PAGE_SIZE, IMPORT_CHUNK_SIZE,
  MAX_PAGE_SIZE, MAX_ROWS_PER_INGEST,
} from '../common/constants';
import {
  assertRowNotLocked, assertStatusTransition, filterPatchByRole, isAdmin,
} from '../common/policies/application.policy';
import { endOfDay, toDayStart } from '../common/utils/date.util';
import { detectJobSource, looksLikeUrl, normalizeUrl } from '../common/utils/url.util';
import {
  BulkIdsDto, BulkUpdateApplicationsDto, CreateFromUrlsDto, QueryApplicationsDto,
  UpdateApplicationDto, UpdatePipelineDto,
} from './dto/application.dto';

const ROW_SELECT = {
  id: true, workspace_id: true, date: true, number: true, job_title: true, company_name: true,
  url: true, normalized_url: true, job_source: true, application_status: true, pipeline_status: true,
  note: true, paid: true,
  resume_link: true, created_by_user_id: true, created_at: true, updated_at: true,
} as const;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly numbering: NumberingService,
    private readonly duplicates: DuplicateService,
    private readonly metadata: MetadataService,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Server-side paginated / filtered / sorted list.
   *
   * Offset pagination (not cursor) because the virtualised grid needs *random access* — the scrollbar
   * can jump straight to row 43,000, which a cursor cannot express. `page_size` is capped at 500 so a
   * single request stays bounded regardless of what the client asks for.
   */
  async findAll(user: AuthUser, query: QueryApplicationsDto) {
    await this.access.assertCanView(user, query.workspace_id);

    const where = this.buildWhere(query);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(query.page_size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.jobApplication.count({ where }),
      this.prisma.jobApplication.findMany({
        where,
        select: ROW_SELECT,
        orderBy: this.buildOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize) || 1,
    };
  }

  /** Counts per status / pipeline / source for the filter chips and the workspace header. */
  async summary(user: AuthUser, workspaceId: string) {
    await this.access.assertCanView(user, workspaceId);

    const [byStatus, byPipeline, bySource, paidCount, total] = await Promise.all([
      this.prisma.jobApplication.groupBy({
        by: ['application_status'],
        where: { workspace_id: workspaceId },
        _count: { _all: true },
      }),
      this.prisma.jobApplication.groupBy({
        by: ['pipeline_status'],
        where: { workspace_id: workspaceId },
        _count: { _all: true },
      }),
      this.prisma.jobApplication.groupBy({
        by: ['job_source'],
        where: { workspace_id: workspaceId },
        _count: { _all: true },
      }),
      this.prisma.jobApplication.count({ where: { workspace_id: workspaceId, paid: true } }),
      this.prisma.jobApplication.count({ where: { workspace_id: workspaceId } }),
    ]);

    return {
      total,
      paid: paidCount,
      by_application_status: toCountMap(byStatus, 'application_status'),
      by_pipeline_status: toCountMap(byPipeline, 'pipeline_status'),
      by_job_source: toCountMap(bySource, 'job_source'),
    };
  }

  async findOne(user: AuthUser, id: string) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id }, select: ROW_SELECT });
    if (!row) throw new NotFoundException('Application not found');
    await this.access.assertCanView(user, row.workspace_id);
    return row;
  }

  // -------------------------------------------------------------------------
  // Write — single row
  // -------------------------------------------------------------------------

  /**
   * The canonical write path. Order of checks is deliberate and mirrored by every other mutation:
   *   scope → paid lock → field filter → status transition → persist
   */
  async update(user: AuthUser, id: string, dto: UpdateApplicationDto) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Application not found');

    await this.access.assertCanEdit(user, row.workspace_id);
    assertRowNotLocked(row, user.role);

    const patch = filterPatchByRole({ ...dto }, row, user.role);

    if (patch.application_status && patch.application_status !== row.application_status) {
      assertStatusTransition(
        row.application_status as ApplicationStatus,
        patch.application_status,
        user.role,
      );
    }

    const data: Prisma.JobApplicationUpdateInput = {};

    // Changing the URL re-derives everything that depends on it, including duplicate status.
    if (patch.url !== undefined && patch.url !== row.url) {
      const url = patch.url.trim();
      if (!looksLikeUrl(url)) throw new BadRequestException(`"${url}" is not a valid URL`);
      const normalized = normalizeUrl(url);
      data.url = url;
      data.normalized_url = normalized;
      data.job_source = detectJobSource(url);

      const [verdict] = await this.duplicates.classifyBatch(row.workspace_id, [url], row.id);
      if (verdict.is_duplicate && isAdmin(user.role)) {
        data.application_status = 'Duplicated';
      } else if (verdict.is_duplicate) {
        throw new BadRequestException(
          'That URL already exists in the system. Editing a row into a duplicate is not allowed ' +
            '(duplicates affect payment); ask an admin if this is intentional.',
        );
      }
    }

    // Explicit job_source override wins over re-detection.
    if (patch.job_source !== undefined) data.job_source = patch.job_source;

    if (patch.date !== undefined) {
      const newDate = toDayStart(patch.date);
      if (newDate.getTime() !== row.date.getTime()) {
        // Moving a row to another day means it needs a number valid for that day.
        data.date = newDate;
        data.number = await this.numbering.reserveBlock(
          this.prisma, row.workspace_id, newDate, 1,
        );
      }
    }

    for (const key of ['job_title', 'company_name', 'note', 'resume_link'] as const) {
      if (patch[key] !== undefined) (data as any)[key] = emptyToNull(patch[key]);
    }
    if (patch.application_status !== undefined && data.application_status === undefined) {
      data.application_status = patch.application_status;
    }
    if (patch.pipeline_status !== undefined) data.pipeline_status = patch.pipeline_status;
    if (patch.paid !== undefined && isAdmin(user.role)) data.paid = patch.paid;
    if (Object.keys(data).length === 0) return row;

    return this.updateWithNumberRetry(id, data, row.workspace_id);
  }

  /** Admin-only pipeline update. */
  async updatePipeline(user: AuthUser, id: string, dto: UpdatePipelineDto) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Application not found');
    if (!isAdmin(user.role)) throw new ForbiddenException('Only an admin can manage pipeline status');
    await this.access.assertCanEdit(user, row.workspace_id);

    return this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(dto.pipeline_status !== undefined ? { pipeline_status: dto.pipeline_status } : {}),
      },
      select: ROW_SELECT,
    });
  }

  // -------------------------------------------------------------------------
  // Write — bulk
  // -------------------------------------------------------------------------

  /**
   * Bulk edit. Every row is evaluated through the *same* policy functions as a single edit, so bulk is
   * not a way around the state machine or the paid lock. Failures are reported per id instead of
   * failing the whole request — with 5,000 selected rows, "one row was locked" should not discard the
   * other 4,999.
   */
  async bulkUpdate(user: AuthUser, dto: BulkUpdateApplicationsDto) {
    const rows = await this.prisma.jobApplication.findMany({ where: { id: { in: dto.ids } } });
    if (rows.length === 0) throw new NotFoundException('No matching applications');

    // One access check per distinct workspace rather than per row.
    const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
    for (const wsId of workspaceIds) await this.access.assertCanEdit(user, wsId);

    const updated: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const row of rows) {
      try {
        assertRowNotLocked(row, user.role);
        const patch = filterPatchByRole({ ...dto.patch }, row, user.role);
        if (patch.application_status && patch.application_status !== row.application_status) {
          assertStatusTransition(
            row.application_status as ApplicationStatus, patch.application_status, user.role,
          );
        }

        const data: Prisma.JobApplicationUpdateInput = {};
        if (patch.application_status !== undefined) data.application_status = patch.application_status;
        if (patch.pipeline_status !== undefined) data.pipeline_status = patch.pipeline_status;
        if (patch.job_source !== undefined) data.job_source = patch.job_source;
        if (patch.note !== undefined) data.note = emptyToNull(patch.note);
        if (patch.company_name !== undefined) data.company_name = emptyToNull(patch.company_name);
        if (patch.resume_link !== undefined) data.resume_link = emptyToNull(patch.resume_link);
        if (patch.paid !== undefined && isAdmin(user.role)) data.paid = patch.paid;
        // `date` is intentionally not bulk-editable: it would require renumbering every affected row.
        if (Object.keys(data).length === 0) continue;

        await this.prisma.jobApplication.update({ where: { id: row.id }, data });
        updated.push(row.id);
      } catch (err) {
        failed.push({ id: row.id, reason: (err as Error).message });
      }
    }

    return { updated: updated.length, failed, updated_ids: updated };
  }

  /** Admin-only hard delete. */
  async bulkDelete(user: AuthUser, dto: BulkIdsDto) {
    if (!isAdmin(user.role)) throw new ForbiddenException('Only an admin can delete applications');

    const rows = await this.prisma.jobApplication.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, workspace_id: true },
    });
    const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];
    for (const workspaceId of workspaceIds) await this.access.assertCanEdit(user, workspaceId);
    const result = await this.prisma.jobApplication.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return { deleted: result.count };
  }

  // -------------------------------------------------------------------------
  // Ingestion — manual URL paste
  // -------------------------------------------------------------------------

  /**
   * One textarea line = one application.
   *
   * Pipeline: split → validate → normalise → detect source → classify duplicates → enrich → insert.
   *
   * Enrichment happens BEFORE the insert transaction so that slow network calls never hold a SQLite
   * write lock (which, being single-writer, would block every other user).
   */
  async createFromUrls(user: AuthUser, dto: CreateFromUrlsDto) {
    await this.access.assertCanEdit(user, dto.workspace_id);

    const date = toDayStart(dto.date);
    const lines = dto.urls
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) throw new BadRequestException('No URLs provided');
    if (lines.length > MAX_ROWS_PER_INGEST) {
      throw new BadRequestException(
        `Too many URLs in one request (${lines.length}). Maximum is ${MAX_ROWS_PER_INGEST}.`,
      );
    }

    const invalid: string[] = [];
    const valid: string[] = [];
    for (const line of lines) {
      if (looksLikeUrl(line)) valid.push(line);
      else invalid.push(line);
    }
    if (valid.length === 0) {
      throw new BadRequestException(
        `None of the ${lines.length} line(s) look like URLs. First problem: "${invalid[0]}"`,
      );
    }

    const verdicts = await this.duplicates.classifyBatch(dto.workspace_id, valid);
    const enrichment = await this.metadata.enrichMany(valid, dto.enrich !== false);

    const startNumber = await this.numbering.reserveBlock(
      this.prisma, dto.workspace_id, date, valid.length,
    );

    const rows = valid.map((url, i) => {
      const verdict = verdicts[i];
      const meta = enrichment.get(url) ?? { company_name: null, job_title: null };
      return {
        workspace_id: dto.workspace_id,
        date,
        number: startNumber + i,
        url,
        normalized_url: verdict.normalized_url,
        job_source: detectJobSource(url),
        // Duplicates are flagged by the SYSTEM here — this is the one path where a non-admin's action
        // results in a `Duplicated` row, and it is not a user-chosen value.
        application_status: (verdict.is_duplicate ? 'Duplicated' : 'Pending') as ApplicationStatus,
        pipeline_status: 'Not Started',
        company_name: meta.company_name,
        job_title: meta.job_title,
        created_by_user_id: user.id,
      };
    });

    const created = await this.insertChunked(rows, dto.workspace_id, date);

    return {
      created,
      duplicates: verdicts.filter((v) => v.is_duplicate).length,
      invalid_lines: invalid,
      duplicate_details: verdicts
        .filter((v) => v.is_duplicate)
        .slice(0, 50)
        .map((v) => ({
          url: v.url,
          reason: v.reason,
          existing_in: v.existing
            ? `${v.existing.workspace_name} #${v.existing.number} (${v.existing.date.toISOString().slice(0, 10)})`
            : 'this batch',
        })),
    };
  }

  /**
   * Chunked `createMany` inside a single transaction, with a retry that renumbers on collision.
   *
   * `createMany` is ~50× faster than N inserts on SQLite. The chunk size keeps us well under SQLite's
   * bound-parameter ceiling.
   */
  async insertChunked(
    rows: Prisma.JobApplicationCreateManyInput[],
    workspaceId: string,
    date: Date,
    attempts = 3,
  ): Promise<number> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        let inserted = 0;
        await this.prisma.$transaction(
          async (tx) => {
            for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
              const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
              const res = await tx.jobApplication.createMany({ data: chunk });
              inserted += res.count;
            }
          },
          { timeout: 120_000, maxWait: 15_000 },
        );
        return inserted;
      } catch (err) {
        const collision =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (collision && attempt < attempts) {
          // A concurrent insert took our numbers. Re-read the high-water mark and shift the block.
          this.logger.warn(`Number collision during batch insert; renumbering (attempt ${attempt})`);
          const dates = [...new Set(rows.map((r) => (r.date as Date).getTime()))];
          for (const t of dates) {
            const d = new Date(t);
            const base = await this.numbering.reserveBlock(this.prisma, workspaceId, d, 1);
            let n = base;
            for (const row of rows) {
              if ((row.date as Date).getTime() === t) row.number = n++;
            }
          }
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('Could not insert rows after several renumbering attempts');
  }

  /** Preview duplicates without writing anything — used by the paste page. */
  async previewUrls(user: AuthUser, workspaceId: string, urlsText: string) {
    await this.access.assertCanView(user, workspaceId);

    const lines = urlsText.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
    const valid = lines.filter(looksLikeUrl);
    const verdicts = await this.duplicates.classifyBatch(workspaceId, valid);

    return {
      total_lines: lines.length,
      valid: valid.length,
      invalid: lines.filter((l) => !looksLikeUrl(l)),
      duplicates: verdicts.filter((v) => v.is_duplicate).length,
      rows: verdicts.map((v) => ({
        url: v.url,
        normalized_url: v.normalized_url,
        job_source: detectJobSource(v.url),
        existing_url: v.existing?.url ?? null,
              existing_job_title: v.existing?.job_title ?? null,
        existing_date: v.existing?.date?.toISOString().slice(0, 10) ?? null,
        is_duplicate: v.is_duplicate,
        existing_in: v.existing
          ? `${v.existing.workspace_name} #${v.existing.number}`
          : v.reason === 'within_batch'
            ? 'duplicated within this paste'
            : null,
      })),
      duplicate_scope: this.duplicates.scope,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async updateWithNumberRetry(
    id: string,
    data: Prisma.JobApplicationUpdateInput,
    workspaceId: string,
  ) {
    try {
      return await this.prisma.jobApplication.update({ where: { id }, data, select: ROW_SELECT });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && data.date) {
        data.number = await this.numbering.reserveBlock(
          this.prisma, workspaceId, data.date as Date, 1,
        );
        return this.prisma.jobApplication.update({ where: { id }, data, select: ROW_SELECT });
      }
      throw err;
    }
  }

  private buildWhere(query: QueryApplicationsDto): Prisma.JobApplicationWhereInput {
    const where: Prisma.JobApplicationWhereInput = { workspace_id: query.workspace_id };

    if (query.application_status?.length) {
      where.application_status = { in: query.application_status };
    }
    if (query.pipeline_status?.length) where.pipeline_status = { in: query.pipeline_status };
    if (query.job_source?.length) where.job_source = { in: query.job_source };
    if (query.paid !== undefined) where.paid = query.paid;

    if (query.date_from || query.date_to) {
      where.date = {
        ...(query.date_from ? { gte: toDayStart(query.date_from) } : {}),
        ...(query.date_to ? { lte: endOfDay(toDayStart(query.date_to)) } : {}),
      };
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      // SQLite `LIKE` is case-insensitive for ASCII by default, which is what we want here and is
      // why `mode: 'insensitive'` (unsupported on SQLite) is not used.
      where.OR = [
        { job_title: { contains: q } },
        { company_name: { contains: q } },
        { url: { contains: q } },
        { note: { contains: q } },
      ];
    }
    return where;
  }

  private buildOrderBy(query: QueryApplicationsDto): Prisma.JobApplicationOrderByWithRelationInput[] {
    const dir = query.sort_dir ?? 'desc';
    const field = query.sort_by ?? 'date';

    // Date is the primary grouping; application numbers always increase within each date so the
    // per-day sequence reads #1, #2, #3. The tiebreaker also keeps virtualised pages stable.
    if (field === 'date') return [{ date: dir }, { number: 'asc' }];
    if (field === 'number') return [{ number: dir }, { date: dir }];
    return [{ [field]: dir } as any, { date: 'desc' }, { number: 'desc' }];
  }
}

function toCountMap<T extends Record<string, any>>(rows: T[], key: keyof T) {
  const out: Record<string, number> = {};
  for (const row of rows) out[String(row[key])] = row._count._all;
  return out;
}

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

export { APPLICATION_STATUSES };
