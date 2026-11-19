import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationDraft, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ApplicationsService } from './applications.service';
import { DuplicateService } from './duplicate.service';
import { BannedUrlService } from './banned-url.service';
import { NumberingService } from './numbering.service';
import { detectJobSource, normalizeUrl } from '../common/utils/url.util';
import { createJobFingerprint, normalizeCompanyIdentity } from '../common/utils/job-fingerprint.util';
import { toDayStart } from '../common/utils/date.util';
import { parseApplicationHistory } from '../common/utils/application-history.util';
import { assertScreenshotFile, screenshotDates } from './application-screenshot.service';
import { formatJobDescription } from '../common/utils/job-description.util';
import { capturedFormHistory, mergeCapturedStep, validateCapturedStep } from '../common/utils/application-form.util';

const GENERATION_LEASE_MS = 120_000;
type GenerationTarget = { workspace_id: string; company_name: string; url: string };

export type GenerationBlock = {
  success: false; duplicate: true; duplicate_type: string; company_name?: string; reason?: string;
  existing_application?: unknown; cooldown_days?: number;
  existing_draft?: { id: string; company_name: string; url: string; can_manage: boolean };
};

@Injectable()
export class ApplicationDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly applications: ApplicationsService,
    private readonly duplicates: DuplicateService,
    private readonly banned: BannedUrlService,
    private readonly numbering: NumberingService,
  ) {}

  /** Check and claim together, without holding a database transaction open during AI work. */
  async reserveGeneration(user: AuthUser, target: GenerationTarget, reservationId?: string): Promise<{ id: string } | { blocked: GenerationBlock }> {
    return this.applications.withWorkspaceWrite(target.workspace_id, async ({ db }) => {
      await this.access.assertCanEdit(user, target.workspace_id, { db });
      const normalizedUrl = target.url ? normalizeUrl(target.url) : null;
      const companyIdentity = normalizeCompanyIdentity(target.company_name);
      if (!companyIdentity) throw new BadRequestException('Need company name in the JD.');
      if (normalizedUrl) {
        const [match] = await this.duplicates.classifyBatch(target.workspace_id, [target.url], undefined, db);
        if (match.is_duplicate) return { blocked: {
          success: false, duplicate: true, duplicate_type: 'url', existing_application: match.existing,
        } };
      }
      const companyMatch = await this.duplicates.findRecentCompanyMatch(target.workspace_id, target.company_name, undefined, db);
      if (companyMatch) return { blocked: {
        success: false, duplicate: true, duplicate_type: 'company', company_name: target.company_name,
        cooldown_days: this.duplicates.companyCooldownDays(), existing_application: companyMatch,
      } };
      const cutoff = this.duplicates.companyCooldownCutoff();
      const prepared = await db.applicationDraft.findMany({
        where: { workspace_id: target.workspace_id, submitted_at: null,
          OR: [{ created_at: { gte: cutoff } }, ...(normalizedUrl ? [{ normalized_url: normalizedUrl }] : [])] },
        select: { id: true, company_name: true, url: true, normalized_url: true, created_by_user_id: true, created_at: true },
        orderBy: { created_at: 'desc' },
      });
      const draft = prepared.find((item) => (normalizedUrl && item.normalized_url === normalizedUrl)
        || (item.created_at >= cutoff && normalizeCompanyIdentity(item.company_name) === companyIdentity));
      if (draft) return { blocked: {
        success: false, duplicate: true, duplicate_type: 'prepared', company_name: draft.company_name,
        reason: draft.created_by_user_id === user.id
          ? 'A resume is already prepared for this company in this profile. Reopen that prepared job, or discard it if you are no longer applying.'
          : 'Another user already has a prepared job for this company in this profile. Ask them to finish or discard it before generating again.',
        existing_draft: { id: draft.id, company_name: draft.company_name, url: draft.url,
          can_manage: draft.created_by_user_id === user.id },
      } };

      const now = new Date();
      await db.resumeGenerationReservation.deleteMany({ where: { workspace_id: target.workspace_id, expires_at: { lte: now } } });
      if (reservationId && !await db.resumeGenerationReservation.findFirst({ where: { id: reservationId, workspace_id: target.workspace_id } })) {
        throw new ConflictException('This generation reservation expired. Please try again.');
      }
      const active = await db.resumeGenerationReservation.findFirst({ where: {
        workspace_id: target.workspace_id, ...(reservationId ? { id: { not: reservationId } } : {}),
        OR: [{ company_identity: companyIdentity }, ...(normalizedUrl ? [{ normalized_url: normalizedUrl }] : [])],
      } });
      if (active) return { blocked: {
        success: false, duplicate: true, duplicate_type: 'in_progress', company_name: target.company_name,
        reason: 'A resume for this company or job is already being generated in this profile. Wait for it to finish, then reopen the prepared job.',
      } };
      const data = { workspace_id: target.workspace_id, company_identity: companyIdentity,
        normalized_url: normalizedUrl, expires_at: new Date(Date.now() + GENERATION_LEASE_MS) };
      const claim = reservationId
        ? await db.resumeGenerationReservation.update({ where: { id: reservationId }, data })
        : await db.resumeGenerationReservation.create({ data });
      return { id: claim.id };
    });
  }

  async renewGeneration(reservationId: string) {
    const renewed = await this.prisma.resumeGenerationReservation.updateMany({
      where: { id: reservationId, expires_at: { gt: new Date() } },
      data: { expires_at: new Date(Date.now() + GENERATION_LEASE_MS) },
    });
    if (!renewed.count) throw new ConflictException('This generation reservation expired. Please try again.');
  }

  async releaseGeneration(reservationId: string) {
    await this.prisma.resumeGenerationReservation.deleteMany({ where: { id: reservationId } });
  }

  async prepare(user: AuthUser, data: Omit<Prisma.ApplicationDraftUncheckedCreateInput, 'created_by_user_id'>, reservationId?: string) {
    if (data.generated_resume_json.length > 250_000) throw new BadRequestException('Generated resume is too large to save');
    return this.applications.withWorkspaceWrite(data.workspace_id, async ({ db }) => {
      await this.access.assertCanEdit(user, data.workspace_id, { db });
      if (reservationId && !await db.resumeGenerationReservation.findFirst({ where: {
        id: reservationId, workspace_id: data.workspace_id, expires_at: { gt: new Date() },
        company_identity: normalizeCompanyIdentity(data.company_name), normalized_url: data.normalized_url || null,
      } })) throw new ConflictException('This generation reservation expired. Please try again.');
      const draft = await db.applicationDraft.create({ data: { ...data, job_description: formatJobDescription(data.job_description), created_by_user_id: user.id } });
      if (reservationId) await db.resumeGenerationReservation.deleteMany({ where: { id: reservationId } });
      return draft;
    });
  }

  async latest(user: AuthUser, workspaceId: string, mode = 'linked') {
    if (!workspaceId?.trim()) throw new BadRequestException('workspace_id is required');
    if (mode !== 'linked' && mode !== 'manual') throw new BadRequestException('Unknown application mode');
    await this.access.assertCanView(user, workspaceId);
    const draft = await this.prisma.applicationDraft.findFirst({
      where: { workspace_id: workspaceId, created_by_user_id: user.id, url: mode === 'manual' ? '' : { not: '' } }, orderBy: { created_at: 'desc' },
    });
    if (!draft) throw new NotFoundException('No prepared job found');
    return this.serialize(draft);
  }

  async getPrepared(user: AuthUser, draftId: string) {
    const draft = await this.prisma.applicationDraft.findFirst({ where: { id: draftId, created_by_user_id: user.id } });
    if (!draft) throw new NotFoundException('Prepared job not found');
    await this.access.assertCanView(user, draft.workspace_id);
    return this.serialize(draft);
  }

  async discard(user: AuthUser, draftId: string) {
    const owned = await this.prisma.applicationDraft.findFirst({
      where: { id: draftId, created_by_user_id: user.id }, select: { workspace_id: true },
    });
    if (!owned) throw new NotFoundException('Prepared job not found');
    return this.applications.withWorkspaceWrite(owned.workspace_id, async ({ db }) => {
      await this.access.assertCanEdit(user, owned.workspace_id, { db });
      const draft = await db.applicationDraft.findFirst({ where: { id: draftId, created_by_user_id: user.id } });
      if (!draft) throw new NotFoundException('Prepared job not found');
      if (draft.submitted_at) throw new ConflictException('A submitted application cannot be discarded as a prepared job.');
      await db.applicationDraft.delete({ where: { id: draftId } });
      return { discarded: true };
    });
  }

  private serialize(draft: ApplicationDraft) {
    const history = draft.submitted_at ? capturedFormHistory(draft.application_form_json)
      : parseApplicationHistory(draft.application_questions_json, draft.application_answers_json);
    return {
      id: draft.id, draft_id: draft.id, application_id: draft.submitted_application_id,
      submitted_at: draft.submitted_at, url: draft.url, company_name: draft.company_name, job_title: draft.job_title,
      source_job_description: draft.source_job_description, job_description: formatJobDescription(draft.job_description),
      resume: JSON.parse(draft.generated_resume_json), template: draft.resume_template, generated_at: draft.created_at,
      conversation_id: draft.conversation_id, cover_letter_text: draft.cover_letter_text,
      cover_letter_template: draft.cover_letter_template, questions: history?.questions ?? [], answers: history?.answers ?? [],
    };
  }

  async saveFormStep(user: AuthUser, draftId: string, input: unknown) {
    const step = validateCapturedStep(input);
    const owned = await this.prisma.applicationDraft.findFirst({
      where: { id: draftId, created_by_user_id: user.id }, select: { workspace_id: true },
    });
    if (!owned) throw new NotFoundException('Prepared job not found');
    return this.applications.withWorkspaceWrite(owned.workspace_id, async ({ db }) => {
      await this.access.assertCanEdit(user, owned.workspace_id, { db });
      const draft = await db.applicationDraft.findFirst({ where: { id: draftId, created_by_user_id: user.id } });
      if (!draft) throw new NotFoundException('Prepared job not found');
      if (draft.submitted_at) throw new ConflictException('Submitted application answers are already saved');
      await db.applicationDraft.update({ where: { id: draftId }, data: {
        application_form_json: mergeCapturedStep(draft.application_form_json, step),
      } });
      return { saved: true };
    });
  }

  /** The application, its screenshot, and the draft receipt are committed together. */
  async submit(user: AuthUser, draftId: string, file?: Express.Multer.File, submitted = false, submissionUrl?: string) {
    if (!submitted) throw new BadRequestException('Confirm successful application submission before capturing its screenshot.');
    assertScreenshotFile(file);
    const owned = await this.prisma.applicationDraft.findFirst({
      where: { id: draftId, created_by_user_id: user.id }, select: { workspace_id: true },
    });
    if (!owned) throw new NotFoundException('Prepared job not found');
    return this.applications.withWorkspaceWrite(owned.workspace_id, async ({ db, notifyUsers }) => {
      await this.access.assertCanEdit(user, owned.workspace_id, { db });
      const draft = await db.applicationDraft.findFirst({ where: { id: draftId, created_by_user_id: user.id } });
      if (!draft) throw new NotFoundException('Prepared job not found');
      if (draft.submitted_at) {
        const application = draft.submitted_application_id
          ? await db.jobApplication.findUnique({ where: { id: draft.submitted_application_id }, select: { id: true, application_status: true, number: true } })
          : null;
        if (!application) throw new ConflictException('This prepared job was already submitted');
        return { saved: true, already_added: true, application };
      }
      let url = draft.url;
      if (!url) {
        try {
          if (typeof submissionUrl !== 'string' || submissionUrl.length > 2000) throw new Error();
          const page = new URL(submissionUrl);
          if (!['http:', 'https:'].includes(page.protocol)) throw new Error();
          url = page.href;
        } catch {
          throw new BadRequestException('Open the application confirmation page before taking its screenshot.');
        }
      }
      if (await this.banned.matchesJob(url, draft.company_name, db)) {
        throw new ConflictException('This company or job URL is now banned. The application was not added.');
      }
      if (draft.url) {
        const [urlMatch] = await this.duplicates.classifyBatch(draft.workspace_id, [url], undefined, db);
        if (urlMatch.is_duplicate) throw new ConflictException('This job URL is already in the application table.');
      }
      const companyMatch = await this.duplicates.findRecentCompanyMatch(draft.workspace_id, draft.company_name, undefined, db);
      const date = toDayStart(new Date());
      const application = await this.numbering.withNextNumber(draft.workspace_id, date, (number) => db.jobApplication.create({
        data: {
          workspace_id: draft.workspace_id, date, number, url,
          // Manual confirmation pages can share a URL across different openings.
          // Keep each draft unique; company cooldowns still classify repeat applications.
          normalized_url: draft.url ? normalizeUrl(url) : `manual:${draft.id}`,
          company_name: draft.company_name, job_title: draft.job_title, job_source: detectJobSource(url),
          job_fingerprint: createJobFingerprint(draft.company_name, draft.job_title),
          application_status: companyMatch ? 'Duplicated' : 'Applied', created_by_user_id: user.id,
          note: companyMatch ? `Company duplicate within ${this.duplicates.companyCooldownDays()}-day cooldown.` : null,
          job_description: formatJobDescription(draft.job_description), generated_resume_json: draft.generated_resume_json,
          resume_template: draft.resume_template, resume_generated_at: draft.created_at,
          cover_letter_text: draft.cover_letter_text, cover_letter_template: draft.cover_letter_template,
          conversation_id: draft.conversation_id, application_questions_json: draft.application_questions_json,
          application_answers_json: draft.application_answers_json,
          application_form_json: draft.application_form_json,
        },
        select: { id: true, number: true, application_status: true, workspace_id: true, company_name: true, job_title: true },
      }), 1, db);
      const dates = screenshotDates();
      await db.applicationScreenshot.create({ data: {
        application_id: application.id, image_data: file!.buffer, content_type: 'image/png', ...dates,
      } });
      await db.applicationDraft.update({ where: { id: draft.id }, data: {
        submitted_application_id: application.id, submitted_at: dates.captured_at,
      } });
      notifyUsers.add(user.id);
      return { saved: true, already_added: false, application, ...dates };
    });
  }
}
