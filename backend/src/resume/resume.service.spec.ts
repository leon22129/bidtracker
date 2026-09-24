import { ApplicationGenerationService } from './resume.service';

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
  };

  function setup() {
    const prisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({
        id: dto.workspace_id,
        owner_user_id: user.id,
        name: 'Workspace',
        resumeProfile: profile,
      }) },
      resumeProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      resumeConversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const access = { assertCanEdit: jest.fn().mockResolvedValue(undefined) };
    const duplicates = {
      classifyBatch: jest.fn().mockResolvedValue([{ is_duplicate: false }]),
      findRecentJobMatch: jest.fn().mockResolvedValue(null),
    };
    const service = new ApplicationGenerationService(
      prisma as any,
      access as any,
      duplicates as any,
      { matches: jest.fn().mockResolvedValue(false) } as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'createAnswerConversation').mockResolvedValue({
      id: 'conversation-1',
      openai_conversation_id: 'conv_openai_1',
    });
    return { service, duplicates, prisma, access };
  }

  const eligible = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    company_name: 'Acme',
    job_title: 'Software Engineer',
    requires_clearance: false,
    requires_public_trust: false,
    is_us_job: true,
    work_arrangement_is_remote_only: true,
    requires_in_person_interview: false,
    requires_onsite_onboarding: false,
    reason: '',
    ...overrides,
  });

  it.each([
    ['company_name', 'company name'],
    ['job_title', 'job title'],
  ])('stops after eligibility when the JD has no %s', async (field, label) => {
    const { service, duplicates } = setup();
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(
      eligible({ [field]: '' }),
    );

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      reason: `Need ${label} in the JD.`,
    });
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(duplicates.findRecentJobMatch).not.toHaveBeenCalled();
  });

  it('checks the company/title fingerprint before generating the resume', async () => {
    const { service, duplicates } = setup();
    const existing = { id: 'application-1', company_name: 'Acme', job_title: 'Software Engineer' };
    duplicates.findRecentJobMatch.mockResolvedValue(existing);
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible());

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'job_fingerprint',
      existing_application: existing,
    });
    expect(duplicates.findRecentJobMatch).toHaveBeenCalledWith(
      dto.workspace_id,
      'Acme',
      'Software Engineer',
    );
    expect(openAi).toHaveBeenCalledTimes(1);
  });

  it('uses eligibility metadata for the saved application candidate', async () => {
    const { service } = setup();
    jest.spyOn(service as any, 'openAi')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({
        target_company: 'Different AI spelling',
        target_job_title: 'Different AI title',
      }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: true,
      conversation_id: 'conversation-1',
      application: {
        company_name: 'Acme',
        job_title: 'Software Engineer',
      },
    });
  });

  it('answers from an owned compact conversation without resending the JD or resume', async () => {
    const { service, prisma, access } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: user.id,
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: ['Why this role?'],
    })).resolves.toEqual({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    });

    expect(access.assertCanEdit).toHaveBeenCalledWith(user, dto.workspace_id);
    expect(openAi).toHaveBeenCalledWith(
      expect.stringContaining('Why this role?'),
      expect.objectContaining({ conversationId: 'conv_openai_1' }),
    );
    expect(openAi.mock.calls[0][0]).not.toContain(dto.job_description);
  });

  it('does not allow another user to use a conversation id', async () => {
    const { service, prisma } = setup();
    prisma.resumeConversation.findUnique.mockResolvedValue({
      id: 'conversation-1',
      user_id: 'different-user',
      workspace_id: dto.workspace_id,
      openai_conversation_id: 'conv_openai_1',
    });
    const openAi = jest.spyOn(service as any, 'openAi');

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: ['Why this role?'],
    })).rejects.toThrow('Conversation not found');
    expect(openAi).not.toHaveBeenCalled();
  });
});
