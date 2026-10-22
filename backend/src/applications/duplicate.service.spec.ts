import { DuplicateService } from './duplicate.service';
describe('DuplicateService URL-only detection', () => {
  function serviceWith(rows: any[] = []) {
    const prisma = {
      jobApplication: {
        findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          rows.filter((row) => {
            if (where?.workspace_id && row.workspace_id !== where.workspace_id) return false;
            if (where?.normalized_url?.in && !where.normalized_url.in.includes(row.normalized_url)) return false;
            if (where?.date?.gte && row.date < where.date.gte) return false;
            if (where?.application_status?.not && row.application_status === where.application_status.not) return false;
            return true;
          }),
        )),
      },
    };
    return { service: new DuplicateService(prisma as any), prisma };
  }

  it('classifies normalized variants of an existing URL as duplicates', async () => {
    const { service } = serviceWith([{
      id: 'app-1',
      url: 'https://www.example.com/jobs/123?utm_source=email',
      normalized_url: 'example.com/jobs/123',
      job_title: 'Engineer',
      company_name: 'Example',
      workspace_id: 'workspace-1',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 1,
    }]);

    const [verdict] = await service.classifyBatch(
      'workspace-1',
      ['https://example.com/jobs/123'],
    );

    expect(verdict).toMatchObject({ is_duplicate: true, duplicate_type: 'url' });
    expect(verdict.existing).toMatchObject({ same_workspace: true, id: 'app-1' });
  });

  it('does not classify the same URL in another workspace as a duplicate', async () => {
    const { service, prisma } = serviceWith([{
      id: 'secret-app',
      url: 'https://example.com/jobs/123',
      normalized_url: 'example.com/jobs/123',
      job_title: 'Secret title',
      company_name: 'Secret company',
      workspace_id: 'secret-workspace',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 42,
    }]);

    const [verdict] = await service.classifyBatch(
      'workspace-1',
      ['https://example.com/jobs/123'],
    );

    expect(verdict).toMatchObject({ is_duplicate: false });
    expect(verdict).not.toHaveProperty('existing');
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspace_id: 'workspace-1' }),
    }));
  });

  it('detects repeated normalized URLs within one batch', async () => {
    const { service } = serviceWith();
    const verdicts = await service.classifyBatch('workspace-1', [
      'https://www.example.com/jobs/123',
      'https://example.com/jobs/123/',
    ]);

    expect(verdicts[0].is_duplicate).toBe(false);
    expect(verdicts[1]).toMatchObject({
      is_duplicate: true,
      reason: 'within_batch',
      duplicate_type: 'url',
    });
  });

  it('does not treat different URLs at the same company as duplicates', async () => {
    const { service } = serviceWith();
    const verdicts = await service.classifyBatch('workspace-1', [
      'https://example.com/jobs/123',
      'https://example.com/jobs/456',
    ]);

    expect(verdicts.every((verdict) => !verdict.is_duplicate)).toBe(true);
  });

  it('finds a recent workspace match by normalized company despite a different title', async () => {
    const row = {
      id: 'app-1',
      url: 'https://linkedin.com/jobs/view/123',
      normalized_url: 'linkedin.com/jobs/view/123',
      job_title: 'Software Engineer II',
      company_name: 'Acme, Inc.',
      workspace_id: 'workspace-1',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 1,
    };
    const { service, prisma } = serviceWith([row]);

    await expect(service.findRecentCompanyMatch(
      'workspace-1',
      'Acme',
    )).resolves.toMatchObject({ id: 'app-1' });
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: 'workspace-1',
        date: { gte: expect.any(Date) },
      }),
    }));
  });

  it('does not match an application outside the 90-day company cooldown', async () => {
    const { service } = serviceWith([{
      id: 'old-app',
      url: 'https://example.com/jobs/old',
      normalized_url: 'example.com/jobs/old',
      job_title: 'Engineer',
      company_name: 'Visa Inc.',
      workspace_id: 'workspace-1',
      date: new Date('2020-01-01T00:00:00.000Z'),
      number: 1,
    }]);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Visa')).resolves.toBeNull();
  });

  it('does not extend the cooldown from a row already marked as duplicated', async () => {
    const { service } = serviceWith([{
      id: 'duplicate-attempt',
      url: 'https://example.com/jobs/duplicate',
      normalized_url: 'example.com/jobs/duplicate',
      job_title: 'Engineer',
      company_name: 'Visa',
      workspace_id: 'workspace-1',
      application_status: 'Duplicated',
      date: new Date(),
      number: 1,
    }]);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Visa')).resolves.toBeNull();
  });

  it('classifies repeated normalized companies within one batch even when titles differ', async () => {
    const { service } = serviceWith();

    const verdicts = await service.classifyCompanyIdentities('workspace-1', [
      { company_name: 'Visa, Inc.' },
      { company_name: 'Visa' },
    ]);

    expect(verdicts[0].is_duplicate).toBe(false);
    expect(verdicts[1]).toMatchObject({ is_duplicate: true, reason: 'within_batch' });
  });
});
