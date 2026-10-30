import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  afterEach(() => jest.useRealTimers());

  it('allows a bidder to save and clear their own optional Slack ID, but never edit a webhook', async () => {
    const prisma = { user: {
      findUnique: jest.fn().mockResolvedValue({ role: 'bidder', slack_webhook_url: null, slack_user_id: null }),
      update: jest.fn().mockResolvedValue({ slack_webhook_url: null, slack_user_id: 'U123BIDDER' }),
    }, jobApplication: { count: jest.fn() } };
    const service = new AuthService(prisma as any, {} as any);
    await expect(service.updateSlackSettings('bidder-1', { slack_user_id: 'U123BIDDER' })).resolves.toMatchObject({ slack_user_id: 'U123BIDDER' });
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'bidder-1' }, data: { slack_user_id: 'U123BIDDER' },
    }));
    await service.updateSlackSettings('bidder-1', { slack_user_id: null });
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { slack_user_id: null } }));
    await expect(service.updateSlackSettings('bidder-1', { slack_webhook_url: null })).rejects.toThrow('Only admins');
    expect(prisma.jobApplication.count).not.toHaveBeenCalled();
  });

  it('blocks deactivated users before issuing a token', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'inactive',
          email: 'inactive@example.com',
          password_hash: 'unused',
          role: 'bidder',
          is_active: false,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      },
    };
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(prisma as never, jwt as never);

    await expect(
      service.login({ email: 'inactive@example.com', password: 'correct-password' }),
    ).rejects.toEqual(new UnauthorizedException('This account has been deactivated'));
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('returns only safe Slack configuration for the authenticated admin', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        slack_webhook_url: 'https://hooks.slack.com/services/T/B/secret',
        slack_user_id: 'U012ABCDEF',
      }) },
    };
    const service = new AuthService(prisma as never, {} as never);

    await expect(service.slackSettings('admin-1')).resolves.toEqual({
      webhook_configured: true,
      slack_user_id: 'U012ABCDEF',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { slack_webhook_url: true, slack_user_id: true },
    });
  });

  it('stores Slack settings only on the authenticated admin and initializes today’s milestone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T15:00:00.000Z'));
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'admin', slack_webhook_url: null, slack_user_id: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'bidder-1' }]),
        update: jest.fn().mockResolvedValue({
          slack_webhook_url: 'https://hooks.slack.com/services/T/B/secret',
          slack_user_id: 'U012ABCDEF',
        }),
      },
      jobApplication: { count: jest.fn().mockResolvedValue(17) },
    };
    const service = new AuthService(prisma as never, {} as never);

    await service.updateSlackSettings('admin-1', {
      slack_webhook_url: 'https://hooks.slack.com/services/T/B/secret',
      slack_user_id: 'U012ABCDEF',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'admin-1' },
      data: expect.objectContaining({
        slack_last_milestone: 10,
        slack_milestone_day: new Date('2026-10-01T00:00:00.000Z'),
      }),
    }));
  });

  it('clears the authenticated admin’s webhook without exposing it', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'admin',
          slack_webhook_url: 'https://hooks.slack.com/services/T/B/secret',
          slack_user_id: 'U012ABCDEF',
        }),
        update: jest.fn().mockResolvedValue({
          slack_webhook_url: null,
          slack_user_id: 'U012ABCDEF',
        }),
      },
      jobApplication: { count: jest.fn() },
    };
    const service = new AuthService(prisma as never, {} as never);

    await expect(service.updateSlackSettings('admin-1', {
      slack_webhook_url: null,
    })).resolves.toEqual({
      webhook_configured: false,
      slack_user_id: 'U012ABCDEF',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'admin-1' },
      data: { slack_webhook_url: null },
    }));
    expect(prisma.jobApplication.count).not.toHaveBeenCalled();
  });
});
