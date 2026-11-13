import { ApplicationGenerationService } from './resume.service';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';
import { DEFAULT_RESUME_PROMPT, RESUME_OUTPUT_INSTRUCTIONS } from '../ai/resume-prompt';

describe('ApplicationGenerationService application metadata eligibility', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    role: 'bidder' as const,
  };
  const dto = {
    workspace_id: 'workspace-1',
    profile_id: 'profile-1',
    url: 'https://careers.acme.com/jobs/123',
    job_description: 'Acme is hiring a Software Engineer for a fully remote US role.',
  };
  const profile = {
    id: 'profile-1',
    workspace_id: 'workspace-1',
    career_path: '',
    location: 'Chicago, IL',
    full_name: 'Candidate',
    us_work_status: 'US Citizen',
    requires_sponsorship: 'No',
    legally_authorized_us: 'Yes',
    gender: 'Male',
    hispanic_latino: 'No',
    ethnicity: 'White',
  };

  function setup() {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ ...user, is_active: true, can_continue_after_eligibility_failure: false }) },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
      workspace: { findUnique: jest.fn().mockResolvedValue({
        id: dto.workspace_id,
        owner_user_id: user.id,
        name: 'Workspace',
        resumeProfile: profile,
      }) },
      resumeProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      applicationDraft: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      resumeConversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      jobApplication: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const access = {
      assertCanEdit: jest.fn().mockResolvedValue(undefined),
      assertCanView: jest.fn().mockResolvedValue(undefined),
    };
    const duplicates = {
      classifyBatch: jest.fn().mockResolvedValue([{ is_duplicate: false }]),
      findRecentCompanyMatch: jest.fn().mockResolvedValue(null),
      companyCooldownDays: jest.fn().mockReturnValue(90),
    };
    const applications = {
      withWorkspaceWrite: jest.fn(async (_id, action) => action({ db: prisma, notifyUsers: new Set() })),
      recordCompanyDuplicate: jest.fn().mockResolvedValue(null),
      createBannedApplication: jest.fn().mockResolvedValue({
        id: 'banned-application-1',
        application_status: 'Banned',
        note: 'this job is in banned list',
      }),
      createEligibilityRejectedApplication: jest.fn().mockImplementation(async (_user, application) => ({
        id: 'rejected-application-1',
        application_status: 'Rejected',
        ...application,
      })),
      createGenerated: jest.fn().mockImplementation(async (_user, application) => ({
        success: true,
        already_added: false,
        application: {
          id: 'application-1',
          number: 1,
          ...application,
        },
      })),
    };
    const bannedUrls = { matches: jest.fn().mockResolvedValue(false), matchesJob: jest.fn().mockResolvedValue(false) };
    const drafts = { prepare: jest.fn(async (_user, data) => ({ id: 'draft-1', ...data })) };
    const aiSettings = { forWorkspace: jest.fn(async () => ({
      provider: 'openai', model: 'gpt-6.1-sol', apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1', resumePrompt: DEFAULT_RESUME_PROMPT,
    })) };
    const service = new ApplicationGenerationService(
      prisma as any,
      access as any,
      duplicates as any,
      bannedUrls as any,
      applications as any,
      {} as any,
      drafts as any,
      aiSettings as any,
    );
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    jest.spyOn(service as any, 'extractJobIdentity').mockResolvedValue({ company_name: 'Acme', job_title: 'Software Engineer' });
    jest.spyOn(service as any, 'createGenerationConversation').mockResolvedValue({
      id: 'conversation-1',
      openai_conversation_id: 'conv_openai_1',
    });
    return { service, duplicates, prisma, access, applications, bannedUrls, drafts, aiSettings };
  }

  const eligible = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    company_name: 'Acme',
    job_title: 'Software Engineer',
    location: 'United States',
    workplace: 'Remote',
    department: 'Engineering',
    employment_type: 'Full-time',
    salary: '$140,000-$180,000 per year',
    requires_clearance: false,
    requires_public_trust: false,
    is_us_job: true,
    work_arrangement_is_remote_only: true,
    requires_in_person_interview: false,
    requires_onsite_onboarding: false,
    reason: '',
    ...overrides,
  });

  it.each(['bidder', 'bidder_manager'] as const)('offers Continue only when the %s account is enabled', async (role) => {
    const { service, prisma, drafts } = setup();
    const actor = { ...user, role };
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({ requires_clearance: true }));
    await expect(service.generate(actor, dto)).resolves.toMatchObject({ eligible: false, can_continue: false });
    prisma.user.findUnique.mockResolvedValue({ ...actor, is_active: true, can_continue_after_eligibility_failure: true });
    await expect(service.generate(actor, dto)).resolves.toMatchObject({ eligible: false, can_continue: true });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ['bidder', 'linked'], ['bidder_manager', 'linked'], ['bidder', 'manual'], ['bidder_manager', 'manual'],
  ] as const)('lets an enabled %s explicitly continue a %s eligibility rejection', async (role, mode) => {
    const { service, prisma, drafts } = setup();
    const actor = { ...user, role };
    prisma.user.findUnique.mockResolvedValue({ ...actor, is_active: true, can_continue_after_eligibility_failure: true });
    jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible({ requires_clearance: true, requires_public_trust: true, is_us_job: false,
        work_arrangement_is_remote_only: false, requires_in_person_interview: true, requires_onsite_onboarding: true }))
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Continued resume', annual_salary: '$150,000', hourly_rate: '$72.12' }));
    await expect(service.generate(actor, { ...dto, mode, url: mode === 'manual' ? undefined : dto.url,
      continue_after_eligibility_failure: true })).resolves.toMatchObject({ success: true, draft: { id: 'draft-1' } });
    expect(drafts.prepare).toHaveBeenCalledTimes(1);
  });

  it('denies Continue when permission is revoked after the eligibility failure', async () => {
    const { service, prisma, drafts } = setup();
    prisma.user.findUnique.mockResolvedValueOnce({ ...user, is_active: true, can_continue_after_eligibility_failure: true });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({ is_us_job: false }));
    await expect(service.generate(user, dto)).resolves.toMatchObject({ can_continue: true });
    await expect(service.generate(user, { ...dto, continue_after_eligibility_failure: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'inactive', 'missing', 'admin'])("denies a forged Continue request for a %s account before calling AI", async (state) => {
    const { service, prisma, drafts } = setup();
    prisma.user.findUnique.mockResolvedValue(state === 'missing' ? null : {
      ...user, role: state === 'admin' ? 'admin' : 'bidder', is_active: state !== 'inactive',
      can_continue_after_eligibility_failure: state !== 'disabled',
    });
    const generateText = jest.spyOn(service as any, 'generateText');
    await expect(service.generate(user, { ...dto, continue_after_eligibility_failure: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(generateText).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it.each(['url ban', 'company ban', 'url duplicate', 'company cooldown', 'career history', 'missing identity', 'missing eligibility identity'])(
    'keeps %s enforced when Continue is enabled', async (block) => {
      const { service, prisma, duplicates, bannedUrls, drafts } = setup();
      prisma.user.findUnique.mockResolvedValue({ ...user, is_active: true, can_continue_after_eligibility_failure: true });
      const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({ company_name: '' }));
      if (block === 'url ban') bannedUrls.matches.mockResolvedValue(true);
      if (block === 'company ban') bannedUrls.matchesJob.mockResolvedValue(true);
      if (block === 'url duplicate') duplicates.classifyBatch.mockResolvedValue([{ is_duplicate: true }]);
      if (block === 'company cooldown') duplicates.findRecentCompanyMatch.mockResolvedValue({ id: 'existing' });
      if (block === 'career history') prisma.workspace.findUnique.mockResolvedValue({ id: dto.workspace_id,
        resumeProfile: { ...profile, career_path: 'Company: Acme\nRole: Engineer' } });
      if (block === 'missing identity') (service as any).extractJobIdentity.mockResolvedValue({ company_name: '', job_title: '' });
      const result = await service.generate(user, { ...dto, continue_after_eligibility_failure: true });
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('can_continue', true);
      expect(drafts.prepare).not.toHaveBeenCalled();
      expect(generateText).toHaveBeenCalledTimes(block === 'missing eligibility identity' ? 1 : 0);
    },
  );

  it('forwards Continue through the profile generation endpoint', async () => {
    const { service } = setup();
    jest.spyOn(service as any, 'findAccessibleProfile').mockResolvedValue(profile);
    const generate = jest.spyOn(service, 'generate').mockResolvedValue({ success: true } as any);
    await service.generateProfilePrompt(user, { profile_id: profile.id, url: dto.url,
      job_description: dto.job_description, kind: 'resume', continue_after_eligibility_failure: true });
    expect(generate).toHaveBeenCalledWith(user, expect.objectContaining({ continue_after_eligibility_failure: true }));
  });

  it.each([null, 'true', 1])('rejects a non-boolean Continue value: %s', (value) => {
    for (const Type of [GenerateApplicationDto, GenerateProfilePromptDto]) {
      const errors = validateSync(plainToInstance(Type as typeof GenerateApplicationDto, {
        ...dto, continue_after_eligibility_failure: value,
      }));
      expect(errors.some((error) => error.property === 'continue_after_eligibility_failure')).toBe(true);
    }
  });

  it('creates a local session before eligibility without a provider conversation request', async () => {
    const { service, prisma, applications, drafts } = setup();
    (service as any).createGenerationConversation.mockRestore();
    prisma.resumeConversation.create.mockImplementation(async ({ data }) => ({ id: 'conversation-local', ...data }));
    const generateText = jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Generated resume', annual_salary: '$150,000', hourly_rate: '$72.12' }));
    const request = jest.spyOn(service as any, 'requestProvider');
    await expect(service.generate(user, dto)).resolves.toMatchObject({ success: true, conversation_id: 'conversation-local' });
    expect(prisma.resumeConversation.create.mock.calls[0][0].data.openai_conversation_id).toMatch(/^local_/);
    expect(prisma.resumeConversation.create.mock.invocationCallOrder[0]).toBeLessThan(generateText.mock.invocationCallOrder[0]);
    for (const [, options] of generateText.mock.calls) expect(options).not.toHaveProperty('conversationId');
    expect(request).not.toHaveBeenCalled();
    expect(applications.createGenerated).not.toHaveBeenCalled();
    expect(drafts.prepare).toHaveBeenCalledWith(user, expect.objectContaining({ conversation_id: 'conversation-local' }));
  });

  it('generates a manual resume and answer context without a URL or application row', async () => {
    const { service, drafts, prisma, duplicates, bannedUrls, applications, access } = setup();
    const generateText = jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Manual resume', annual_salary: '$150,000', hourly_rate: '$72.12' }));
    await expect(service.generate(user, { ...dto, mode: 'manual', url: undefined })).resolves.toMatchObject({
      success: true, draft: { url: '', company_name: 'Acme' }, conversation_id: 'conversation-1',
    });
    expect(access.assertCanEdit).toHaveBeenCalledWith(user, dto.workspace_id);
    expect(duplicates.classifyBatch).not.toHaveBeenCalled();
    expect(bannedUrls.matches).not.toHaveBeenCalled();
    expect(bannedUrls.matchesJob).toHaveBeenCalledWith('', 'Acme');
    expect(duplicates.findRecentCompanyMatch).toHaveBeenCalledWith(dto.workspace_id, 'Acme');
    expect(generateText.mock.calls[0][0]).toContain('Not provided (manual application)');
    expect(drafts.prepare).toHaveBeenCalledWith(user, expect.objectContaining({ url: '', normalized_url: '', conversation_id: 'conversation-1' }));
    expect(prisma.resumeConversation.update.mock.calls[0][0].data.reference_context).toContain('Manual resume');
    expect(applications.createGenerated).not.toHaveBeenCalled();
  });

  it('still blocks a banned company in manual mode before generating', async () => {
    const { service, bannedUrls, drafts } = setup();
    bannedUrls.matchesJob.mockResolvedValue(true);
    const generateText = jest.spyOn(service as any, 'generateText');
    await expect(service.generate(user, { ...dto, mode: 'manual', url: undefined })).resolves.toMatchObject({ banned: true });
    expect(generateText).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('does not treat a missing linked URL as manual mode', async () => {
    const { service, drafts } = setup();
    await expect(service.generate(user, { ...dto, url: undefined })).rejects.toThrow('Job URL is required');
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('uses the owning admin\'s custom prompt and preserves the resume output contract', async () => {
    const { service, aiSettings } = setup();
    const config = await aiSettings.forWorkspace();
    aiSettings.forWorkspace.mockResolvedValue({ ...config, resumePrompt:
      'Write concise accomplishments.\n{{job_description}}\n{{career_milestones}}\n{{candidate_location}}\n{{candidate_info}}' });
    const generateText = jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Custom resume', annual_salary: '$150,000', hourly_rate: '$72.12' }));
    await expect(service.generate(user, dto)).resolves.toMatchObject({ success: true });
    expect(aiSettings.forWorkspace).toHaveBeenLastCalledWith(dto.workspace_id);
    expect(generateText).toHaveBeenLastCalledWith(expect.stringContaining('Write concise accomplishments.'),
      expect.objectContaining({ operation: 'resume_generation', instructions: RESUME_OUTPUT_INSTRUCTIONS }));
    const prompt = generateText.mock.calls[1][0] as string;
    expect(prompt).toContain(dto.job_description);
    expect(prompt).toContain('Chicago, IL');
    expect(prompt).toContain('US work status: US Citizen');
    expect(prompt).not.toContain('{{candidate_info}}');
  });

  it.each(['openai', 'deepseek'])('uses a local session and bounded context for the complete %s workflow', async (providerName) => {
    const { service, prisma, drafts, aiSettings } = setup();
    (service as any).createGenerationConversation.mockRestore();
    const config = await aiSettings.forWorkspace();
    const baseUrl = providerName === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com';
    aiSettings.forWorkspace.mockResolvedValue({ ...config, provider: providerName,
      model: providerName === 'openai' ? 'gpt-6.1-sol' : 'deepseek-flash', baseUrl } as any);
    prisma.resumeConversation.create.mockImplementation(async ({ data }) => ({ id: 'conversation-1', ...data }));
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const provider = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ output_text: eligible() }))
      .mockResolvedValueOnce(json({ output_text: JSON.stringify({ summary: 'Tailored summary', annual_salary: '$150,000', hourly_rate: '$72.12' }) }))
      .mockResolvedValueOnce(json({ output_text: JSON.stringify({ answers: [{ question: 'Why this role?', answer: 'It fits my experience.' }] }) }));
    try {
      await expect(service.generate(user, dto)).resolves.toMatchObject({ success: true, conversation_id: 'conversation-1' });
      const saved = { id: 'conversation-1', ...prisma.resumeConversation.create.mock.calls[0][0].data,
        reference_context: prisma.resumeConversation.update.mock.calls[0][0].data.reference_context };
      prisma.resumeConversation.findUnique.mockResolvedValue(saved);
      await expect(service.answerQuestions(user, {
        conversation_id: 'conversation-1', questions: [{ question: 'Name' }, { question: 'Why this role?' }],
      })).resolves.toEqual({ answers: [{ question: 'Name', answer: 'Candidate' }, { question: 'Why this role?', answer: 'It fits my experience.' }] });
      expect(provider.mock.calls.map(([url]) => url)).toEqual(Array(3).fill(baseUrl + '/responses'));
      const [eligibility, resume, answers] = provider.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
      for (const body of [eligibility, resume, answers]) {
        expect(body).not.toHaveProperty('conversation');
        expect(body).not.toHaveProperty('previous_response_id');
        if (providerName === 'openai') expect(body.store).toBe(false);
        else expect(body).not.toHaveProperty('store');
      }
      expect(eligibility.input).toContain(dto.job_description);
      expect(eligibility.reasoning.effort).toBe('low');
      expect(resume.input).not.toContain('requires_clearance');
      expect(resume.instructions).toBe(RESUME_OUTPUT_INSTRUCTIONS);
      expect(answers.input[0].content).toBe(saved.reference_context);
      expect(answers.input[0].content).toContain('Tailored summary');
      expect(answers.input[0].content).toContain('Job description:');
      expect(answers.input[1].content).toContain('Why this role?');
      expect(answers.input[1].content).not.toContain('1. Name');
      expect(answers.reasoning.effort).toBe('low');
      expect(drafts.prepare).toHaveBeenCalledWith(user, expect.objectContaining({ conversation_id: 'conversation-1' }));
    } finally { provider.mockRestore(); }
  });

  it('keeps local reference context for DeepSeek without creating an OpenAI conversation', async () => {
    const { service, prisma, aiSettings } = setup();
    (service as any).createGenerationConversation.mockRestore();
    const config = await aiSettings.forWorkspace();
    aiSettings.forWorkspace.mockResolvedValue({ ...config, provider: 'deepseek', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' });
    prisma.resumeConversation.create.mockImplementation(async ({ data }) => ({ id: 'local-conversation', ...data }));
    const request = jest.spyOn(service as any, 'requestProvider');
    const generateText = jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Tailored summary', annual_salary: '$150,000', hourly_rate: '$72.12' }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({ success: true, conversation_id: 'local-conversation' });
    expect(request).not.toHaveBeenCalled();
    expect(prisma.resumeConversation.create.mock.calls[0][0].data.openai_conversation_id).toMatch(/^local_/);
    for (const [, options] of generateText.mock.calls) expect(options).not.toHaveProperty('conversationId');
    const context = prisma.resumeConversation.update.mock.calls[0][0].data.reference_context;
    expect(context).toContain(dto.url);
    expect(context).toContain('"fullName":"Candidate"');
    expect(context).toContain('Tailored summary');
  });

  it('keeps rejected conversations tracked for cleanup without generating a resume or prepared job', async () => {
    const { service, prisma, drafts } = setup();
    (service as any).createGenerationConversation.mockRestore();
    prisma.resumeConversation.create.mockImplementation(async ({ data }) => ({ id: 'rejected-conversation', ...data }));
    jest.spyOn(service as any, 'requestProvider').mockResolvedValue({ id: 'conv_rejected' });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({ requires_clearance: true }));
    await expect(service.generate(user, dto)).resolves.toMatchObject({ success: false, eligible: false });
    expect(prisma.resumeConversation.create.mock.calls[0][0].data.openai_conversation_id).toMatch(/^local_/);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][1]).not.toHaveProperty('conversationId');
    expect(prisma.resumeConversation.update).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('keeps the local session when resume generation fails and does not prepare a job', async () => {
    const { service, prisma, drafts } = setup();
    (service as any).createGenerationConversation.mockRestore();
    prisma.resumeConversation.create.mockImplementation(async ({ data }) => ({ id: 'failed-conversation', ...data }));
    const request = jest.spyOn(service as any, 'requestProvider').mockResolvedValue({ id: 'conv_failed' });
    jest.spyOn(service as any, 'generateText').mockResolvedValueOnce(eligible()).mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(service.generate(user, dto)).rejects.toThrow('Provider unavailable');
    expect(prisma.resumeConversation.create.mock.calls[0][0].data.openai_conversation_id).toMatch(/^local_/);
    expect(request).not.toHaveBeenCalled();
    expect(prisma.resumeConversation.update).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('does not send provider requests when the local session cannot be saved', async () => {
    const { service, prisma, drafts } = setup();
    (service as any).createGenerationConversation.mockRestore();
    prisma.resumeConversation.create.mockRejectedValue(new Error('Database unavailable'));
    const request = jest.spyOn(service as any, 'requestProvider');
    const generateText = jest.spyOn(service as any, 'generateText');
    await expect(service.generate(user, dto)).rejects.toThrow('Database unavailable');
    expect(request).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('blocks a banned URL before duplicate or eligibility checks without adding a row', async () => {
    const { service, applications, bannedUrls, duplicates } = setup();
    bannedUrls.matches.mockResolvedValue(true);
    const generateText = jest.spyOn(service as any, 'generateText');

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      banned: true,
    });

    expect(applications.createBannedApplication).not.toHaveBeenCalled();
    expect(duplicates.classifyBatch).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it.each([
    ['company_name', 'company name'],
    ['job_title', 'job title'],
  ])('stops after eligibility when the JD has no %s', async (field, label) => {
    const { service, duplicates } = setup();
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(
      eligible({ [field]: '' }),
    );

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      reason: `Need ${label} in the JD.`,
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(duplicates.findRecentCompanyMatch).toHaveBeenCalledWith(dto.workspace_id, 'Acme');
  });

  it('normalizes job information within the single eligibility call for a skipped non-US job', async () => {
    const { service, applications } = setup();
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({
      company_name: 'Trinnex',
      job_title: 'Senior Full Stack Developer',
      location: 'Canada (British Columbia, Alberta, Manitoba, or Ontario)',
      workplace: 'Remote or Hybrid',
      department: 'Digital Solutions',
      salary: '$120,411-$210,704 per year',
      is_us_job: false,
      work_arrangement_is_remote_only: false,
    }));

    await expect(service.generate(user, {
      ...dto,
      url: 'https://careers-trinnex.icims.com/jobs/4706/senior-full-stack-developer/job',
      job_description: 'Location: UNAVAILABLE, US\nCandidates must reside and work in specified Canadian provinces.',
    })).resolves.toMatchObject({
      success: false,
      eligible: false,
      job_description: expect.stringContaining('Location: Canada (British Columbia, Alberta, Manitoba, or Ontario)'),
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).not.toHaveBeenCalled();
  });

  it('records a clearance rejection with the requested note', async () => {
    const { service, applications } = setup();
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({
      requires_clearance: true,
    }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      reason: expect.stringContaining('it requires clearance'),
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).not.toHaveBeenCalled();
  });

  it.each([
    [
      'onsite work',
      { workplace: 'On-site', work_arrangement_is_remote_only: false },
      'job eligibility check failed - it is onsite',
    ],
    [
      'hybrid work',
      { workplace: 'Hybrid', work_arrangement_is_remote_only: false },
      'job eligibility check failed - it is hybrid',
    ],
    [
      'onsite onboarding',
      { requires_onsite_onboarding: true },
      'job eligibility check failed - it requires onsite onboarding',
    ],
    [
      'an in-person interview',
      { requires_in_person_interview: true },
      'job eligibility check failed - it requires an in-person interview',
    ],
  ])('rejects %s without adding an application', async (_label, overrides, note) => {
    const { service, applications } = setup();
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible(overrides));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      reason: expect.stringContaining(note.replace('job eligibility check failed - ', '')),
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).not.toHaveBeenCalled();
  });

  it('checks the company cooldown before generating the resume', async () => {
    const { service, duplicates, applications } = setup();
    const existing = { id: 'application-1', company_name: 'Acme', job_title: 'Software Engineer' };
    duplicates.findRecentCompanyMatch.mockResolvedValue(existing);
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible());

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'company',
      cooldown_days: 90,
      existing_application: existing,
    });
    expect(applications.recordCompanyDuplicate).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(applications.createGenerated).not.toHaveBeenCalled();
    expect(applications.createEligibilityRejectedApplication).not.toHaveBeenCalled();
  });

  it('blocks resume generation when the target company is a previous employer', async () => {
    const { service, duplicates, applications } = setup();
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(eligible({
      company_name: 'Visa, Inc.',
    }));
    (service as any).extractJobIdentity.mockResolvedValue({ company_name: 'Visa, Inc.', job_title: 'Engineer' });
    (service as any).prisma.workspace.findUnique.mockResolvedValue({
      id: dto.workspace_id,
      owner_user_id: user.id,
      name: 'Workspace',
      resumeProfile: {
        ...profile,
        career_path: '## Visa\nSenior Software Engineer\n01/2020 - 02/2023',
      },
    });

    await expect(service.generate(user, dto)).resolves.toEqual({
      success: false,
      duplicate: true,
      duplicate_type: 'career_history',
      company_name: 'Visa, Inc.',
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(duplicates.findRecentCompanyMatch).not.toHaveBeenCalled();
    expect(applications.createGenerated).not.toHaveBeenCalled();
  });

  it('saves a separate prepared job with its source JD and expected rate', async () => {
    const { service, applications, drafts } = setup();
    const generateText = jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({
        target_company: 'Different AI spelling',
        target_job_title: 'Different AI title',
        summary: 'Tailored summary',
        annual_salary: '$160,000', hourly_rate: '$76.92', rate_in_jd: true,
        skills: ['TypeScript', 'PostgreSQL'],
      }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: true,
      conversation_id: 'conversation-1',
      draft: {
        company_name: 'Acme',
        job_title: 'Software Engineer',
      },
    });
    expect(drafts.prepare).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        workspace_id: dto.workspace_id,
        url: dto.url,
        company_name: 'Acme',
        job_title: 'Software Engineer',
        job_description: expect.stringContaining('Location: United States'),
        conversation_id: 'conversation-1',
        generated_resume_json: expect.any(String), source_job_description: dto.job_description,
      }),
    );
    expect(JSON.parse(drafts.prepare.mock.calls[0][1].generated_resume_json)).toMatchObject({
      summary: 'Tailored summary', skills: [{ category: 'Technical Skills', items: ['TypeScript', 'PostgreSQL'] }],
    });
    expect(drafts.prepare.mock.calls[0][1].job_description).toContain('Expected Rate (from job description)\nAnnual: $160,000');
    expect(applications.createGenerated).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[0][0]).toContain('"salary": ""');
    expect(generateText.mock.calls[1][0]).toContain('Job Information\nTitle: Software Engineer');
    expect(generateText.mock.calls[1][0]).toContain('Salary: $140,000-$180,000 per year');
  });

  it('removes an AI signer before saving and returning a generated cover letter', async () => {
    const { service, drafts, prisma } = setup();
    prisma.workspace.findUnique.mockResolvedValue({
      id: dto.workspace_id,
      owner_user_id: user.id,
      name: 'Workspace',
      resumeProfile: {
        ...profile,
        full_name: 'Jane Candidate',
        generate_cover_letter: true,
      },
    });
    jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({
        summary: 'Tailored summary',
        coverletter: 'Thank you for your consideration.\n\nSincerely,\nCandidate',
        annual_salary: '$150,000', hourly_rate: '$72.12',
      }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: true,
      resume: {
        coverletter: 'Thank you for your consideration.\n\nSincerely,',
      },
    });
    expect(drafts.prepare).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        cover_letter_text: 'Thank you for your consideration.\n\nSincerely,',
      }),
    );
  });

  it('answers from an owned compact conversation without resending the JD or resume', async () => {
    const { service, prisma, access } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [{ question: 'Why this role?', options: [] }],
    })).resolves.toEqual({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    });

    expect(access.assertCanEdit).toHaveBeenCalledWith(user, dto.workspace_id);
    expect(generateText).toHaveBeenCalledWith(
      expect.stringContaining('Why this role?'),
      expect.objectContaining({ conversationId: 'conv_openai_1' }),
    );
    expect(generateText.mock.calls[0][0]).not.toContain(dto.job_description);
    expect(prisma.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { conversation_id: 'conversation-1' },
      data: {
        application_questions_json: JSON.stringify([{ question: 'Why this role?', options: [] }]),
        application_answers_json: JSON.stringify([{
          question: 'Why this role?',
          answer: 'It aligns with my experience.',
        }]),
      },
    });
    expect(prisma.applicationDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversation_id: 'conversation-1' },
      data: expect.objectContaining({ application_answers_json: expect.stringContaining('It aligns with my experience.') }),
    }));
  });

  it('uses the current workspace AI settings and saved reference context for local conversations', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'local-conversation', user_id: user.id, workspace_id: dto.workspace_id,
      openai_conversation_id: 'local_uuid', reference_context: 'Saved resume and JD', profile_id: profile.id,
    });
    const config = { provider: 'deepseek', model: 'deepseek-v4-pro', apiKey: 'test-key', baseUrl: 'https://api.deepseek.com' };
    (service as any).aiSettings.forWorkspace.mockResolvedValue(config);
    const generate = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'A good fit.' }],
    }));
    await service.answerQuestions(user, { conversation_id: 'local-conversation', questions: [{ question: 'Why this role?', options: [] }] });
    const options = generate.mock.calls[0][1] as any;
    expect(options).toMatchObject({ config, referenceContext: 'Saved resume and JD' });
    expect(options).not.toHaveProperty('conversationId');
    expect((service as any).aiSettings.forWorkspace).toHaveBeenCalledWith(dto.workspace_id);
  });

  it('checks a scanned company ban before eligibility and leaves the application table untouched', async () => {
    const { service, bannedUrls, drafts, applications } = setup();
    (service as any).extractJobIdentity.mockRestore();
    bannedUrls.matchesJob.mockResolvedValue(true);
    const generateText = jest.spyOn(service as any, 'generateText');
    await expect(service.generate(user, { ...dto, job_description: 'Job Information\nCompany: Omada Health\nTitle: Engineer\n\nJob Description\nRemote US job.' }))
      .resolves.toMatchObject({ banned: true, company_name: 'Omada Health' });
    expect(generateText).not.toHaveBeenCalled();
    expect(drafts.prepare).not.toHaveBeenCalled();
    expect(applications.createGenerated).not.toHaveBeenCalled();
  });

  it('extracts metadata for a pasted JD and checks duplication before evaluating eligibility', async () => {
    const { service, duplicates, drafts } = setup();
    (service as any).extractJobIdentity.mockRestore();
    duplicates.findRecentCompanyMatch.mockResolvedValue({ id: 'original', company_name: 'Acme' });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({ company_name: 'Acme', job_title: 'Engineer' }));
    await expect(service.generate(user, dto)).resolves.toMatchObject({ duplicate: true, duplicate_type: 'company' });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ operation: 'job_identity' }));
    expect(drafts.prepare).not.toHaveBeenCalled();
  });

  it('restores answers from a prepared draft without reading provider history', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({ id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id });
    prisma.applicationDraft.findFirst.mockResolvedValue({
      application_questions_json: '[{"question":"Why?","options":[]}]',
      application_answers_json: '[{"question":"Why?","answer":"A good fit."}]',
    });
    const provider = jest.spyOn(service as any, 'requestProvider');
    await expect(service.getConversationAnswers(user, 'conversation-1')).resolves.toMatchObject({ answers: [{ answer: 'A good fit.' }] });
    expect(provider).not.toHaveBeenCalled();
  });

  it('restores saved application answers without calling the provider', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    prisma.jobApplication.findFirst.mockResolvedValue({
      application_questions_json: JSON.stringify([{
        question: 'Are you authorized?',
        options: ['Yes', 'No'],
      }]),
      application_answers_json: JSON.stringify([{
        question: 'Are you authorized?',
        answer: 'Yes',
      }]),
    });
    const provider = jest.spyOn(service as any, 'requestProvider');

    await expect(service.getConversationAnswers(user, 'conversation-1')).resolves.toEqual({
      questions: [{ question: 'Are you authorized?', options: ['Yes', 'No'] }],
      answers: [{ question: 'Are you authorized?', answer: 'Yes' }],
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('restores the latest application questions and answers from conversation items', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    jest.spyOn(service as any, 'requestProvider').mockResolvedValue({
      data: [
        {
          role: 'assistant',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              answers: [{ question: 'Are you authorized?', answer: 'Yes' }],
            }),
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Application questions:\n1. Are you authorized?\n   Allowed answers: ["Yes","No"]\n\nReturn valid JSON only in this exact shape:',
          }],
        },
      ],
    });

    await expect(service.getConversationAnswers(user, 'conversation-1')).resolves.toEqual({
      questions: [{ question: 'Are you authorized?', options: ['Yes', 'No'] }],
      answers: [{ question: 'Are you authorized?', answer: 'Yes' }],
    });
    expect(prisma.jobApplication.updateMany).toHaveBeenCalled();
  });

  it('saves the complete resume and candidate profile as reference data', async () => {
    const { service, prisma } = setup();
    jest.spyOn(service as any, 'generateText')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Tailored summary', annual_salary: '$150,000', hourly_rate: '$72.12' }));
    await service.generate(user, dto);
    const context = prisma.resumeConversation.update.mock.calls[0][0].data.reference_context as string;
    expect(context).toContain(dto.url);
    expect(context).toContain('"personalInfo":{"fullName":"Candidate"');
    expect(context).toContain('Tailored summary');
    expect(context).not.toContain('Candidate info:');
  });

  it('replaces resume prompt placeholders with real candidate information', () => {
    const { service } = setup();
    const prompt = (service as any).resumePrompt(profile, dto.job_description) as string;

    expect(prompt).toContain(`JD:\n${dto.job_description}`);
    expect(prompt).toContain(`Candidate Current Location (city and/or state):\n${profile.location}`);
    expect(prompt).toContain('Candidate info:\nFull name: Candidate');
    expect(prompt).toContain('US work status: US Citizen');
    expect(prompt).toContain('Require employment sponsorship now or later: No');
    expect(prompt).toContain('Legally authorized to work in the US: Yes');
    expect(prompt).toContain('Gender: Male');
    expect(prompt).toContain('Hispanic/Latino: No');
    expect(prompt).toContain('Race: White');
  });

  it('constrains select answers to an option supplied by the application page', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Do you have Kubernetes experience?', answer: 'yes' }],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [{ question: 'Do you have Kubernetes experience?', options: ['Yes', 'No'] }],
    })).resolves.toEqual({
      answers: [{ question: 'Do you have Kubernetes experience?', answer: 'Yes' }],
    });
    expect(generateText.mock.calls[0][0]).toContain('Allowed answers: ["Yes","No"]');
  });

  it('uses saved profile values for sponsorship and work authorization answers', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      profile_id: profile.id,
      openai_conversation_id: 'conv_openai_1',
    });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [
        { question: 'Will you now or or in the future require employment sponsorship?', answer: 'Yes' },
        { question: 'Are you legally authorized to work for any employer in the country where the position is located?', answer: 'No' },
        { question: 'Do you have the right to work in the country for which you are applying?', answer: 'No' },
      ],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [
        {
          question: 'Will you now or or in the future require employment sponsorship?',
          options: ['Yes', 'No'],
        },
        {
          question: 'Are you legally authorized to work for any employer in the country where the position is located?',
          options: ['Yes', 'No'],
        },
        {
          question: 'Do you have the right to work in the country for which you are applying?',
          options: ['Yes', 'No'],
        },
      ],
    })).resolves.toEqual({
      answers: [
        { question: 'Will you now or or in the future require employment sponsorship?', answer: 'No' },
        { question: 'Are you legally authorized to work for any employer in the country where the position is located?', answer: 'Yes' },
        { question: 'Do you have the right to work in the country for which you are applying?', answer: 'Yes' },
      ],
    });
    expect(prisma.resumeProfile.findUnique).toHaveBeenCalledWith({ where: { id: profile.id } });
  });

  it.each([
    ['local_old', 'Saved resume and JD without personal details'],
    ['conv_legacy', null],
    ['conv_new', 'Saved complete reference context'],
  ])('answers personal fields from the current profile for %s', async (providerId, referenceContext) => {
    const { service, prisma, aiSettings } = setup();
    const candidate = {
      ...profile, full_name: 'Jane May de la Cruz', first_name: 'Jane', middle_name: 'May', last_name: 'de la Cruz',
      email: 'jane@example.com', phone: '+1 555 0100', address1: '123 Example St', city: 'Chicago', state: 'IL', zip: '60601',
      linkedin: 'https://www.linkedin.com/in/jane-example',
      education_json: '[{"degree":"BS Computer Science","school":"Example University","year":"2015"}]',
      certifications_json: '[{"name":"Example Certification","issuer":"Example","year":"2020"}]',
    };
    prisma.resumeProfile.findUnique.mockResolvedValue(candidate);
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: providerId, reference_context: referenceContext,
    });
    const cases = [
      ['Name *', candidate.full_name], ['What is your full legal name?', candidate.full_name],
      ['Please enter your first name (required)', candidate.first_name], ['Middle name', candidate.middle_name],
      ['Last Name', candidate.last_name], ['Surname', candidate.last_name],
      ['Your email address', candidate.email], ['Phone number', candidate.phone],
    ];
    const questions = cases.map(([question]) => ({ question, options: [] }));
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: questions.map(({ question }) => ({ question, answer: 'Not provided' })),
    }));
    await expect(service.answerQuestions(user, { conversation_id: 'conversation-1', questions })).resolves.toEqual({
      answers: cases.map(([question, answer]) => ({ question, answer })),
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(aiSettings.forWorkspace).not.toHaveBeenCalled();
  });

  it('uses the full-name fallback for legacy profiles without separate name components', async () => {
    const { service, prisma } = setup();
    prisma.resumeProfile.findUnique.mockResolvedValue({ ...profile, full_name: 'Jane May Candidate' });
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: 'local_legacy', reference_context: 'Old context',
    });
    const questions = ['First name', 'Middle name', 'Last name'].map((question) => ({ question }));
    jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({ answers: questions.map(({ question }) => ({ question, answer: 'Not provided' })) }));
    await expect(service.answerQuestions(user, { conversation_id: 'conversation-1', questions })).resolves.toEqual({
      answers: [
        { question: 'First name', answer: 'Jane' }, { question: 'Middle name', answer: 'May' }, { question: 'Last name', answer: 'Candidate' },
      ],
    });
  });

  it('also fixes personal answers on the standalone profile generation endpoint', async () => {
    const { service, prisma } = setup();
    prisma.resumeProfile.findUnique.mockResolvedValue({ ...profile, full_name: '', first_name: 'Jane', last_name: 'Candidate' });
    jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({ answers: [{ question: 'Name', answer: 'Not provided' }] }));
    const result = await service.generateProfilePrompt(user, { ...dto, kind: 'applicationAnswers', questions: [{ question: 'Name' }] });
    expect(JSON.parse((result as { tailored_resume: string }).tailored_resume)).toEqual({ answers: [{ question: 'Name', answer: 'Jane Candidate' }] });
  });

  it('does not replace employer or reference names, or invent missing personal values', async () => {
    const { service, prisma } = setup();
    prisma.resumeProfile.findUnique.mockResolvedValue({ ...profile, full_name: '' });
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: 'conv_legacy',
    });
    const answers = [
      { question: 'What is your name?', answer: 'Not provided' },
      { question: "What is your employer's name?", answer: 'Acme' },
      { question: 'Reference full name', answer: 'Pat Reference' },
      { question: 'Name a project you led', answer: 'A migration project.' },
    ];
    jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({ answers }));
    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1', questions: answers.map(({ question }) => ({ question })),
    })).resolves.toEqual({ answers });
  });

  it('blocks answers for an unfinished local generation', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: 'local_unfinished', reference_context: null,
    });
    const generateText = jest.spyOn(service as any, 'generateText');
    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1', questions: [{ question: 'Name' }],
    })).rejects.toThrow('Generate a resume');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('batches only unresolved unique questions, preserves order, and reuses persisted answers', async () => {
    const { service, prisma } = setup();
    const conversation = { id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id,
      profile_id: profile.id, openai_conversation_id: 'local_test', reference_context: 'Saved resume and JD', answer_cache_json: null };
    prisma.resumeConversation.findUnique.mockResolvedValue(conversation);
    prisma.resumeConversation.update.mockImplementation(async ({ data }) => Object.assign(conversation, data));
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'It fits my experience.' }],
    }));
    const questions = [{ question: 'Why this role?' }, { question: 'Name' }, { question: 'Why this role?' }];
    const result = await service.answerQuestions(user, { conversation_id: conversation.id, questions });
    expect(result.answers.map((item) => item.answer)).toEqual(['It fits my experience.', 'Candidate', 'It fits my experience.']);
    expect(String(generateText.mock.calls[0][0]).match(/Why this role\?/g)).toHaveLength(1);
    expect(generateText.mock.calls[0][0]).not.toContain('2. Name');
    expect(conversation.answer_cache_json).toContain('It fits my experience.');

    // A new service instance can use the database cache after a server restart.
    const next = setup();
    next.prisma.resumeConversation.findUnique.mockResolvedValue(conversation);
    const request = jest.spyOn(next.service as any, 'generateText');
    await expect(next.service.answerQuestions(user, { conversation_id: conversation.id, questions })).resolves.toEqual(result);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['reference', 'profile', 'model', 'provider', 'prompt', 'options'])(
    'invalidates saved answers when %s changes', async (change) => {
      const { service, prisma, aiSettings } = setup();
      const config = await aiSettings.forWorkspace();
      aiSettings.forWorkspace.mockResolvedValue(config);
      const conversation = { id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id,
        profile_id: profile.id, openai_conversation_id: 'local_test', reference_context: 'Saved resume and JD', answer_cache_json: null };
      prisma.resumeConversation.findUnique.mockResolvedValue(conversation);
      prisma.resumeConversation.update.mockImplementation(async ({ data }) => Object.assign(conversation, data));
      const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
        answers: [{ question: 'Why this role?', answer: 'A' }],
      }));
      const input = { conversation_id: conversation.id, questions: [{ question: 'Why this role?', options: ['A', 'B'] }] };
      await service.answerQuestions(user, input);
      if (change === 'reference') conversation.reference_context = 'A different resume or JD';
      if (change === 'profile') prisma.resumeProfile.findUnique.mockResolvedValue({ ...profile, location: 'Boston, MA' });
      if (change === 'model') aiSettings.forWorkspace.mockResolvedValue({ ...config, model: 'gpt-6-luna' });
      if (change === 'provider') aiSettings.forWorkspace.mockResolvedValue({ ...config, provider: 'deepseek', model: 'deepseek-flash' });
      if (change === 'prompt') aiSettings.forWorkspace.mockResolvedValue({ ...config, resumePrompt: 'Changed prompt' });
      if (change === 'options') input.questions[0].options = ['A', 'C'];
      await service.answerQuestions(user, input);
      expect(generateText).toHaveBeenCalledTimes(2);
    },
  );

  it('uses saved context from an existing remote session with the current provider', async () => {
    const { service, prisma, aiSettings } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: 'conv_old', reference_context: 'Final resume and JD',
    });
    aiSettings.forWorkspace.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'key',
      baseUrl: 'https://api.deepseek.com', resumePrompt: DEFAULT_RESUME_PROMPT });
    const generateText = jest.spyOn(service as any, 'generateText').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'It fits my experience.' }],
    }));
    await service.answerQuestions(user, { conversation_id: 'conversation-1', questions: [{ question: 'Why this role?' }] });
    const options = generateText.mock.calls[0][1] as Record<string, unknown>;
    expect(options.referenceContext).toBe('Final resume and JD');
    expect(options).not.toHaveProperty('conversationId');
    expect(aiSettings.forWorkspace).toHaveBeenCalledWith(dto.workspace_id);
  });

  it('does not require provider credentials to return known profile answers', async () => {
    const { service, prisma, aiSettings } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', user_id: user.id, workspace_id: dto.workspace_id, profile_id: profile.id,
      openai_conversation_id: 'local_test', reference_context: 'Final resume and JD',
    });
    aiSettings.forWorkspace.mockRejectedValue(new Error('No saved provider key'));
    const request = jest.spyOn(service as any, 'generateText');
    await expect(service.answerQuestions(user, { conversation_id: 'conversation-1', questions: [{ question: 'Name' }] }))
      .resolves.toEqual({ answers: [{ question: 'Name', answer: 'Candidate' }] });
    expect(request).not.toHaveBeenCalled();
    expect(aiSettings.forWorkspace).not.toHaveBeenCalled();
  });

  it('does not allow another user to use a conversation id', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: 'different-user',
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    const generateText = jest.spyOn(service as any, 'generateText');

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [{ question: 'Why this role?', options: [] }],
    })).rejects.toThrow('Conversation not found');
    expect(generateText).not.toHaveBeenCalled();
  });

});
