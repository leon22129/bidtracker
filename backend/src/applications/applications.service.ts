import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
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

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly numbering: NumberingService,
    private readonly duplicates: DuplicateService,
    private readonly bannedUrls: BannedUrlService,
    private readonly slackNotifications: SlackNotificationService,
  ) {}

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

      if (await this.bannedUrls.matches(url)) {
        data.application_status = 'Rejected';
        data.note = BANNED_URL_NOTE;
      } else {
        const [verdict] = await this.duplicates.classifyBatch(
          row.workspace_id,
          [url],
          row.id,
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
          this.prisma, row.workspace_id, newDate, 1,
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
    const finalIsBanned = finalUrl ? await this.bannedUrls.matches(finalUrl) : false;
    if (finalIsBanned) {
      data.application_status = 'Rejected';
      data.note = BANNED_URL_NOTE;
    } else if (patch.company_name !== undefined || patch.job_title !== undefined) {
      const companyName = patch.company_name !== undefined
        ? emptyToNull(patch.company_name)
        : row.company_name;
      const jobTitle = patch.job_title !== undefined ? emptyToNull(patch.job_title) : row.job_title;
      const similar = await this.duplicates.findRecentCompanyMatch(
        row.workspace_id,
        companyName,
        row.id,
      );
      if (similar && isAdmin(user.role)) data.application_status = 'Duplicated';
      else if (similar) {
        throw new BadRequestException(
          `An application at ${companyName} already exists within this profile's 90-day company cooldown.`,
        );
      }
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
  async bulkUpdate(user: AuthUser, dto: BulkUpdateApplicationsDto) {
    const rows = await this.prisma.jobApplication.findMany({ where: { id: { in: dto.ids } } });
    if (rows.length === 0) throw new NotFoundException('No matching applications');

    // One access check per distinct workspace rather than per row.
    const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
    for (const wsId of workspaceIds) await this.access.assertCanEdit(user, wsId);

    const failed: Array<{ id: string; reason: string }> = [];
    const bannedVerdicts = await this.bannedUrls.matchMany(rows.map((row) => row.url));
    const bannedById = new Map(rows.map((row, index) => [row.id, bannedVerdicts[index]]));
    const identityById = new Map<string, Awaited<ReturnType<DuplicateService['classifyCompanyIdentities']>>[number]>();

    if (dto.patch.company_name !== undefined || dto.patch.job_title !== undefined) {
      for (const workspaceId of workspaceIds) {
        const workspaceRows = rows.filter((row) => row.workspace_id === workspaceId);
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
          const identity = identityById.get(row.id);
          if (identity?.is_duplicate && isAdmin(user.role)) data.application_status = 'Duplicated';
          else if (identity?.is_duplicate) throw new BadRequestException("An application at that company already exists within this profile's 90-day company cooldown.");
        }
        if (patch.paid !== undefined && isAdmin(user.role)) data.paid = patch.paid;
        if (bannedById.get(row.id)) {
          data.application_status = 'Rejected';
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
      await this.prisma.$transaction(
        [...updateGroups.values()].map((group) => this.prisma.jobApplication.updateMany({
          where: { id: { in: group.ids } },
          data: group.data,
        })),
      );
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
    for (const workspaceId of workspaceIds) await this.access.assertCanEdit(user, workspaceId);

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
  async createManual(user: AuthUser, dto: CreateManualApplicationDto) {
    await this.access.assertCanEdit(user, dto.workspace_id);
    assertStatusTransition('Pending', dto.application_status, user.role);

    const url = dto.url.trim();
    const companyName = dto.company_name.trim();
    const jobTitle = dto.job_title.trim();
    if (!companyName || !jobTitle) {
      throw new BadRequestException('Company name and job title are required.');
    }
    if (!looksLikeUrl(url)) throw new BadRequestException(`"${url}" is not a valid URL`);

    const [[urlVerdict], banned] = await Promise.all([
      this.duplicates.classifyBatch(dto.workspace_id, [url]),
      this.bannedUrls.matches(url),
    ]);
    const recentCompanyApplication = urlVerdict.is_duplicate
      ? null
      : await this.duplicates.findRecentCompanyMatch(dto.workspace_id, companyName);
    const applicationStatus: ApplicationStatus = banned
      ? 'Rejected'
      : urlVerdict.is_duplicate || recentCompanyApplication
        ? 'Duplicated'
        : dto.application_status;
    const date = toDayStart(new Date());
    const create = (status: ApplicationStatus) =>
      this.numbering.withNextNumber(dto.workspace_id, date, (number) =>
        this.prisma.jobApplication.create({
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
      );

    let application;
    try {
      application = await create(applicationStatus);
    } catch (error) {
      if (isActiveUrlCollision(error) && ['Pending', 'Applied'].includes(applicationStatus)) {
        // Another backend committed this URL after classification. Preserve the attempted row as an
        // explicit duplicate; the database remains the final authority under cross-process races.
        application = await create('Duplicated');
      } else {
        throw error;
      }
    }
    await this.slackNotifications.notifyApplicationCreated(user.id);
    return application;
  }

  /** Idempotent compatibility save path for older resume clients. */
  async createGenerated(user: AuthUser, dto: CreateGeneratedApplicationDto) {
    await this.access.assertCanEdit(user, dto.workspace_id);

    const artifactData = await this.generatedArtifactData(user, dto);

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
    );

    if (verdict.is_duplicate) {
      // A retry is successful only when this exact URL already belongs to the requested workspace.
      if (
        verdict.duplicate_type === 'url' &&
        verdict.existing?.same_workspace &&
        verdict.existing.workspace_id === dto.workspace_id &&
        verdict.existing.normalized_url === normalizedUrl
      ) {
        const existingApplication = await this.prisma.jobApplication.findUnique({
          where: { id: verdict.existing.id },
          select: ROW_SELECT,
        });
        if (existingApplication) {
          if (Object.keys(artifactData).length) {
            const application = await this.prisma.jobApplication.update({
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
    try {
      const application = await this.numbering.withNextNumber(
        dto.workspace_id,
        date,
        (number) => this.prisma.jobApplication.create({
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
      );

      await this.slackNotifications.notifyApplicationCreated(user.id);
      return { success: true, already_added: false, application };
    } catch (error) {
      if (!isActiveUrlCollision(error)) throw error;

      const winner = await this.prisma.jobApplication.findFirst({
        where: {
          workspace_id: dto.workspace_id,
          normalized_url: normalizedUrl,
          application_status: { in: ['Pending', 'Applied'] },
        },
        select: ROW_SELECT,
        orderBy: { created_at: 'asc' },
      });
      if (winner?.workspace_id === dto.workspace_id) {
        return { success: true, already_added: true, application: winner };
      }
      return { success: false, duplicate: true, duplicate_type: 'url' as const };
    }
  }

  private async generatedArtifactData(user: AuthUser, dto: CreateGeneratedApplicationDto) {
    if (dto.conversation_id) {
      const conversation = await this.prisma.resumeConversation.findUnique({
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
  async createBannedApplication(user: AuthUser, workspaceId: string, rawUrl: string) {
    await this.access.assertCanEdit(user, workspaceId);
    const url = rawUrl.trim();
    const normalizedUrl = normalizeUrl(url);
    const [verdict] = await this.duplicates.classifyBatch(workspaceId, [url]);
    if (verdict.is_duplicate && verdict.existing?.same_workspace) {
      return this.prisma.jobApplication.update({
        where: { id: verdict.existing.id },
        data: {
          application_status: 'Rejected',
          note: BANNED_URL_NOTE,
        },
        select: ROW_SELECT,
      });
    }
    const date = toDayStart(new Date());
    const application = await this.numbering.withNextNumber(workspaceId, date, (number) =>
      this.prisma.jobApplication.create({
        data: {
          workspace_id: workspaceId,
          date,
          number,
          url,
          normalized_url: normalizedUrl,
          job_source: detectJobSource(url),
          application_status: 'Rejected',
          note: BANNED_URL_NOTE,
          created_by_user_id: user.id,
        },
        select: ROW_SELECT,
      }),
    );
    await this.slackNotifications.notifyApplicationCreated(user.id);
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
  ) {
    await this.access.assertCanEdit(user, input.workspace_id);
    const url = input.url.trim();
    const normalizedUrl = normalizeUrl(url);
    const [verdict] = await this.duplicates.classifyBatch(input.workspace_id, [url]);
    if (verdict.is_duplicate && verdict.existing?.same_workspace) {
      return this.prisma.jobApplication.findUnique({
        where: { id: verdict.existing.id },
        select: ROW_SELECT,
      });
    }

    const date = toDayStart(new Date());
    const application = await this.numbering.withNextNumber(input.workspace_id, date, (number) =>
      this.prisma.jobApplication.create({
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
    );
    await this.slackNotifications.notifyApplicationCreated(user.id);
    return application;
  }

  /**
   * Chunked `createMany` inside a single transaction, with a retry that renumbers on collision.
   *
   * `createMany` is much faster than N inserts. Chunking bounds each query payload and prevents one
   * enormous SQL statement from monopolising a connection.
   */
  async insertChunked(
    rows: Prisma.JobApplicationCreateManyInput[],
    workspaceId: string,
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
        const creatorIds = [...new Set(rows.map((row) => row.created_by_user_id))];
        await Promise.all(creatorIds.map((creatorId) => (
          this.slackNotifications.notifyApplicationCreated(creatorId)
        )));
        return inserted;
      } catch (err) {
        if (isActiveUrlCollision(err) && attempt < attempts) {
          const activeUrls = [...new Set(rows
            .filter((row) => ['Pending', 'Applied'].includes(String(row.application_status)))
            .map((row) => String(row.normalized_url)))];
          const conflicts = activeUrls.length
            ? await this.prisma.jobApplication.findMany({
                where: {
                  workspace_id: workspaceId,
                  normalized_url: { in: activeUrls },
                  application_status: { in: ['Pending', 'Applied'] },
                },
                select: { normalized_url: true },
              })
            : [];
          const conflictUrls = new Set(conflicts.map((row) => row.normalized_url));
          let reclassified = 0;
          for (const row of rows) {
            if (
              ['Pending', 'Applied'].includes(String(row.application_status)) &&
              conflictUrls.has(String(row.normalized_url))
            ) {
              row.application_status = 'Duplicated';
              reclassified++;
            }
          }
          if (reclassified > 0) {
            this.logger.warn(
              `${reclassified} import row(s) became duplicates during concurrent ingestion; retrying`,
            );
            continue;
          }
        }
        if (isNumberCollision(err) && attempt < attempts) {
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
      if (isNumberCollision(err) && data.date) {
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
