import { ApplicationsService } from './applications.service';
import { ApplicationIngestionLockService } from './application-ingestion-lock.service';

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
    id: 'application-1',
    workspace_id: dto.workspace_id,
    workspace_name: 'Workspace',
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
        create: jest.fn(),
      },
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
    const service = new ApplicationsService(
      prisma as any,
      access as any,
      numbering as any,
      duplicates as any,
      { matches: jest.fn().mockResolvedValue(false), matchMany: jest.fn() } as any,
      new ApplicationIngestionLockService(),
    );
    return { service, prisma, numbering, duplicates };
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

  it('does not treat a cross-workspace URL as a successful retry', async () => {
    const { service, duplicates } = setup();
    duplicates.classifyBatch.mockResolvedValue([{
      normalized_url: existing.normalized_url,
      is_duplicate: true,
      duplicate_type: 'url',
      existing: { ...existing, workspace_id: 'workspace-2' },
    }]);

    await expect(service.createGenerated(user, dto)).resolves.toMatchObject({
      success: false,
      duplicate: true,
    });
  });

  it('serializes simultaneous requests for the same normalized URL', async () => {
    const { service, prisma, duplicates } = setup();
    let created = false;
    duplicates.classifyBatch.mockImplementation(async () => created
      ? [{
          normalized_url: existing.normalized_url,
          is_duplicate: true,
          duplicate_type: 'url',
          existing,
        }]
      : [{ normalized_url: existing.normalized_url, is_duplicate: false }]);
    prisma.jobApplication.create.mockImplementation(async () => {
      await Promise.resolve();
      created = true;
      return existing;
    });
    prisma.jobApplication.findUnique.mockResolvedValue(existing);

    const [first, second] = await Promise.all([
      service.createGenerated(user, dto),
      service.createGenerated(user, dto),
    ]);

    expect(first).toMatchObject({ success: true, already_added: false });
    expect(second).toMatchObject({ success: true, already_added: true });
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

  it('creates a complete manual application with the selected status', async () => {
    const { service, prisma, duplicates } = setup();
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
  });

  it('applies the status policy to manual creation', async () => {
    const { service } = setup();

    await expect(service.createManual(user, {
      ...dto,
      application_status: 'Rejected',
    })).rejects.toThrow('Transition Pending');
  });
});
