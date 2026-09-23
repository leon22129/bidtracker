import { DuplicateService } from './duplicate.service';
import { createJobFingerprint } from '../common/utils/job-fingerprint.util';

describe('DuplicateService URL-only detection', () => {
  function serviceWith(rows: any[] = []) {
    const prisma = {
      jobApplication: {
        findMany: jest.fn().mockResolvedValue(rows),
        findFirst: jest.fn().mockResolvedValue(null),
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
      workspace: { name: 'Workspace' },
    }]);

    const [verdict] = await service.classifyBatch(
      'workspace-1',
      ['https://example.com/jobs/123'],
    );

    expect(verdict).toMatchObject({ is_duplicate: true, duplicate_type: 'url' });
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

  it('finds a recent workspace match by company/title fingerprint', async () => {
    const row = {
      id: 'app-1',
      url: 'https://linkedin.com/jobs/view/123',
      normalized_url: 'linkedin.com/jobs/view/123',
      job_title: 'Software Engineer II',
      company_name: 'Acme, Inc.',
      workspace_id: 'workspace-1',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 1,
      workspace: { name: 'Workspace' },
    };
    const { service, prisma } = serviceWith();
    prisma.jobApplication.findFirst.mockResolvedValue(row);

    await expect(service.findRecentJobMatch(
      'workspace-1',
      'Acme',
      'Software Engineer 2',
    )).resolves.toMatchObject({ id: 'app-1' });
    expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: 'workspace-1',
        job_fingerprint: createJobFingerprint('Acme', 'Software Engineer 2'),
      }),
    }));
  });
});
