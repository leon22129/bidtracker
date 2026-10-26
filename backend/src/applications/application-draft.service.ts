import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ApplicationsService } from './applications.service';
import { DuplicateService } from './duplicate.service';
import { BannedUrlService } from './banned-url.service';
import { NumberingService } from './numbering.service';
import { detectJobSource, normalizeUrl } from '../common/utils/url.util';
import { createJobFingerprint } from '../common/utils/job-fingerprint.util';
import { toDayStart } from '../common/utils/date.util';
import { parseApplicationHistory } from '../common/utils/application-history.util';
import { assertScreenshotFile, screenshotDates } from './application-screenshot.service';
import { formatJobDescription } from '../common/utils/job-description.util';

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

  async prepare(user: AuthUser, data: Omit<Prisma.ApplicationDraftUncheckedCreateInput, 'created_by_user_id'>) {
    if (data.generated_resume_json.length > 250_000) throw new BadRequestException('Generated resume is too large to save');
    return this.applications.withWorkspaceWrite(data.workspace_id, async ({ db }) => {
      await this.access.assertCanEdit(user, data.workspace_id, { db });
      return db.applicationDraft.create({ data: { ...data, job_description: formatJobDescription(data.job_description), created_by_user_id: user.id } });
    });
  }

  async latest(user: AuthUser, workspaceId: string) {
    if (!workspaceId?.trim()) throw new BadRequestException('workspace_id is required');
    await this.access.assertCanView(user, workspaceId);
    const draft = await this.prisma.applicationDraft.findFirst({
      where: { workspace_id: workspaceId, created_by_user_id: user.id }, orderBy: { created_at: 'desc' },
    });
    if (!draft) throw new NotFoundException('No prepared job found');
    const history = parseApplicationHistory(draft.application_questions_json, draft.application_answers_json);
    return {
      id: draft.id, draft_id: draft.id, application_id: draft.submitted_application_id,
      submitted_at: draft.submitted_at, url: draft.url, company_name: draft.company_name, job_title: draft.job_title,
      source_job_description: draft.source_job_description, job_description: formatJobDescription(draft.job_description),
      resume: JSON.parse(draft.generated_resume_json), template: draft.resume_template, generated_at: draft.created_at,
      conversation_id: draft.conversation_id, cover_letter_text: draft.cover_letter_text,
      cover_letter_template: draft.cover_letter_template, questions: history?.questions ?? [], answers: history?.answers ?? [],
    };
  }

  /** The application, its screenshot, and the draft receipt are committed together. */
  async submit(user: AuthUser, draftId: string, file?: Express.Multer.File, submitted = false) {
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
      if (await this.banned.matchesJob(draft.url, draft.company_name, db)) {
        throw new ConflictException('This company or job URL is now banned. The application was not added.');
      }
      const [urlMatch] = await this.duplicates.classifyBatch(draft.workspace_id, [draft.url], undefined, db);
      if (urlMatch.is_duplicate) throw new ConflictException('This job URL is already in the application table.');
      const companyMatch = await this.duplicates.findRecentCompanyMatch(draft.workspace_id, draft.company_name, undefined, db);
      const date = toDayStart(new Date());
      const application = await this.numbering.withNextNumber(draft.workspace_id, date, (number) => db.jobApplication.create({
        data: {
          workspace_id: draft.workspace_id, date, number, url: draft.url, normalized_url: normalizeUrl(draft.url),
          company_name: draft.company_name, job_title: draft.job_title, job_source: detectJobSource(draft.url),
          job_fingerprint: createJobFingerprint(draft.company_name, draft.job_title),
          application_status: companyMatch ? 'Duplicated' : 'Applied', created_by_user_id: user.id,
          note: companyMatch ? `Company duplicate within ${this.duplicates.companyCooldownDays()}-day cooldown.` : null,
          job_description: formatJobDescription(draft.job_description), generated_resume_json: draft.generated_resume_json,
          resume_template: draft.resume_template, resume_generated_at: draft.created_at,
          cover_letter_text: draft.cover_letter_text, cover_letter_template: draft.cover_letter_template,
          conversation_id: draft.conversation_id, application_questions_json: draft.application_questions_json,
          application_answers_json: draft.application_answers_json,
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
