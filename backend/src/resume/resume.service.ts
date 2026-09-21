import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { DuplicateService } from '../applications/duplicate.service';
import { BANNED_URL_NOTE, isBannedUrl, normalizeUrl } from '../common/utils/url.util';
import { GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';
import { BASE_PROMPT_TEXT, buildApplicationAnswersPrompt, buildJobEligibilityPrompt } from './original-prompts';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';

type OpenAiResponse = { output_text?: string; output?: Array<{ type?: string; role?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };

@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly duplicates: DuplicateService,
  ) {}

  async generate(user: AuthUser, dto: GenerateApplicationDto) {
    await this.access.assertCanEdit(user, dto.workspace_id);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspace_id }, include: { resumeProfile: true } });
    if (!workspace) throw new BadRequestException('Workspace not found');

    const profile = dto.profile_id
      ? await this.findAccessibleProfile(user, dto.profile_id)
      : workspace.resumeProfile || await this.createWorkspaceProfile(workspace);
    if (!profile) throw new BadRequestException('Select a profile assigned to your account');
    if (workspace.resume_profile_id && profile.id !== workspace.resume_profile_id) {
      throw new BadRequestException('The selected profile is not assigned to this workspace');
    }

    const duplicate = (await this.duplicates.classifyBatch(workspace.id, [dto.url]))[0];
    if (duplicate.is_duplicate) {
      return {
        success: false,
        duplicate: true,
        url: dto.url,
        duplicate_type: duplicate.duplicate_type,
        existing_application: duplicate.existing,
      };
    }

    if (isBannedUrl(dto.url)) {
      const application = await this.prisma.jobApplication.create({
        data: {
          workspace_id: workspace.id,
          date: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
          number: await this.nextNumber(workspace.id),
          url: dto.url.trim(),
          normalized_url: normalizeUrl(dto.url),
          application_status: 'Rejected',
          note: BANNED_URL_NOTE,
          created_by_user_id: user.id,
        },
      });
      return { success: false, banned: true, url: dto.url, application };
    }

    const jobDescription = dto.job_description?.trim() || await this.fetchJobDescription(dto.url);
    const eligibility = await this.openAi(buildJobEligibilityPrompt(jobDescription));
    const eligibilityJson = this.parseJson(eligibility);
    const rejectionReasons: string[] = [];
    if (eligibilityJson.requires_clearance) rejectionReasons.push('requires security clearance');
    if (eligibilityJson.requires_public_trust) rejectionReasons.push('requires public trust');
    if (!eligibilityJson.is_us_job) rejectionReasons.push('is not clearly a US job');
    if (!eligibilityJson.work_arrangement_is_remote_only) rejectionReasons.push('is not explicitly fully remote');
    if (eligibilityJson.requires_in_person_interview) rejectionReasons.push('requires an in-person interview');
    if (eligibilityJson.requires_onsite_onboarding) rejectionReasons.push('requires onsite onboarding');
    if (rejectionReasons.length) return { success: false, eligible: false, url: dto.url, reason: `Skipped because it ${rejectionReasons.join(', ')}.`, eligibility: eligibilityJson };

    const resume = this.parseJson(await this.openAi(this.resumePrompt(profile, jobDescription)));
    let answers: unknown = null;
    if (dto.questions?.length) {
      answers = this.parseJson(await this.openAi(buildApplicationAnswersPrompt(jobDescription, resume, dto.questions)));
    }

    const application = await this.prisma.jobApplication.create({
      data: {
        workspace_id: workspace.id,
        date: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
        number: await this.nextNumber(workspace.id),
        url: dto.url.trim(),
        normalized_url: normalizeUrl(dto.url),
        job_title: typeof resume.target_job_title === 'string' ? resume.target_job_title : null,
        company_name: typeof resume.target_company === 'string' ? resume.target_company : null,
        application_status: 'Applied',
        created_by_user_id: user.id,
      },
    });
    return { success: true, eligible: true, application, resume, answers };
  }

  async generateProfilePrompt(user: AuthUser, dto: GenerateProfilePromptDto) {
    const profile = await this.findAccessibleProfile(user, dto.profile_id);
    if (!profile) throw new BadRequestException('Profile is not assigned to your account');
    if (dto.job_description && dto.kind === 'jobEligibility') {
      console.log('job eligibility prompt: ', buildJobEligibilityPrompt(dto.job_description));
      console.log('job generation prompt: ', this.resumePrompt(profile, dto.job_description));
    }
    if (dto.job_description && dto.kind === 'jobEligibility') {
      return { tailored_resume: await this.openAi(buildJobEligibilityPrompt(dto.job_description)), full_name: profile.full_name };
    }
    if (dto.job_description && dto.kind === 'resume') {
      return { tailored_resume: await this.openAi(this.resumePrompt(profile, dto.job_description)), full_name: profile.full_name };
    }
    if (dto.job_description && dto.kind === 'applicationAnswers' && dto.questions?.length) {
      return {
        tailored_resume: await this.openAi(
          buildApplicationAnswersPrompt(dto.job_description, dto.resume ?? {}, dto.questions),
        ),
        full_name: profile.full_name,
      };
    }
    throw new BadRequestException('A supported generation kind and its required data are needed');
  }

  private findAccessibleProfile(user: AuthUser, profileId: string) {
    return this.prisma.resumeProfile.findFirst({
      where: {
        id: profileId,
        OR: user.role === 'admin' || user.role === 'super_admin'
          ? [{ user_id: user.id }, { created_by_user_id: user.id }]
          : [{ user_id: user.id }],
      },
    });
  }

  private async nextNumber(workspaceId: string) {
    const date = new Date();
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);
    const latest = await this.prisma.jobApplication.findFirst({ where: { workspace_id: workspaceId, date: { gte: start, lt: end } }, orderBy: { number: 'desc' }, select: { number: true } });
    return (latest?.number ?? 0) + 1;
  }

  private async createWorkspaceProfile(workspace: { id: string; owner_user_id: string; name: string }) {
    const profile = await this.prisma.resumeProfile.create({
      data: { user_id: workspace.owner_user_id, name: `${workspace.name} Profile` },
    });
    await this.prisma.workspace.update({ where: { id: workspace.id }, data: { resume_profile_id: profile.id } });
    return profile;
  }

  private async fetchJobDescription(url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'BidTracker/1.0' } });
      if (!response.ok) throw new Error(`Job page returned ${response.status}`);
      const html = await response.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (text.length < 80) throw new Error('The job page did not contain readable text');
      return text.slice(0, 50000);
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? `Could not read job description: ${error.message}` : 'Could not read job description');
    }
  }

  private async openAi(prompt: string) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new BadGatewayException('The server is missing OPENAI_API_KEY');
    const response = await fetch(OPENAI_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, input: prompt }) });
    const data = await response.json().catch(() => null) as OpenAiResponse | null;
    if (!response.ok) throw new BadGatewayException(data?.error?.message || 'OpenAI request failed');
    const text = data?.output_text || data?.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('');
    if (!text?.trim()) throw new BadGatewayException('OpenAI returned an empty response');
    return text.trim();
  }

  private parseJson(value: string): any {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) throw new BadGatewayException('OpenAI returned invalid JSON');
    try { return JSON.parse(value.slice(start, end + 1)); } catch { throw new BadGatewayException('OpenAI returned invalid JSON'); }
  }

  private resumePrompt(profile: any, jd: string) {
    return BASE_PROMPT_TEXT
      .replace('Career Milestones:', `Career Milestones:\n${profile.career_path}`)
      .replace('JD:', `JD:\n${jd}`)
      .replace(
        'Candidate Current Location (city and/or state):',
        `Candidate Current Location (city and/or state):\n${profile.location}`,
      );
  }
}
