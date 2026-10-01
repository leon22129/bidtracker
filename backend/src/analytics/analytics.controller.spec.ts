import { NotFoundException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';

describe('AnalyticsController workspace scoping', () => {
  const user = {
    id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' as const,
  };

  it('rejects an explicitly requested workspace outside the admin scope', async () => {
    const analytics = { overview: jest.fn() };
    const access = { visibleWorkspaceIds: jest.fn().mockResolvedValue(['w-allowed']) };
    const controller = new AnalyticsController(analytics as never, access as never);

    await expect(controller.overview(user, { workspace_id: 'w-other' })).rejects.toEqual(
      new NotFoundException('Workspace not found'),
    );
    expect(analytics.overview).not.toHaveBeenCalled();
  });

  it('passes an authorized explicit workspace without a conflicting fallback scope', async () => {
    const analytics = { overview: jest.fn().mockResolvedValue({}) };
    const access = { visibleWorkspaceIds: jest.fn().mockResolvedValue(['w-allowed']) };
    const controller = new AnalyticsController(analytics as never, access as never);

    await controller.overview(user, { workspace_id: 'w-allowed' });

    expect(analytics.overview).toHaveBeenCalledWith({ workspace_id: 'w-allowed' });
  });
});
