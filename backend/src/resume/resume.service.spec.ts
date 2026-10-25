import { Logger } from '@nestjs/common';
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
    const bannedUrls = { matches: jest.fn().mockResolvedValue(false) };
    const service = new ApplicationGenerationService(
      prisma as any,
      access as any,
      duplicates as any,
      bannedUrls as any,
      applications as any,
      {} as any,
    );
    jest.spyOn(service as any, 'createAnswerConversation').mockResolvedValue({
      id: 'conversation-1',
      openai_conversation_id: 'conv_openai_1',
    });
    return { service, duplicates, prisma, access, applications, bannedUrls };
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

  it('saves the generated application when conversation creation recovers from a 503', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    jest.useFakeTimers();
    try {
      const { service, prisma, applications } = setup();
      (service as any).createAnswerConversation.mockRestore();
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const openAi = jest.spyOn(service as any, 'openAi')
        .mockResolvedValueOnce(eligible())
        .mockResolvedValueOnce(JSON.stringify({ summary: 'Generated resume', experience: [] }));
      prisma.resumeConversation.create.mockResolvedValue({ id: 'conversation-recovered' });
      const provider = jest.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'conv_recovered' })));

      const result = expect(service.generate(user, dto)).resolves.toMatchObject({
        success: true,
        conversation_id: 'conversation-recovered',
        resume: { summary: 'Generated resume' },
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await result;
      expect(provider).toHaveBeenCalledTimes(2);
      expect(openAi).toHaveBeenCalledTimes(2);
      expect(applications.createGenerated).toHaveBeenCalledTimes(1);
      expect(applications.createGenerated).toHaveBeenCalledWith(user, expect.objectContaining({
        conversation_id: 'conversation-recovered',
      }));
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it('records a banned URL before duplicate or eligibility checks', async () => {
    const { service, applications, bannedUrls, duplicates } = setup();
    bannedUrls.matches.mockResolvedValue(true);
    const openAi = jest.spyOn(service as any, 'openAi');

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      banned: true,
      application: {
        application_status: 'Banned',
        note: 'this job is in banned list',
      },
    });

    expect(applications.createBannedApplication).toHaveBeenCalledWith(
      user,
      dto.workspace_id,
      dto.url,
    );
    expect(duplicates.classifyBatch).not.toHaveBeenCalled();
    expect(openAi).not.toHaveBeenCalled();
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
    expect(duplicates.findRecentCompanyMatch).not.toHaveBeenCalled();
  });

  it('normalizes job information within the single eligibility call for a skipped non-US job', async () => {
    const { service, applications } = setup();
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible({
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
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        company_name: 'Trinnex',
        job_title: 'Senior Full Stack Developer',
        note: 'job eligibility check failed - it is not clearly a US job; it is hybrid',
      }),
    );
  });

  it('records a clearance rejection with the requested note', async () => {
    const { service, applications } = setup();
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible({
      requires_clearance: true,
    }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      application: {
        id: 'rejected-application-1',
        application_status: 'Rejected',
      },
    });
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).toHaveBeenCalledWith(user, {
      workspace_id: dto.workspace_id,
      url: dto.url,
      job_title: 'Software Engineer',
      company_name: 'Acme',
      job_description: expect.stringContaining('Job Information'),
      note: 'job eligibility check failed - it requires clearance',
    });
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
  ])('records %s eligibility rejection in the applications table', async (_label, overrides, note) => {
    const { service, applications } = setup();
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible(overrides));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      eligible: false,
      application: { application_status: 'Rejected' },
    });
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(applications.createEligibilityRejectedApplication).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ note }),
    );
  });

  it('checks the company cooldown before generating the resume', async () => {
    const { service, duplicates, applications } = setup();
    const existing = { id: 'application-1', company_name: 'Acme', job_title: 'Software Engineer' };
    duplicates.findRecentCompanyMatch.mockResolvedValue(existing);
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible());

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'company',
      cooldown_days: 90,
      existing_application: existing,
    });
    expect(duplicates.findRecentCompanyMatch).toHaveBeenCalledWith(
      dto.workspace_id,
      'Acme',
    );
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(applications.createGenerated).not.toHaveBeenCalled();
    expect(applications.createEligibilityRejectedApplication).not.toHaveBeenCalled();
  });

  it('blocks resume generation when the target company is a previous employer', async () => {
    const { service, duplicates, applications } = setup();
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue(eligible({
      company_name: 'Visa, Inc.',
    }));
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
    expect(openAi).toHaveBeenCalledTimes(1);
    expect(duplicates.findRecentCompanyMatch).not.toHaveBeenCalled();
    expect(applications.createGenerated).not.toHaveBeenCalled();
  });

  it('uses eligibility metadata and automatically saves the generated application', async () => {
    const { service, applications } = setup();
    const openAi = jest.spyOn(service as any, 'openAi')
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
        job_description: expect.stringContaining('Location: United States'),
        conversation_id: 'conversation-1',
        generated_resume: expect.objectContaining({
          summary: 'Tailored summary',
          skills: [{ category: 'Technical Skills', items: ['TypeScript', 'PostgreSQL'] }],
        }),
      }),
    );
    expect(openAi).toHaveBeenCalledTimes(2);
    expect(openAi.mock.calls[0][0]).toContain('"salary": ""');
    expect(openAi.mock.calls[1][0]).toContain('Job Information\nTitle: Software Engineer');
    expect(openAi.mock.calls[1][0]).toContain('Salary: $140,000-$180,000 per year');
  });

  it('removes an AI signer before saving and returning a generated cover letter', async () => {
    const { service, applications, prisma } = setup();
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
    jest.spyOn(service as any, 'openAi')
      .mockResolvedValueOnce(eligible())
      .mockResolvedValueOnce(JSON.stringify({
        summary: 'Tailored summary',
        coverletter: 'Thank you for your consideration.\n\nSincerely,\nCandidate',
      }));

    await expect(service.generate(user, dto)).resolves.toMatchObject({
      success: true,
      resume: {
        coverletter: 'Thank you for your consideration.\n\nSincerely,',
      },
    });
    expect(applications.createGenerated).toHaveBeenCalledWith(
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
