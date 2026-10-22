import { AnalyticsService } from './analytics.service';

describe('AnalyticsService conversion', () => {
  it('counts banned applications separately from rejections while including them in totals', async () => {
    const prisma = { jobApplication: { groupBy: jest.fn()
      .mockResolvedValueOnce([
        { application_status: 'Pending', _count: { _all: 2 } },
        { application_status: 'Applied', _count: { _all: 5 } },
        { application_status: 'Rejected', _count: { _all: 3 } },
        { application_status: 'Banned', _count: { _all: 7 } },
        { application_status: 'Duplicated', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([]) } };
    const service = new AnalyticsService(prisma as never);

    await expect(service.conversion()).resolves.toMatchObject({
      total_applications: 18,
      rejected_count: 3,
      banned_count: 7,
      duplicate_rate: 1 / 18,
    });
  });

  it('returns zero banned applications when none exist', async () => {
    const prisma = { jobApplication: { groupBy: jest.fn().mockResolvedValue([]) } };
    const service = new AnalyticsService(prisma as never);

    await expect(service.conversion()).resolves.toMatchObject({
      total_applications: 0,
      rejected_count: 0,
      banned_count: 0,
    });
  });
});

describe('AnalyticsService upcoming interviews', () => {
  it('returns only future interviews in ascending order and keeps workspace scope', async () => {
    const prisma = { jobApplication: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new AnalyticsService(prisma as never);

    await service.upcomingInterviews({ workspace_ids: ['workspace-1'] });

    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: { in: ['workspace-1'] },
        interview_date: { gte: expect.any(Date) },
      }),
      orderBy: { interview_date: 'asc' },
    }));
  });
});
