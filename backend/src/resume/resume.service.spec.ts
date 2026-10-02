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
    us_work_status: 'US Citizen',
    requires_sponsorship: 'No',
    legally_authorized_us: 'Yes',
    gender: 'Male',
    hispanic_latino: 'No',
    ethnicity: 'White',
  };

  function setup() {
    const prisma = {
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
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
      jobApplication: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const access = { assertCanEdit: jest.fn().mockResolvedValue(undefined) };
    const duplicates = {
      classifyBatch: jest.fn().mockResolvedValue([{ is_duplicate: false }]),
      findRecentJobMatch: jest.fn().mockResolvedValue(null),
    };
    const applications = {
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
    const service = new ApplicationGenerationService(
      prisma as any,
      access as any,
      duplicates as any,
      { matches: jest.fn().mockResolvedValue(false) } as any,
      applications as any,
      {} as any,
    );
    jest.spyOn(service as any, 'createAnswerConversation').mockResolvedValue({
      id: 'conversation-1',
      openai_conversation_id: 'conv_openai_1',
    });
    return { service, duplicates, prisma, access, applications };
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

  it('uses eligibility metadata and automatically saves the generated application', async () => {
    const { service, applications } = setup();
    jest.spyOn(service as any, 'openAi')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({
        target_company: 'Different AI spelling',
        target_job_title: 'Different AI title',
        summary: 'Tailored summary',
        skills: ['TypeScript', 'PostgreSQL'],
      }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: true,
      conversation_id: 'conversation-1',
      application: {
        company_name: 'Acme',
        job_title: 'Software Engineer',
      },
    });
    expect(applications.createGenerated).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        workspace_id: dto.workspace_id,
        url: dto.url,
        company_name: 'Acme',
        job_title: 'Software Engineer',
        job_description: dto.job_description,
        conversation_id: 'conversation-1',
        generated_resume: expect.objectContaining({
          summary: 'Tailored summary',
          skills: [{ category: 'Technical Skills', items: ['TypeScript', 'PostgreSQL'] }],
        }),
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
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [{ question: 'Why this role?', options: [] }],
    })).resolves.toEqual({
      answers: [{ question: 'Why this role?', answer: 'It aligns with my experience.' }],
    });

    expect(access.assertCanEdit).toHaveBeenCalledWith(user, dto.workspace_id);
    expect(openAi).toHaveBeenCalledWith(
      expect.stringContaining('Why this role?'),
      expect.objectContaining({ conversationId: 'conv_openai_1' }),
    );
    expect(openAi.mock.calls[0][0]).not.toContain(dto.job_description);
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
    const provider = jest.spyOn(service as any, 'openAiRequest');

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
    jest.spyOn(service as any, 'openAiRequest').mockResolvedValue({
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

  it('seeds answer conversations with real candidate profile values', async () => {
    const { service, prisma } = setup();
    (service as any).createAnswerConversation.mockRestore();
    prisma.resumeConversation.create.mockResolvedValue({
      id: 'conversation-1',
      openai_conversation_id: 'conv_openai_1',
    });
    const request = jest.spyOn(service as any, 'openAiRequest').mockResolvedValue({
      id: 'conv_openai_1',
    });

    await (service as any).createAnswerConversation(
      user,
      profile,
      dto.workspace_id,
      dto.job_description,
      { summary: 'Tailored summary' },
    );

    const body = request.mock.calls[0][1] as any;
    const context = body.items[0].content as string;
    expect(context).toContain('Candidate info:');
    expect(context).toContain('US work status: US Citizen');
    expect(context).toContain('Require employment sponsorship now or later: No');
    expect(context).toContain('Legally authorized to work in the US: Yes');
    expect(context).toContain('Gender: Male');
    expect(context).toContain('Hispanic/Latino: No');
    expect(context).toContain('Race: White');
    expect(prisma.resumeConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ profile_id: profile.id }),
    });
  });

  it('replaces resume prompt placeholders with real candidate information', () => {
    const { service } = setup();
    const prompt = (service as any).resumePrompt(profile, dto.job_description) as string;

    expect(prompt).toContain(`JD:\n${dto.job_description}`);
    expect(prompt).toContain(`Candidate Current Location (city and/or state):\n${profile.location}`);
    expect(prompt).toContain('Candidate info:\nUS work status: US Citizen');
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
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(JSON.stringify({
      answers: [{ question: 'Do you have Kubernetes experience?', answer: 'yes' }],
    }));

    await expect(service.answerQuestions(user, {
      conversation_id: 'conversation-1',
      questions: [{ question: 'Do you have Kubernetes experience?', options: ['Yes', 'No'] }],
    })).resolves.toEqual({
      answers: [{ question: 'Do you have Kubernetes experience?', answer: 'Yes' }],
    });
    expect(openAi.mock.calls[0][0]).toContain('Allowed answers: ["Yes","No"]');
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
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(JSON.stringify({
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
      questions: [{ question: 'Why this role?', options: [] }],
    })).rejects.toThrow('Conversation not found');
    expect(openAi).not.toHaveBeenCalled();
  });

});
