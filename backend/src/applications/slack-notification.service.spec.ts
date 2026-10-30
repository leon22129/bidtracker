import { SlackNotificationService } from './slack-notification.service';

describe('SlackNotificationService', () => {
  const webhook = 'https://hooks.slack.com/services/T000/B000/secret';

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T15:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function setup(total = 10) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          username: 'lucky',
          role: 'admin',
          slack_webhook_url: webhook,
          slack_user_id: 'U012ABCDEF',
          creator: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      jobApplication: {
        count: jest.fn().mockResolvedValue(total),
        groupBy: jest.fn().mockResolvedValue([
          { workspace_id: 'michael', _count: { _all: 3 } },
          { workspace_id: 'kevin', _count: { _all: total - 3 } },
        ]),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'michael', name: 'Michael workspace', resumeProfile: { name: 'Michael' } },
          { id: 'kevin', name: 'Kevin workspace', resumeProfile: { name: 'Kevin' } },
        ]),
      },
    };
    const service = new SlackNotificationService(prisma as any);
    return { prisma, service };
  }

  it('sends a cumulative milestone with a real mention and profile breakdown', async () => {
    const { prisma, service } = setup(10);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await service.notifyApplicationCreated('admin-1');

    expect(prisma.jobApplication.count).toHaveBeenCalledWith({
      where: {
        created_by_user_id: 'admin-1',
        application_status: 'Applied',
        created_at: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-02T00:00:00.000Z'),
        },
      },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'admin-1' }),
      data: {
        slack_milestone_day: new Date('2026-10-01T00:00:00.000Z'),
        slack_last_milestone: 10,
      },
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.text).toBe(
      '10 applications received today with <@U012ABCDEF>.\n• Kevin: 7 • Michael: 3',
    );
  });

  it('does not resend a milestone already claimed in the database', async () => {
    const { prisma, service } = setup(20);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    const fetchMock = jest.spyOn(global, 'fetch');

    await service.notifyApplicationCreated('admin-1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not resend the crossed milestone on later applications', async () => {
    const { prisma, service } = setup(11);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    const fetchMock = jest.spyOn(global, 'fetch');

    await service.notifyApplicationCreated('admin-1');

    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slack_last_milestone: 10 }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the owning admin webhook but keeps counting and milestone state per bidder', async () => {
    const { prisma, service } = setup(10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'bidder-1',
      username: 'test',
      role: 'bidder',
      slack_webhook_url: null,
      slack_user_id: null,
      creator: {
        id: 'admin-1',
        role: 'admin',
        slack_webhook_url: webhook,
        slack_user_id: 'U012ABCDEF',
      },
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'bidder-1' }]);
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await service.notifyApplicationCreated('bidder-1');

    expect(prisma.jobApplication.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        created_by_user_id: 'bidder-1',
        application_status: 'Applied',
      }),
    }));
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bidder-1' }),
    }));
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.text).toContain('applications received today with @test.');
    expect(body.text).not.toContain('<@U012ABCDEF>');
  });

  it('does nothing without a configured webhook', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1', username: 'lucky', role: 'admin',
      slack_webhook_url: null, slack_user_id: 'U012ABCDEF', creator: null,
    });
    const fetchMock = jest.spyOn(global, 'fetch');

    await service.notifyApplicationCreated('admin-1');

    expect(prisma.jobApplication.count).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mentions the bidder using their optional Slack ID even if the admin has no Slack ID', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'bidder-1', username: 'bidder', role: 'bidder', slack_webhook_url: null,
      slack_user_id: 'U987BIDDER',
      creator: { id: 'admin-1', role: 'admin', slack_webhook_url: webhook, slack_user_id: null },
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    await service.notifyApplicationCreated('bidder-1');
    expect(fetchMock.mock.calls[0][0]).toBe(webhook);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).text).toContain('<@U987BIDDER>');
  });

  it('still sends milestones when neither the bidder nor admin entered a Slack ID', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'bidder-1', username: 'bidder', role: 'bidder', slack_webhook_url: null, slack_user_id: null,
      creator: { id: 'admin-1', role: 'admin', slack_webhook_url: webhook, slack_user_id: null },
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    await service.notifyApplicationCreated('bidder-1');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).text).toContain('with @bidder.');
  });

  it('contains Slack failures so application creation can still succeed', async () => {
    const { service } = setup();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error(`request to ${webhook} failed`));
    const log = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(service.notifyApplicationCreated('admin-1')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.not.stringContaining(webhook));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[redacted Slack webhook]'));
  });
});
