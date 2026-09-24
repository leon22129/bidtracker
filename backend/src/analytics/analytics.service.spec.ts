import { AnalyticsService } from './analytics.service';

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
