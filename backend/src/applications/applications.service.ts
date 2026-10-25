import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { isNumberCollision, NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  APPLICATION_STATUSES, ApplicationStatus, DEFAULT_PAGE_SIZE, IMPORT_CHUNK_SIZE,
  MAX_PAGE_SIZE,
} from '../common/constants';
import {
  assertRowNotLocked, assertStatusTransition, filterPatchByRole, isAdmin,
} from '../common/policies/application.policy';
import { endOfDay, toDayStart } from '../common/utils/date.util';
import {
  BANNED_URL_NOTE,
  detectJobSource,
  looksLikeUrl,
  normalizeUrl,
} from '../common/utils/url.util';
import { createJobFingerprint } from '../common/utils/job-fingerprint.util';
import { isActiveUrlCollision } from '../common/utils/prisma-error.util';
import { BannedUrlService } from './banned-url.service';
import {
  BulkIdsDto, BulkUpdateApplicationsDto, CreateGeneratedApplicationDto, CreateManualApplicationDto,
  QueryApplicationsDto,
  UpdateApplicationDto, UpdatePipelineDto,
} from './dto/application.dto';
import { SlackNotificationService } from './slack-notification.service';
import { parseApplicationHistory } from '../common/utils/application-history.util';

const ROW_SELECT = {
  id: true, workspace_id: true, date: true, number: true, job_title: true, company_name: true,
  url: true, normalized_url: true, job_source: true, application_status: true, pipeline_status: true,
  interview_date: true, interview_note: true, note: true, paid: true,
  resume_generated_at: true, cover_letter_template: true,
  created_by_user_id: true, created_at: true, updated_at: true,
} as const;

