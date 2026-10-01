import { ApplicationsService } from './applications.service';
import { Prisma } from '@prisma/client';

describe('ApplicationsService generated-application duplicate-click protection', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    role: 'bidder' as const,
  };
  const dto = {
    workspace_id: 'workspace-1',
    url: 'https://example.com/jobs/123',
    job_title: 'Engineer',
    company_name: 'Example',
  };
  const existing = {
    same_workspace: true as const,
    id: 'application-1',
    workspace_id: dto.workspace_id,
    normalized_url: 'example.com/jobs/123',
    url: dto.url,
    job_title: dto.job_title,
    company_name: dto.company_name,
    created_by_user_id: user.id,
    date: new Date('2026-09-22T00:00:00.000Z'),
    number: 1,
  };

  function setup() {
    const prisma = {
      jobApplication: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      resumeConversation: { findUnique: jest.fn() },
    };
    const access = { assertCanEdit: jest.fn().mockResolvedValue(undefined) };
    const numbering = {
      withNextNumber: jest.fn(async (_workspaceId, _date, create) => create(1)),
    };
    const duplicates = {
      scope: 'workspace',
      classifyBatch: jest.fn(),
      findRecentJobMatch: jest.fn().mockResolvedValue(null),
    };
    const slackNotifications = { notifyApplicationCreated: jest.fn().mockResolvedValue(undefined) };
    const service = new ApplicationsService(
      prisma as any,
      access as any,
      numbering as any,
      duplicates as any,
      { matches: jest.fn().mockResolvedValue(false), matchMany: jest.fn() } as any,
      slackNotifications as any,
    );
    return { service, prisma, numbering, duplicates, slackNotifications };
  }

  it('treats an existing identical URL in the workspace as a successful retry', async () => {
    const { service, prisma, numbering, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: true,
      duplicate_type: 'url',
      existing,
    }]);
    prisma.jobApplication.findUnique.mockResolvedValue(existing);

    await expect(service.createGenerated(user, dto)).resolves.toMatchObject({
      success: true,
      already_added: true,
      application: existing,
    });
    expect(numbering.withNextNumber).not.toHaveBeenCalled();
  });

  it('treats a database race won in the same workspace as a successful retry', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    prisma.jobApplication.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Active URL collision',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['workspace_id', 'normalized_url'] },
      },
    ));
    prisma.jobApplication.findFirst.mockResolvedValue(existing);

    await expect(service.createGenerated(user, dto)).resolves.toMatchObject({
      success: true,
      already_added: true,
      application: existing,
    });
    expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspace_id: dto.workspace_id }),
    }));
    expect(prisma.jobApplication.create).toHaveBeenCalledTimes(1);
  });

  it('blocks a recent company/title match from another URL', async () => {
    const { service, duplicates, numbering } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    duplicates.findRecentJobMatch.mockResolvedValue({
      ...existing,
      url: 'https://linkedin.com/jobs/view/123',
    });

    await expect(service.createGenerated(user, {
      ...dto,
      url: 'https://careers.example.com/jobs/123',
    })).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'job_fingerprint',
      can_override: true,
    });
    expect(numbering.withNextNumber).not.toHaveBeenCalled();
  });

  it('allows a user-confirmed company/title match', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    prisma.jobApplication.create.mockResolvedValue(existing);

    await expect(service.createGenerated(user, {
      ...dto,
      allow_similar_job: true,
    })).resolves.toMatchObject({ success: true, already_added: false });
    expect(duplicates.findRecentJobMatch).not.toHaveBeenCalled();
  });

  it('persists the reviewed resume, JD, template, and owned conversation', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    prisma.resumeConversation.findUnique.mockResolvedValue({
      user_id: user.id,
      workspace_id: dto.workspace_id,
    });
    prisma.jobApplication.create.mockResolvedValue(existing);
    const generatedResume = { summary: 'Tailored summary', skills: [] };

    await service.createGenerated(user, {
      ...dto,
      conversation_id: 'conversation-1',
      job_description: 'A sufficiently detailed remote engineering job description.',
      generated_resume: generatedResume,
      resume_template: 'modern',
      cover_letter_text: 'Dear Hiring Team,\n\nI am excited to apply.',
      cover_letter_template: 'minimal',
    });

    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversation_id: 'conversation-1',
        job_description: 'A sufficiently detailed remote engineering job description.',
        generated_resume_json: JSON.stringify(generatedResume),
        resume_template: 'modern',
        resume_generated_at: expect.any(Date),
        cover_letter_text: 'Dear Hiring Team,\n\nI am excited to apply.',
        cover_letter_template: 'minimal',
      }),
    }));
  });

  it('creates a complete manual application with the selected status', async () => {
    const { service, prisma, duplicates, slackNotifications } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    prisma.jobApplication.create.mockResolvedValue({
      ...existing,
      application_status: 'Applied',
    });

    await expect(service.createManual(user, {
      ...dto,
      application_status: 'Applied',
    })).resolves.toMatchObject({ application_status: 'Applied' });
    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        job_title: dto.job_title,
        company_name: dto.company_name,
        application_status: 'Applied',
      }),
    }));
    expect(slackNotifications.notifyApplicationCreated).toHaveBeenCalledWith(user.id);
  });

  it('applies the status policy to manual creation', async () => {
    const { service } = setup();

    await expect(service.createManual(user, {
      ...dto,
      application_status: 'Rejected',
    })).rejects.toThrow('Transition Pending');
  });
});
