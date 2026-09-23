import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { DuplicateService } from '../applications/duplicate.service';
import { GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';
import { BASE_PROMPT_TEXT, buildApplicationAnswersPrompt, buildJobEligibilityPrompt } from './original-prompts';
import { BannedUrlService } from '../applications/banned-url.service';
import { ApplicationsService } from '../applications/applications.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';

type OpenAiResponse = { output_text?: string; output?: Array<{ type?: string; role?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };

@Injectable()
export class ApplicationGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly duplicates: DuplicateService,
    private readonly bannedUrls: BannedUrlService,
    private readonly applications: ApplicationsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async generate(user: AuthUser, dto: GenerateApplicationDto) {
    await this.access.assertCanEdit(user, dto.workspace_id);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspace_id }, include: { resumeProfile: true } });
    if (!workspace) throw new BadRequestException('Workspace not found');

    const profile = dto.profile_id
      ? await this.findAccessibleProfile(user, dto.profile_id)
      : workspace.resumeProfile || await this.workspaces.ensureProfile(workspace);
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

    if (await this.bannedUrls.matches(dto.url)) {
      const application = await this.applications.createBannedApplication(user, workspace.id, dto.url);
      return { success: false, banned: true, url: dto.url, application };
    }

    const jobDescription = dto.job_description.trim();
    const eligibility = await this.openAi(buildJobEligibilityPrompt(jobDescription));
    const eligibilityJson = this.parseEligibility(eligibility);
    const companyName = typeof eligibilityJson.company_name === 'string'
      ? eligibilityJson.company_name.trim()
      : '';
    const jobTitle = typeof eligibilityJson.job_title === 'string'
      ? eligibilityJson.job_title.trim()
      : '';
    if (!companyName || !jobTitle) {
      const missing = [
        !companyName ? 'company name' : null,
        !jobTitle ? 'job title' : null,
      ].filter(Boolean).join(' and ');
      return {
        success: false,
        eligible: false,
        url: dto.url,
        reason: `Need ${missing} in the JD.`,
        eligibility: eligibilityJson,
      };
    }

    const similar = await this.duplicates.findRecentJobMatch(
      workspace.id,
      companyName,
      jobTitle,
    );
    if (similar) {
      return {
        success: false,
        duplicate: true,
        duplicate_type: 'job_fingerprint',
        existing_application: similar,
      };
    }

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

    // Generation is intentionally read-only. The extension saves this candidate through
    // POST /applications/generated only after it has safely received and rendered the resume.
    const application = {
      url: dto.url.trim(),
      job_title: jobTitle,
      company_name: companyName,
    };
    return {
      success: true,
      eligible: true,
      application,
      resume,
      answers,
      full_name: profile.full_name,
    };
  }

  async generateProfilePrompt(user: AuthUser, dto: GenerateProfilePromptDto) {
    const profile = await this.findAccessibleProfile(user, dto.profile_id);
    if (!profile) throw new BadRequestException('Profile is not assigned to your account');
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

  private async openAi(prompt: string) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new BadGatewayException('The server is missing OPENAI_API_KEY');
    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          model: MODEL,
          input: prompt,
          reasoning: { effort: 'medium' },
          max_output_tokens: 16000,
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new BadGatewayException('The AI provider took too long to generate a response. Please try again.');
      }
      throw new BadGatewayException('Unable to reach the AI provider. Please try again.');
    }
    const data = await response.json().catch(() => null) as OpenAiResponse | null;
    if (!response.ok) throw new BadGatewayException(data?.error?.message || 'OpenAI request failed');
    const text = data?.output_text || data?.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('');
    if (!text?.trim()) throw new BadGatewayException('OpenAI returned an empty response');
    return text.trim();
  }

  private parseJson(value: string): Record<string, unknown> {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) throw new BadGatewayException('OpenAI returned invalid JSON');
    try {
      const parsed: unknown = JSON.parse(value.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('OpenAI returned invalid JSON');
    }
  }

  private parseEligibility(value: string): EligibilityResult {
    const parsed = this.parseJson(value);
    const booleanFields = [
      'requires_clearance',
      'requires_public_trust',
      'is_us_job',
      'work_arrangement_is_remote_only',
      'requires_in_person_interview',
      'requires_onsite_onboarding',
    ] as const;
    if (
      typeof parsed.company_name !== 'string' ||
      typeof parsed.job_title !== 'string' ||
      booleanFields.some((field) => typeof parsed[field] !== 'boolean')
    ) {
      throw new BadGatewayException('OpenAI returned an invalid eligibility response');
    }
    return parsed as unknown as EligibilityResult;
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

interface EligibilityResult extends Record<string, unknown> {
  company_name: string;
  job_title: string;
  requires_clearance: boolean;
  requires_public_trust: boolean;
  is_us_job: boolean;
  work_arrangement_is_remote_only: boolean;
  requires_in_person_interview: boolean;
  requires_onsite_onboarding: boolean;
  reason?: string;
}
