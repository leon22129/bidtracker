import { ForbiddenException } from '@nestjs/common';
import { ApplicationsService } from '../applications/applications.service';
import { ImportService } from '../import/import.service';
import { ApplicationGenerationService } from '../resume/resume.service';
import { WorkspaceAccessService } from './workspace-access.service';
import { WorkspacesService } from './workspaces.service';
import { ApplicationDraftService } from '../applications/application-draft.service';

describe('Archived profile write protection across services', () => {
  const user = {
    id: 'bidder-1', username: 'bidder', email: 'bidder@example.test', role: 'bidder' as const,
  };
  const input = {
    workspace_id: 'workspace-1', profile_id: 'profile-1',
    url: 'https://example.test/jobs/123', company_name: 'Acme', job_title: 'Engineer',
    job_description: 'Acme is hiring a remote US engineer.', note: 'Skipped job',
  };
  const eligibility = {
    company_name: 'Acme', job_title: 'Engineer', is_us_job: true,
    location: 'United States', workplace: 'Remote', department: 'Engineering',
    employment_type: 'Full-time', salary: '',
    work_arrangement_is_remote_only: true, requires_clearance: false, requires_public_trust: false,
    requires_in_person_interview: false, requires_onsite_onboarding: false,
  };

  function setup() {
    const profile = {
      id: input.profile_id, workspace_id: input.workspace_id, full_name: 'Candidate',
      career_path: '', template: 'classic', education_json: '[]', certifications_json: '[]',
    };
    const workspace = {
      id: input.workspace_id, name: 'Candidate', owner_user_id: user.id,
      created_by_user_id: 'admin-1', manager_user_id: 'manager-1', is_archived: true,
      owner: { manager_user_id: 'manager-1' }, resumeProfile: profile,
    };
    const row = {
      id: 'application-1', workspace_id: workspace.id, url: input.url,
      application_status: 'Pending', paid: false,
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      workspace: {
        findUnique: jest.fn(async ({ select }) => select
          ? Object.fromEntries(Object.entries(workspace).filter(([key]) => select[key]))
          : { ...workspace }),
        update: jest.fn(async ({ data }) => Object.assign(workspace, data)),
      },
      resumeProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      applicationDraft: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      resumeConversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'conversation-1', user_id: user.id, workspace_id: workspace.id,
          openai_conversation_id: 'provider-conversation',
        }),
      },
      jobApplication: {
        findUnique: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([row]),
        findFirst: jest.fn().mockResolvedValue({
          application_questions_json: '[{"question":"Authorized?","options":[]}]',
          application_answers_json: '[{"question":"Authorized?","answer":"Yes"}]',
        }),
        create: jest.fn(), update: jest.fn().mockResolvedValue(row), updateMany: jest.fn(),
      },
    };
    const access = new WorkspaceAccessService(prisma as never);
    const numbering = { withNextNumber: jest.fn(), reserveBlock: jest.fn() };
    const duplicates = {
      classifyBatch: jest.fn().mockResolvedValue([{ is_duplicate: false }]),
      findRecentCompanyMatch: jest.fn().mockResolvedValue(null),
    };
    const bannedUrls = { matches: jest.fn().mockResolvedValue(false), matchesJob: jest.fn().mockResolvedValue(false), matchMany: jest.fn() };
    const notifications = { notifyApplicationCreated: jest.fn() };
    const applications = new ApplicationsService(
      prisma as never, access, numbering as never, duplicates as never,
      bannedUrls as never, notifications as never,
    );
    const workspaces = new WorkspacesService(prisma as never, access, {} as never);
    const generation = new ApplicationGenerationService(
      prisma as never, access, duplicates as never, bannedUrls as never, applications, workspaces,
      new ApplicationDraftService(prisma as never, access, applications, duplicates as never, bannedUrls as never, numbering as never),
    );
    jest.spyOn(generation as any, 'extractJobIdentity').mockResolvedValue({ company_name: 'Acme', job_title: 'Engineer' });
    const imports = new ImportService(
      prisma as never, access, applications, duplicates as never, numbering as never, bannedUrls as never,
    );
    const openAi = jest.spyOn(generation as any, 'openAi');
    const conversation = jest.spyOn(generation as any, 'createAnswerConversation');
    return {
      workspace, prisma, numbering, applications, generation, imports, workspaces, openAi, conversation,
    };
  }

  const writes = {
    'manual application': ({ applications }: ReturnType<typeof setup>) =>
      applications.createManual(user, { ...input, application_status: 'Applied' }),
    'legacy generated application': ({ applications }: ReturnType<typeof setup>) =>
      applications.createGenerated(user, input),
    'banned application': ({ applications }: ReturnType<typeof setup>) =>
      applications.createBannedApplication(user, input.workspace_id, input.url),
    'rejected application': ({ applications }: ReturnType<typeof setup>) =>
      applications.createEligibilityRejectedApplication(user, input),
    'resume generation': ({ generation }: ReturnType<typeof setup>) => generation.generate(user, input),
    'profile prompt generation': ({ generation }: ReturnType<typeof setup>) =>
      generation.generateProfilePrompt(user, { ...input, kind: 'resume' }),
    'answer generation': ({ generation }: ReturnType<typeof setup>) =>
      generation.answerQuestions(user, {
        conversation_id: 'conversation-1', questions: [{ question: 'Authorized?', options: [] }],
      }),
    'spreadsheet import': ({ imports }: ReturnType<typeof setup>) => imports.import(user, input.workspace_id, {
      originalname: 'applications.csv', mimetype: 'text/csv',
      buffer: Buffer.from(`URL,Company Name,Job Title\n${input.url},Acme,Engineer`),
    }),
    'single status update': ({ applications }: ReturnType<typeof setup>) =>
      applications.update(user, 'application-1', { application_status: 'Applied' }),
    'bulk status update': ({ applications }: ReturnType<typeof setup>) =>
      applications.bulkUpdate(user, { ids: ['application-1'], patch: { application_status: 'Applied' } }),
  };

  it.each(Object.keys(writes) as Array<keyof typeof writes>)('blocks %s before side effects', async (path) => {
    const context = setup();

    await expect(writes[path](context)).rejects.toEqual(new ForbiddenException(
      'This profile is archived. Ask an admin to unarchive it before applying.',
    ));
    expect(context.openAi).not.toHaveBeenCalled();
    expect(context.conversation).not.toHaveBeenCalled();
    expect(context.prisma.jobApplication.create).not.toHaveBeenCalled();
    expect(context.prisma.jobApplication.update).not.toHaveBeenCalled();
    expect(context.prisma.jobApplication.updateMany).not.toHaveBeenCalled();
    expect(context.numbering.withNextNumber).not.toHaveBeenCalled();
    expect(context.numbering.reserveBlock).not.toHaveBeenCalled();
  });

  it('blocks saving a resume when the profile is archived during generation', async () => {
    const context = setup();
    context.workspace.is_archived = false;
    context.openAi.mockResolvedValueOnce(JSON.stringify(eligibility)).mockImplementationOnce(async () => {
      context.workspace.is_archived = true;
      return JSON.stringify({ summary: 'Tailored summary', annual_salary: '$150,000', hourly_rate: '$72.12' });
    });
    context.conversation.mockResolvedValue({ id: 'conversation-1' });

    await expect(context.generation.generate(user, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.openAi).toHaveBeenCalledTimes(2);
    expect(context.prisma.jobApplication.create).not.toHaveBeenCalled();
    expect(context.numbering.withNextNumber).not.toHaveBeenCalled();
  });

  it('lets admins unarchive profiles and then allows the assigned bidder to continue', async () => {
    const context = setup();
    const admin = { ...user, id: 'admin-1', role: 'admin' as const };

    await context.workspaces.update(input.workspace_id, { is_archived: false }, admin);
    expect(context.workspace.is_archived).toBe(false);
    context.openAi.mockResolvedValue(JSON.stringify({ ...eligibility, company_name: '', job_title: '' }));
    await expect(context.generation.generate(user, input)).resolves.toMatchObject({
      success: false, eligible: false, reason: 'Need company name and job title in the JD.',
    });
    expect(context.openAi).toHaveBeenCalledTimes(1);
  });

  it('lets admins maintain existing pipeline history on archived profiles', async () => {
    const context = setup();
    await context.applications.updatePipeline(
      { ...user, id: 'admin-1', role: 'admin' }, 'application-1', { interview_note: 'Follow up' },
    );
    expect(context.prisma.jobApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { interview_note: 'Follow up' },
    }));
  });

  it('still restores saved answers from archived profiles', async () => {
    const context = setup();
    await expect(context.generation.getConversationAnswers(user, 'conversation-1')).resolves.toEqual({
      questions: [{ question: 'Authorized?', options: [] }],
      answers: [{ question: 'Authorized?', answer: 'Yes' }],
    });
    expect(context.openAi).not.toHaveBeenCalled();
  });
});
