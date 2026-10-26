import { ApplicationsService } from './applications.service';
import { Prisma } from '@prisma/client';
import { DuplicateService } from './duplicate.service';

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
      $transaction: jest.fn(async (operations) => typeof operations === 'function' ? operations(prisma) : Promise.all(operations)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      jobApplication: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      resumeConversation: { findUnique: jest.fn() },
    };
    const access = {
      assertCanEdit: jest.fn().mockResolvedValue(undefined),
      assertCanView: jest.fn().mockResolvedValue(undefined),
    };
    const numbering = {
      withNextNumber: jest.fn(async (_workspaceId, _date, create) => create(1)),
    };
    const duplicates = {
      scope: 'workspace',
      classifyBatch: jest.fn(),
      classifyCompanyIdentities: jest.fn(async (_workspaceId, items: unknown[]) =>
        items.map(() => ({ is_duplicate: false }))),
      findRecentCompanyMatch: jest.fn().mockResolvedValue(null),
      companyCooldownDays: jest.fn().mockReturnValue(90),
    };
    const bannedUrls = {
      matches: jest.fn().mockResolvedValue(false),
      matchMany: jest.fn(async (urls: string[]) => urls.map(() => false)),
    };
    const slackNotifications = { notifyApplicationCreated: jest.fn().mockResolvedValue(undefined) };
    const service = new ApplicationsService(
      prisma as any,
      access as any,
      numbering as any,
      duplicates as any,
      bannedUrls as any,
      slackNotifications as any,
    );
    return { service, prisma, numbering, duplicates, bannedUrls, slackNotifications };
  }

  it('uses a forward cursor without recounting the result set', async () => {
    const { service, prisma } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([existing]);

    await expect(service.findAll(user, {
      workspace_id: dto.workspace_id,
      page_size: 200,
      cursor_after: 'previous-row',
      include_total: false,
      sort_by: 'job_title',
      sort_dir: 'asc',
    })).resolves.toMatchObject({
      total: null,
      start_cursor: existing.id,
      end_cursor: existing.id,
    });

    expect(prisma.jobApplication.count).not.toHaveBeenCalled();
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { id: 'previous-row' },
      skip: 1,
      take: 200,
      orderBy: [
        { job_title: 'asc' },
        { date: 'asc' },
        { number: 'asc' },
        { id: 'asc' },
      ],
    }));
  });

  it('uses a negative take for backward cursor pagination', async () => {
    const { service, prisma } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([existing]);

    await service.findAll(user, {
      workspace_id: dto.workspace_id,
      page_size: 200,
      cursor_before: 'next-row',
      include_total: false,
    });

    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { id: 'next-row' },
      skip: 1,
      take: -200,
    }));
  });

  it.each([
    ['forward', { cursor_after: 'current-row' }, 1],
    ['backward', { cursor_before: 'current-row' }, -1],
  ])('finds the next active screenshot %s in the filtered table order', async (_direction, cursor, take) => {
    const { service, prisma } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([existing]);
    const before = new Date();

    await service.findAll(user, {
      workspace_id: dto.workspace_id,
      ...cursor,
      page_size: 1,
      has_screenshot: true,
      include_total: false,
      application_status: ['Applied'],
      sort_by: 'company_name',
      sort_dir: 'asc',
    });

    const options = prisma.jobApplication.findMany.mock.calls[0][0];
    expect(options).toMatchObject({
      where: {
        workspace_id: dto.workspace_id,
        application_status: { in: ['Applied'] },
        screenshot: { is: { expires_at: { gt: expect.any(Date) } } },
      },
      cursor: { id: 'current-row' },
      skip: 1,
      take,
      orderBy: [{ company_name: 'asc' }, { date: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    });
    expect(options.where.screenshot.is.expires_at.gt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(prisma.jobApplication.count).not.toHaveBeenCalled();
  });

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
    duplicates.classifyBatch.mockResolvedValueOnce([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]).mockResolvedValueOnce([{
      normalized_url: existing.normalized_url, is_duplicate: true, duplicate_type: 'url', existing,
    }]);
    prisma.jobApplication.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'Active URL collision',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['workspace_id', 'normalized_url'] },
      },
    ));
    prisma.jobApplication.findUnique.mockResolvedValue(existing);

    await expect(service.createGenerated(user, dto)).resolves.toMatchObject({
      success: true,
      already_added: true,
      application: existing,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.jobApplication.create).toHaveBeenCalledTimes(1);
  });

  it('records a company duplicate even when the job title differs', async () => {
    const { service, duplicates, prisma } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    duplicates.findRecentCompanyMatch.mockResolvedValue({
      ...existing,
      url: 'https://linkedin.com/jobs/view/123',
      job_title: 'A Different Role',
    });

    await expect(service.createGenerated(user, {
      ...dto,
      url: 'https://careers.example.com/jobs/123',
    })).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'company',
    });
    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ application_status: 'Duplicated' }),
    }));
  });

  it('does not allow the company cooldown to be overridden', async () => {
    const { service, duplicates, prisma } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    duplicates.findRecentCompanyMatch.mockResolvedValue(existing);

    await expect(service.createGenerated(user, {
      ...dto,
      allow_similar_job: true,
    })).resolves.toMatchObject({
      success: false,
      duplicate: true,
      duplicate_type: 'company',
    });
    expect(duplicates.findRecentCompanyMatch).toHaveBeenCalledWith(
      dto.workspace_id,
      dto.company_name,
      undefined, expect.anything(),
    );
    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ application_status: 'Duplicated' }),
    }));
  });

  it.each(['bidder', 'admin'] as const)(
    'checks the company when %s changes only Pending to Applied', async (role) => {
      const { service, prisma, duplicates } = setup();
      prisma.jobApplication.findUnique.mockResolvedValue({
        ...existing, application_status: 'Pending', paid: false,
      });
      duplicates.findRecentCompanyMatch.mockResolvedValue({
        ...existing, id: 'other-application', job_title: 'A different job title',
      });
      const update = service.update({ ...user, role }, existing.id, { application_status: 'Applied' });

      await update;
      expect(prisma.jobApplication.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ application_status: 'Duplicated' }),
      }));
      expect(duplicates.findRecentCompanyMatch).toHaveBeenCalledWith(
        dto.workspace_id, dto.company_name, existing.id, prisma,
      );
    },
  );

  it('marks later same-company applications as duplicates in a bulk status update', async () => {
    const { service, prisma, duplicates } = setup();
    const rows = ['Engineer', 'Designer'].map((job_title, index) => ({
      ...existing, id: `pending-${index}`, job_title, application_status: 'Pending', paid: false,
    }));
    prisma.jobApplication.findMany.mockResolvedValue(rows);
    const realDuplicates = new DuplicateService({
      jobApplication: { findMany: jest.fn().mockResolvedValue([]) },
    } as any);
    duplicates.classifyCompanyIdentities.mockImplementation(
      (workspaceId, items) => realDuplicates.classifyCompanyIdentities(workspaceId, items as any),
    );

    await expect(service.bulkUpdate(user, {
      ids: rows.map((row) => row.id), patch: { application_status: 'Applied' },
    })).resolves.toMatchObject({
      updated: 2, updated_ids: ['pending-0', 'pending-1'], failed: [],
    });
    expect(prisma.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pending-0'] } }, data: { application_status: 'Applied' },
    });
    expect(prisma.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pending-1'] } }, data: { application_status: 'Duplicated' },
    });
  });

  it('keeps selected Applied rows as company history when applying other rows in bulk', async () => {
    const { service, prisma, duplicates } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([
      { ...existing, application_status: 'Applied', paid: false },
      { ...existing, id: 'pending', job_title: 'Designer', application_status: 'Pending', paid: false },
    ]);
    duplicates.classifyCompanyIdentities.mockResolvedValue([{ is_duplicate: true }]);

    await expect(service.bulkUpdate(user, {
      ids: [existing.id, 'pending'], patch: { application_status: 'Applied' },
    })).resolves.toMatchObject({
      updated_ids: [existing.id, 'pending'], failed: [],
    });
    expect(duplicates.classifyCompanyIdentities).toHaveBeenCalledWith(
      dto.workspace_id, [{ company_name: dto.company_name, job_title: 'Designer' }], ['pending'], prisma,
    );
  });

  it('does not let locked rows reserve a company during a bulk status update', async () => {
    const { service, prisma, duplicates } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([
      { ...existing, id: 'locked', application_status: 'Pending', paid: true },
      { ...existing, id: 'pending', job_title: 'Designer', application_status: 'Pending', paid: false },
    ]);

    await expect(service.bulkUpdate(user, {
      ids: ['locked', 'pending'], patch: { application_status: 'Applied' },
    })).resolves.toMatchObject({ updated_ids: ['pending'], failed: [{ id: 'locked', reason: expect.any(String) }] });
    expect(duplicates.classifyCompanyIdentities).toHaveBeenCalledWith(
      dto.workspace_id, [{ company_name: dto.company_name, job_title: 'Designer' }], ['pending'], prisma,
    );
  });

  it('persists an eligibility rejection with its note and job details', async () => {
    const { service, prisma, duplicates, slackNotifications } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);
    prisma.jobApplication.create.mockResolvedValue({
      ...existing,
      application_status: 'Rejected',
      note: 'job eligibility check failed - it requires clearance',
    });

    await expect(service.createEligibilityRejectedApplication(user, {
      ...dto,
      job_description: 'A remote engineering role that requires clearance.',
      note: 'job eligibility check failed - it requires clearance',
    })).resolves.toMatchObject({ application_status: 'Rejected' });

    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        application_status: 'Rejected',
        pipeline_status: 'Not Started',
        company_name: dto.company_name,
        job_title: dto.job_title,
        job_description: 'A remote engineering role that requires clearance.',
        note: 'job eligibility check failed - it requires clearance',
        created_by_user_id: user.id,
      }),
    }));
    expect(slackNotifications.notifyApplicationCreated).toHaveBeenCalledWith(user.id);
  });

  it('marks an existing banned URL as Banned and saves the banned-list note', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: true,
      existing,
    }]);
    prisma.jobApplication.update.mockResolvedValue({
      ...existing,
      application_status: 'Banned',
      note: 'this job is in banned list',
    });

    await expect(service.createBannedApplication(user, dto.workspace_id, dto.url))
      .resolves.toMatchObject({
        application_status: 'Banned',
        note: 'this job is in banned list',
      });
    expect(prisma.jobApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: existing.id },
      data: {
        application_status: 'Banned',
        note: 'this job is in banned list',
      },
    }));
  });

  it('creates a new banned application with its own status', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: false,
    }]);

    await service.createBannedApplication(user, dto.workspace_id, dto.url);

    expect(prisma.jobApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        application_status: 'Banned',
        note: 'this job is in banned list',
      }),
    }));
  });

  it.each([false, true])('blocks a reused URL during manual entry even when banned=%s', async (banned) => {
    const { service, prisma, duplicates, bannedUrls } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: true,
      existing,
    }]);
    bannedUrls.matches.mockResolvedValue(banned);

    await expect(service.createManual(user, {
      ...dto, company_name: 'A different company', application_status: 'Applied',
    })).rejects.toThrow('URL already exists');

    expect(prisma.jobApplication.create).not.toHaveBeenCalled();
  });

  it('refuses a reused URL in the import insert helper', async () => {
    const { service, prisma, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      is_duplicate: true, duplicate_type: 'url', existing,
    }]);

    await expect(service.insertChunked([{
      ...dto, company_name: 'A different company', normalized_url: existing.normalized_url,
      date: new Date(), number: 1, created_by_user_id: user.id,
    }], dto.workspace_id)).rejects.toThrow('URL already exists');
    expect(prisma.jobApplication.createMany).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'https://banned.example/jobs/1', application_status: 'Applied' as const },
    { note: 'Updated note', application_status: 'Applied' as const },
  ])('marks banned URLs as Banned when editing a row: %j', async (patch) => {
    const { service, prisma, bannedUrls } = setup();
    prisma.jobApplication.findUnique.mockResolvedValue({
      ...existing,
      paid: false,
      application_status: 'Pending',
    });
    bannedUrls.matches.mockResolvedValue(true);

    await service.update(user, existing.id, patch);

    expect(prisma.jobApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        application_status: 'Banned',
        note: 'this job is in banned list',
      }),
    }));
  });

  it('keeps banned and ordinary statuses separate in a bulk edit', async () => {
    const { service, prisma, bannedUrls } = setup();
    prisma.jobApplication.findMany.mockResolvedValue([
      { ...existing, application_status: 'Pending', paid: false },
      { ...existing, id: 'application-2', application_status: 'Pending', paid: false },
    ]);
    bannedUrls.matchMany.mockResolvedValue([true, false]);

    await expect(service.bulkUpdate(user, {
      ids: [existing.id, 'application-2'],
      patch: { application_status: 'Applied' },
    })).resolves.toMatchObject({ updated: 2, failed: [] });

    expect(prisma.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [existing.id] } },
      data: { application_status: 'Banned', note: 'this job is in banned list' },
    });
    expect(prisma.jobApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['application-2'] } },
      data: { application_status: 'Applied' },
    });
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

  it('restores the signed-in user\'s latest generated application', async () => {
    const { service, prisma } = setup();
    prisma.jobApplication.findFirst.mockResolvedValue({
      id: 'application-1',
      url: dto.url,
      job_title: dto.job_title,
      company_name: dto.company_name,
      generated_resume_json: JSON.stringify({ summary: 'Recovered resume', personalInfo: {} }),
      resume_template: 'modern',
      resume_generated_at: new Date('2026-10-01T12:00:00.000Z'),
      job_description: 'Recovered job description',
      conversation_id: 'conversation-1',
      cover_letter_text: 'Recovered cover letter',
      cover_letter_template: 'minimal',
      application_questions_json: JSON.stringify([{
        question: 'Why this role?',
        options: [],
      }]),
      application_answers_json: JSON.stringify([{
        question: 'Why this role?',
        answer: 'It matches my experience.',
      }]),
    });

    await expect(service.getLatestGenerated(user, dto.workspace_id)).resolves.toMatchObject({
      id: 'application-1',
      url: dto.url,
      resume: { summary: 'Recovered resume', personalInfo: {} },
      conversation_id: 'conversation-1',
      questions: [{ question: 'Why this role?', options: [] }],
      answers: [{ question: 'Why this role?', answer: 'It matches my experience.' }],
    });
    expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: dto.workspace_id,
        created_by_user_id: user.id,
        generated_resume_json: { not: null },
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