export interface WorkspaceWriteContext {
  db: Prisma.TransactionClient;
  notifyUsers: Set<string>;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly numbering: NumberingService,
    private readonly duplicates: DuplicateService,
    private readonly bannedUrls: BannedUrlService,
    private readonly slackNotifications: SlackNotificationService,
  ) {}

  /** Serialize checks and writes across processes; release the lock only after commit. */
  async withWorkspaceWrite<T>(
    workspaceIds: string | string[],
    action: (context: WorkspaceWriteContext) => Promise<T>,
  ): Promise<T> {
    const ids = [...new Set(Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])].sort();
    for (let attempt = 1; ; attempt++) {
      const notifyUsers = new Set<string>();
      let result: T;
      try {
        result = await this.prisma.$transaction(async (db) => {
          for (const id of ids) {
            await db.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${id} FOR UPDATE`;
          }
          return action({ db, notifyUsers });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000, maxWait: 15_000 });
      } catch (error) {
        // Retry the whole transaction: a PostgreSQL constraint error aborts its transaction.
        if (attempt < 3 && (isNumberCollision(error) || isActiveUrlCollision(error))) continue;
        throw error;
      }
      await Promise.all([...notifyUsers].map((id) => this.slackNotifications.notifyApplicationCreated(id)));
      return result;
    }
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Cursor pagination serves adjacent virtual-grid pages without scanning skipped rows. Page/offset
   * remains a bounded fallback when the scrollbar jumps to a page whose neighbouring cursor is unknown.
   */
  async findAll(user: AuthUser, query: QueryApplicationsDto) {
    await this.access.assertCanView(user, query.workspace_id);
    if (query.cursor_after && query.cursor_before) {
      throw new BadRequestException('Use either cursor_after or cursor_before, not both');
    }

    const where = this.buildWhere(query);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(query.page_size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = query.cursor_after ?? query.cursor_before;
    const itemsQuery = this.prisma.jobApplication.findMany({
      where,
      select: ROW_SELECT,
      orderBy: this.buildOrderBy(query),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
            take: query.cursor_before ? -pageSize : pageSize,
          }
        : {
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
    });
    const includeTotal = query.include_total !== false;
    const [total, items] = includeTotal
      ? await this.prisma.$transaction([
          this.prisma.jobApplication.count({ where }),
          itemsQuery,
        ])
      : [null, await itemsQuery] as const;

    return {
      items,
      total,
      page,
      page_size: pageSize,
      total_pages: total === null ? null : Math.ceil(total / pageSize) || 1,
      start_cursor: items[0]?.id ?? null,
      end_cursor: items[items.length - 1]?.id ?? null,
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
    const workspaceWhere = this.access.visibilityWhere(user);
    const row = await this.prisma.jobApplication.findFirst({
      where: {
        id,
        ...(workspaceWhere ? { workspace: workspaceWhere } : {}),
      },
      select: ROW_SELECT,
    });
    if (!row) throw new NotFoundException('Application not found');
    return row;
  }

  async getResume(user: AuthUser, id: string) {
    const workspaceWhere = this.access.visibilityWhere(user);
    const row = await this.prisma.jobApplication.findFirst({
      where: {
        id,
        ...(workspaceWhere ? { workspace: workspaceWhere } : {}),
      },
      select: {
        id: true,
        job_title: true,
        company_name: true,
        generated_resume_json: true,
        resume_template: true,
        resume_generated_at: true,
        job_description: true,
        conversation_id: true,
        cover_letter_text: true,
        cover_letter_template: true,
        application_questions_json: true,
        application_answers_json: true,
      },
    });
    if (!row) throw new NotFoundException('Application not found');
    if (!row.generated_resume_json) throw new NotFoundException('No saved resume for this application');

    try {
      const history = parseApplicationHistory(
        row.application_questions_json,
        row.application_answers_json,
      );
      return {
        id: row.id,
        job_title: row.job_title,
        company_name: row.company_name,
        resume: JSON.parse(row.generated_resume_json),
        template: row.resume_template || 'classic',
        generated_at: row.resume_generated_at,
        job_description: row.job_description,
        cover_letter_text: row.cover_letter_text,
        cover_letter_template: row.cover_letter_template || 'classic',
        conversation_available: Boolean(row.conversation_id),
        questions: history?.questions ?? [],
        answers: history?.answers ?? [],
      };
    } catch {
      throw new BadRequestException('The saved resume is corrupted');
    }
  }

  /** Restores the most recent generation owned by the signed-in user in this workspace. */
  async getLatestGenerated(user: AuthUser, workspaceId: string) {
    if (!workspaceId?.trim()) throw new BadRequestException('workspace_id is required');
    await this.access.assertCanView(user, workspaceId);

    const row = await this.prisma.jobApplication.findFirst({
      where: {
        workspace_id: workspaceId,
        created_by_user_id: user.id,
        generated_resume_json: { not: null },
      },
      select: {
        id: true,
        url: true,
        job_title: true,
        company_name: true,
        generated_resume_json: true,
        resume_template: true,
        resume_generated_at: true,
        job_description: true,
        conversation_id: true,
        cover_letter_text: true,
        cover_letter_template: true,
        application_questions_json: true,
        application_answers_json: true,
      },
      orderBy: [
        { resume_generated_at: 'desc' },
        { created_at: 'desc' },
      ],
    });
    if (!row) throw new NotFoundException('No generated application found');

    try {
      const history = parseApplicationHistory(
        row.application_questions_json,
        row.application_answers_json,
      );
      return {
        id: row.id,
        url: row.url,
        job_title: row.job_title,
        company_name: row.company_name,
        resume: JSON.parse(row.generated_resume_json!),
        template: row.resume_template || 'classic',
        generated_at: row.resume_generated_at,
        job_description: row.job_description,
        conversation_id: row.conversation_id,
        cover_letter_text: row.cover_letter_text,
        cover_letter_template: row.cover_letter_template || 'classic',
        questions: history?.questions ?? null,
        answers: history?.answers ?? null,
      };
    } catch {
      throw new BadRequestException('The saved resume is corrupted');
    }
  }

  // -------------------------------------------------------------------------
  // Write — single row
  // -------------------------------------------------------------------------

  /**
   * The canonical write path. Order of checks is deliberate and mirrored by every other mutation:
   *   scope → paid lock → field filter → status transition → persist
   */
  async update(user: AuthUser, id: string, dto: UpdateApplicationDto, context?: WorkspaceWriteContext) {
    if (!context) {
      const row = await this.prisma.jobApplication.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Application not found');
      return this.withWorkspaceWrite(row.workspace_id, (write) => this.update(user, id, dto, write));
    }
    const db = context.db;
    const row = await db.jobApplication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Application not found');

    await this.access.assertCanEdit(user, row.workspace_id, { allowArchived: true, db });
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

      if (await this.bannedUrls.matches(url, db)) {
        data.application_status = 'Banned';
        data.note = BANNED_URL_NOTE;
      } else {
        const [verdict] = await this.duplicates.classifyBatch(
          row.workspace_id,
          [url],
          row.id,
          db,
        );
        if (verdict.is_duplicate && isAdmin(user.role)) {
          data.application_status = 'Duplicated';
        } else if (verdict.is_duplicate) {
          throw new BadRequestException(
            'That URL already exists in this workspace. Editing a row into a duplicate is not allowed ' +
              '(duplicates affect payment); ask an admin if this is intentional.',
          );
        }
      }
    }

    if (patch.company_name !== undefined && patch.company_name !== row.company_name) {
      data.company_name = emptyToNull(patch.company_name);
    }

    // Explicit job_source override wins over re-detection.
    if (patch.job_source !== undefined) data.job_source = patch.job_source;

    if (patch.date !== undefined) {
      const newDate = toDayStart(patch.date);
      if (newDate.getTime() !== row.date.getTime()) {
        // Moving a row to another day means it needs a number valid for that day.
        data.date = newDate;
        data.number = await this.numbering.reserveBlock(
          db, row.workspace_id, newDate, 1,
        );
      }
    }

    for (const key of ['job_title', 'note'] as const) {
      if (patch[key] !== undefined) (data as any)[key] = emptyToNull(patch[key]);
    }
    if (patch.company_name !== undefined || patch.job_title !== undefined) {
      data.job_fingerprint = createJobFingerprint(
        patch.company_name !== undefined ? emptyToNull(patch.company_name) : row.company_name,
        patch.job_title !== undefined ? emptyToNull(patch.job_title) : row.job_title,
      );
    }
    if (patch.application_status !== undefined && data.application_status === undefined) {
      data.application_status = patch.application_status;
    }
    const finalUrl = (data.url ?? row.url ?? '').toString().trim();
    const finalIsBanned = finalUrl ? await this.bannedUrls.matches(finalUrl, db) : false;
    if (finalIsBanned) {
      data.application_status = 'Banned';
      data.note = BANNED_URL_NOTE;
    }
    if (
      patch.company_name !== undefined || patch.job_title !== undefined
      || data.date !== undefined
      || (data.application_status === 'Applied' && row.application_status !== 'Applied')
    ) {
      const companyName = patch.company_name !== undefined
        ? emptyToNull(patch.company_name)
        : row.company_name;
      const similar = await this.duplicates.findRecentCompanyMatch(
        row.workspace_id,
        companyName,
        row.id,
        db,
      );
      if (similar) {
        throw new BadRequestException(
          `An application at ${companyName} already exists within this profile's ${this.duplicates.companyCooldownDays()}-day company cooldown.`,
        );
      }
    }
    if (patch.pipeline_status !== undefined) data.pipeline_status = patch.pipeline_status;
    if (patch.paid !== undefined && isAdmin(user.role)) data.paid = patch.paid;
    if (Object.keys(data).length === 0) return row;

    return db.jobApplication.update({ where: { id }, data, select: ROW_SELECT });
  }

  /** Admin-only pipeline update. */
  async updatePipeline(user: AuthUser, id: string, dto: UpdatePipelineDto) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Application not found');
    if (!isAdmin(user.role)) throw new ForbiddenException('Only an admin can manage pipeline status');
    await this.access.assertCanEdit(user, row.workspace_id, { allowArchived: true });

    return this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(dto.pipeline_status !== undefined ? { pipeline_status: dto.pipeline_status } : {}),
        ...(dto.interview_date !== undefined
          ? { interview_date: dto.interview_date === null ? null : new Date(dto.interview_date) }
          : {}),
        ...(dto.interview_note !== undefined
          ? { interview_note: emptyToNull(dto.interview_note) }
          : {}),
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
  async bulkUpdate(user: AuthUser, dto: BulkUpdateApplicationsDto, context?: WorkspaceWriteContext) {
    if (!context) {
      const rows = await this.prisma.jobApplication.findMany({
        where: { id: { in: dto.ids } }, select: { workspace_id: true },
      });
      return this.withWorkspaceWrite(rows.map((row) => row.workspace_id), (write) => this.bulkUpdate(user, dto, write));
    }
    const db = context.db;
    const rows = await db.jobApplication.findMany({ where: { id: { in: dto.ids } } });
    if (rows.length === 0) throw new NotFoundException('No matching applications');

    // One access check per distinct workspace rather than per row.
    const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
    for (const wsId of workspaceIds) {
      await this.access.assertCanEdit(user, wsId, { allowArchived: true, db });
    }

    const failed: Array<{ id: string; reason: string }> = [];
    const bannedVerdicts = await this.bannedUrls.matchMany(rows.map((row) => row.url), db);
    const bannedById = new Map(rows.map((row, index) => [row.id, bannedVerdicts[index]]));
    const identityById = new Map<string, Awaited<ReturnType<DuplicateService['classifyCompanyIdentities']>>[number]>();

    const changesCompanyIdentity = dto.patch.company_name !== undefined || dto.patch.job_title !== undefined;
    if (changesCompanyIdentity || dto.patch.application_status === 'Applied') {
      for (const workspaceId of workspaceIds) {
        const workspaceRows = rows.filter((row) => {
          if (row.workspace_id !== workspaceId) return false;
          if (!changesCompanyIdentity && row.application_status === 'Applied') return false;
          // Rows that cannot be updated must not reserve a company ahead of valid rows in the batch.
          try {
            assertRowNotLocked(row, user.role);
            const patch = filterPatchByRole({ ...dto.patch }, row, user.role);
            if (patch.application_status && patch.application_status !== row.application_status) {
              assertStatusTransition(row.application_status, patch.application_status, user.role);
            }
            return true;
          } catch {
            return false;
          }
        });
        if (!workspaceRows.length) continue;
        const identities = await this.duplicates.classifyCompanyIdentities(
          workspaceId,
          workspaceRows.map((row) => ({
            company_name: dto.patch.company_name !== undefined
              ? emptyToNull(dto.patch.company_name)
              : row.company_name,
            job_title: dto.patch.job_title !== undefined
              ? emptyToNull(dto.patch.job_title)
              : row.job_title,
          })),
          workspaceRows.map((row) => row.id),
          db,
        );
        workspaceRows.forEach((row, index) => identityById.set(row.id, identities[index]));
      }
    }

    const updateGroups = new Map<string, {
      data: Prisma.JobApplicationUpdateManyMutationInput;
      ids: string[];
    }>();

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
        if (patch.company_name !== undefined) {
          const companyName = emptyToNull(patch.company_name);
          data.company_name = companyName;
        }
        if (patch.job_title !== undefined) data.job_title = emptyToNull(patch.job_title);
        if (patch.company_name !== undefined || patch.job_title !== undefined) {
          const companyName = patch.company_name !== undefined ? emptyToNull(patch.company_name) : row.company_name;
          const jobTitle = patch.job_title !== undefined ? emptyToNull(patch.job_title) : row.job_title;
          data.job_fingerprint = createJobFingerprint(companyName, jobTitle);
        }
        const identity = identityById.get(row.id);
        if (identity?.is_duplicate) throw new BadRequestException(`An application at that company already exists within this profile's ${this.duplicates.companyCooldownDays()}-day company cooldown.`);
        if (patch.paid !== undefined && isAdmin(user.role)) data.paid = patch.paid;
        if (bannedById.get(row.id)) {
          data.application_status = 'Banned';
          data.note = BANNED_URL_NOTE;
        }
        // `date` is intentionally not bulk-editable: it would require renumbering every affected row.
        if (Object.keys(data).length === 0) continue;

        const updateData = data as Prisma.JobApplicationUpdateManyMutationInput;
        const key = JSON.stringify(updateData);
        const group = updateGroups.get(key) ?? { data: updateData, ids: [] };
        group.ids.push(row.id);
        updateGroups.set(key, group);
      } catch (err) {
        failed.push({ id: row.id, reason: (err as Error).message });
      }
    }

    if (updateGroups.size) {
      for (const group of updateGroups.values()) {
        await db.jobApplication.updateMany({
          where: { id: { in: group.ids } },
          data: group.data,
        });
      }
    }
    const updated = [...updateGroups.values()].flatMap((group) => group.ids);

    return { updated: updated.length, failed, updated_ids: updated };
  }

  /** Admins may delete any row; bidders may remove only unpaid pending/duplicate rows. */
  async bulkDelete(user: AuthUser, dto: BulkIdsDto) {
    const rows = await this.prisma.jobApplication.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, workspace_id: true, application_status: true, paid: true },
    });
    if (rows.length === 0) throw new NotFoundException('No matching applications');

    const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];
    for (const workspaceId of workspaceIds) {
      await this.access.assertCanEdit(user, workspaceId, { allowArchived: true });
    }

    if (!isAdmin(user.role)) {
      const blocked = rows.find((row) => (
        row.paid || !['Pending', 'Duplicated'].includes(row.application_status)
      ));
      if (blocked) {
        throw new ForbiddenException(
          'Bidders and bidder managers can delete only unpaid Pending or Duplicated applications',
        );
      }
    }

    const result = await this.prisma.jobApplication.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return { deleted: result.count };
  }

  // -------------------------------------------------------------------------
  // Ingestion helpers
  // -------------------------------------------------------------------------

  /** Creates a complete application entered directly from the workspace UI. */
  async createManual(user: AuthUser, dto: CreateManualApplicationDto, context?: WorkspaceWriteContext) {
    if (!context) return this.withWorkspaceWrite(dto.workspace_id, (write) => this.createManual(user, dto, write));
    const db = context.db;
    await this.access.assertCanEdit(user, dto.workspace_id, { db });
    assertStatusTransition('Pending', dto.application_status, user.role);

    const url = dto.url.trim();
    const companyName = dto.company_name.trim();
    const jobTitle = dto.job_title.trim();
    if (!companyName || !jobTitle) {
      throw new BadRequestException('Company name and job title are required.');
    }
    if (!looksLikeUrl(url)) throw new BadRequestException(`"${url}" is not a valid URL`);

    const [[urlVerdict], banned] = await Promise.all([
      this.duplicates.classifyBatch(dto.workspace_id, [url], undefined, db),
      this.bannedUrls.matches(url, db),
    ]);
    const recentCompanyApplication = await this.duplicates.findRecentCompanyMatch(dto.workspace_id, companyName, undefined, db);
    if (recentCompanyApplication) {
      throw new ConflictException(`An application at ${companyName} already exists within this profile's ${this.duplicates.companyCooldownDays()}-day company cooldown.`);
    }
    const applicationStatus: ApplicationStatus = banned
      ? 'Banned'
      : urlVerdict.is_duplicate
        ? 'Duplicated'
        : dto.application_status;
    const date = toDayStart(new Date());
    const create = (status: ApplicationStatus) =>
      this.numbering.withNextNumber(dto.workspace_id, date, (number) =>
        db.jobApplication.create({
          data: {
            workspace_id: dto.workspace_id,
            date,
            number,
            url,
            normalized_url: urlVerdict.normalized_url ?? normalizeUrl(url),
            job_source: detectJobSource(url),
            application_status: status,
            pipeline_status: 'Not Started',
            company_name: companyName,
            job_title: jobTitle,
            job_fingerprint: createJobFingerprint(companyName, jobTitle),
            note: banned ? BANNED_URL_NOTE : null,
            created_by_user_id: user.id,
          },
          select: ROW_SELECT,
        }),
        1, db,
      );

    const application = await create(applicationStatus);
    context.notifyUsers.add(user.id);
    return application;
  }

  /** Idempotent compatibility save path for older resume clients. */
  async createGenerated(user: AuthUser, dto: CreateGeneratedApplicationDto, context?: WorkspaceWriteContext) {
    if (!context) return this.withWorkspaceWrite(dto.workspace_id, (write) => this.createGenerated(user, dto, write));
    const db = context.db;
    await this.access.assertCanEdit(user, dto.workspace_id, { db });

    const artifactData = await this.generatedArtifactData(user, dto, db);

    const url = dto.url.trim();
    const companyName = emptyToNull(dto.company_name);
    const jobTitle = emptyToNull(dto.job_title);
    if (!companyName || !jobTitle) {
      throw new BadRequestException('Need company name and job title in the JD.');
    }
    const normalizedUrl = normalizeUrl(url);
    const jobFingerprint = createJobFingerprint(companyName, jobTitle);
    const [verdict] = await this.duplicates.classifyBatch(
      dto.workspace_id,
      [url],
      undefined, db,
    );

    if (verdict.is_duplicate) {
      // A retry is successful only when this exact URL already belongs to the requested workspace.
      if (
        verdict.duplicate_type === 'url' &&
        verdict.existing?.same_workspace &&
        verdict.existing.workspace_id === dto.workspace_id &&
        verdict.existing.normalized_url === normalizedUrl
      ) {
        const existingApplication = await db.jobApplication.findUnique({
          where: { id: verdict.existing.id },
          select: ROW_SELECT,
        });
        if (existingApplication) {
          if (Object.keys(artifactData).length) {
            const application = await db.jobApplication.update({
              where: { id: existingApplication.id },
              data: artifactData,
              select: ROW_SELECT,
            });
            return { success: true, already_added: true, application };
          }
          return { success: true, already_added: true, application: existingApplication };
        }
      }
      return {
        success: false,
        duplicate: true,
        duplicate_type: verdict.duplicate_type,
        ...(verdict.existing?.same_workspace
          ? { existing_application: verdict.existing }
          : {}),
      };
    }

    const recentCompanyApplication = await this.duplicates.findRecentCompanyMatch(
      dto.workspace_id,
      companyName,
      undefined, db,
    );
    if (recentCompanyApplication) {
      return {
        success: false,
        duplicate: true,
        duplicate_type: 'company' as const,
        existing_application: recentCompanyApplication,
      };
    }

    const date = toDayStart(new Date());
    const application = await this.numbering.withNextNumber(
        dto.workspace_id,
        date,
        (number) => db.jobApplication.create({
          data: {
            workspace_id: dto.workspace_id,
            date,
            number,
            url,
            normalized_url: verdict.normalized_url,
            job_source: detectJobSource(url),
            application_status: 'Applied',
            pipeline_status: 'Not Started',
            company_name: companyName,
            job_title: jobTitle,
            job_fingerprint: jobFingerprint,
            created_by_user_id: user.id,
            ...artifactData,
          },
          select: ROW_SELECT,
        }),
        1, db,
      );
    context.notifyUsers.add(user.id);
    return { success: true, already_added: false, application };
  }

  private async generatedArtifactData(user: AuthUser, dto: CreateGeneratedApplicationDto, db: Prisma.TransactionClient) {
    if (dto.conversation_id) {
      const conversation = await db.resumeConversation.findUnique({
        where: { id: dto.conversation_id },
        select: { user_id: true, workspace_id: true },
      });
      if (
        !conversation ||
        conversation.user_id !== user.id ||
        conversation.workspace_id !== dto.workspace_id
      ) {
        throw new BadRequestException('Conversation not found');
      }
    }

    let generatedResumeJson: string | undefined;
    if (dto.generated_resume) {
      generatedResumeJson = JSON.stringify(dto.generated_resume);
      if (generatedResumeJson.length > 250_000) {
        throw new BadRequestException('Generated resume is too large to save');
      }
    }

    return {
      ...(dto.conversation_id ? { conversation_id: dto.conversation_id } : {}),
      ...(dto.job_description ? { job_description: dto.job_description } : {}),
      ...(generatedResumeJson ? {
        generated_resume_json: generatedResumeJson,
        resume_template: dto.resume_template || 'classic',
        resume_generated_at: new Date(),
      } : {}),
      ...(dto.cover_letter_text?.trim() ? {
        cover_letter_text: dto.cover_letter_text,
        cover_letter_template: dto.cover_letter_template || 'classic',
      } : {}),
    };
  }

  /** Canonical write path for a banned URL discovered during application generation. */
  async createBannedApplication(user: AuthUser, workspaceId: string, rawUrl: string, context?: WorkspaceWriteContext) {
    if (!context) return this.withWorkspaceWrite(workspaceId, (write) => this.createBannedApplication(user, workspaceId, rawUrl, write));
    const db = context.db;
    await this.access.assertCanEdit(user, workspaceId, { db });
    const url = rawUrl.trim();
    const normalizedUrl = normalizeUrl(url);
    const [verdict] = await this.duplicates.classifyBatch(workspaceId, [url], undefined, db);
    if (verdict.is_duplicate && verdict.existing?.same_workspace) {
      return db.jobApplication.update({
        where: { id: verdict.existing.id },
        data: {
          application_status: 'Banned',
          note: BANNED_URL_NOTE,
        },
        select: ROW_SELECT,
      });
    }
    const date = toDayStart(new Date());
    const application = await this.numbering.withNextNumber(workspaceId, date, (number) =>
      db.jobApplication.create({
        data: {
          workspace_id: workspaceId,
          date,
          number,
          url,
          normalized_url: normalizedUrl,
          job_source: detectJobSource(url),
          application_status: 'Banned',
          note: BANNED_URL_NOTE,
          created_by_user_id: user.id,
        },
        select: ROW_SELECT,
      }),
      1, db,
    );
    context.notifyUsers.add(user.id);
    return application;
  }

  /** Records a job rejected by the AI eligibility gate without creating resume artifacts. */
  async createEligibilityRejectedApplication(
    user: AuthUser,
    input: {
      workspace_id: string;
      url: string;
      job_title: string;
      company_name: string;
      job_description: string;
      note: string;
    },
    context?: WorkspaceWriteContext,
  ) {
    if (!context) return this.withWorkspaceWrite(input.workspace_id, (write) => this.createEligibilityRejectedApplication(user, input, write));
    const db = context.db;
    await this.access.assertCanEdit(user, input.workspace_id, { db });
    const url = input.url.trim();
    const normalizedUrl = normalizeUrl(url);
    const [verdict] = await this.duplicates.classifyBatch(input.workspace_id, [url], undefined, db);
    if (verdict.is_duplicate && verdict.existing?.same_workspace) {
      return db.jobApplication.findUnique({
        where: { id: verdict.existing.id },
        select: ROW_SELECT,
      });
    }

    const companyMatch = await this.duplicates.findRecentCompanyMatch(input.workspace_id, input.company_name, undefined, db);
    if (companyMatch) {
      throw new ConflictException(`An application at ${input.company_name} already exists within this profile's ${this.duplicates.companyCooldownDays()}-day company cooldown.`);
    }

    const date = toDayStart(new Date());
    const application = await this.numbering.withNextNumber(input.workspace_id, date, (number) =>
      db.jobApplication.create({
        data: {
          workspace_id: input.workspace_id,
          date,
          number,
          url,
          normalized_url: normalizedUrl,
          job_source: detectJobSource(url),
          application_status: 'Rejected',
          pipeline_status: 'Not Started',
          company_name: input.company_name,
          job_title: input.job_title,
          job_fingerprint: createJobFingerprint(input.company_name, input.job_title),
          job_description: input.job_description,
          note: input.note,
          created_by_user_id: user.id,
        },
        select: ROW_SELECT,
      }),
      1, db,
    );
    context.notifyUsers.add(user.id);
    return application;
  }

  /** Inserts an import only after its checks have run under the same workspace lock. */
  async insertChunked(
    rows: Prisma.JobApplicationCreateManyInput[],
    workspaceId: string,
    context?: WorkspaceWriteContext,
  ): Promise<number> {
    if (!context) return this.withWorkspaceWrite(workspaceId, (write) => this.insertChunked(rows, workspaceId, write));
    if (rows.some((row) => row.workspace_id !== workspaceId)) {
      throw new BadRequestException('Import rows must belong to the selected workspace');
    }
    const db = context.db;
    const companies = await this.duplicates.classifyCompanyIdentities(workspaceId, rows, [], db);
    if (companies.some((company) => company.is_duplicate)) {
      throw new ConflictException('An imported company already exists within the configured cooldown');
    }
    let inserted = 0;
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
      const result = await db.jobApplication.createMany({ data: rows.slice(i, i + IMPORT_CHUNK_SIZE) });
      inserted += result.count;
    }
    for (const row of rows) context.notifyUsers.add(row.created_by_user_id);
    return inserted;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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
      where.OR = [
        { job_title: { contains: q, mode: 'insensitive' } },
        { company_name: { contains: q, mode: 'insensitive' } },
        { url: { contains: q, mode: 'insensitive' } },
        { note: { contains: q, mode: 'insensitive' } },
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
    if (field === 'number') return [{ number: dir }, { date: dir }, { id: dir }];
    return [{ [field]: dir } as any, { date: dir }, { number: dir }, { id: dir }];
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
