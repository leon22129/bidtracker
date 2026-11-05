import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  it('atomically settles the previous week for every payable application creator', async () => {
    const report = {
      id: 'report-auto', bidder_id: 'bidder-1', applied_count: 3,
      start_date: new Date('2026-09-14'), end_date: new Date('2026-09-20'),
      processed_by: null, processed_at: new Date('2026-09-21'),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'bidder-1' }]) },
      jobApplication: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      paymentReport: { create: jest.fn().mockResolvedValue(report) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PaymentsService(prisma as never, {} as never);

    await expect(service.processPreviousWeekAutomatically(
      new Date('2026-09-21T00:05:00.000Z'),
    )).resolves.toMatchObject({
      skipped: false,
      total_applied: 3,
      reports: [report],
    });

    expect(tx.jobApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ created_by_user_id: 'bidder-1', application_status: 'Applied', paid: false }),
      data: { paid: true },
    }));
    expect(tx.paymentReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processed_by: null, applied_count: 3 }),
    }));
  });

  it('skips automatic settlement when another backend owns the advisory lock', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: false }]),
      user: { findMany: jest.fn() },
      jobApplication: { updateMany: jest.fn() },
      paymentReport: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PaymentsService(prisma as never, {} as never);

    await expect(service.processPreviousWeekAutomatically()).resolves.toMatchObject({
      skipped: true,
      reason: 'another_backend_is_processing',
    });
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });

  it('returns the existing exact-period report when payment was already processed', async () => {
    const existing = {
      id: 'report-1', bidder_id: 'bidder-1', start_date: new Date('2026-09-01'),
      end_date: new Date('2026-09-07'), applied_count: 4,
      processed_by: 'admin-1', processed_at: new Date('2026-09-08'),
    };
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'bidder-1' }) },
      jobApplication: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      paymentReport: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PaymentsService(prisma as never, {} as never);

    await expect(service.process(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { bidder_id: 'bidder-1', start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({ id: 'report-1', already_processed: true });

    expect(tx.paymentReport.create).not.toHaveBeenCalled();
    expect(tx.jobApplication.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.jobApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ created_by_user_id: 'bidder-1', application_status: 'Applied', paid: false }),
    }));
  });

  it('groups exact visible workspaces by immutable application creator', async () => {
    const prisma = {
      jobApplication: {
        groupBy: jest.fn().mockResolvedValue([
          {
            workspace_id: 'workspace-visible',
            created_by_user_id: 'bidder-original',
            application_status: 'Applied',
            _count: { _all: 2 },
          },
        ]),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'workspace-visible',
          name: 'Visible',
        }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'bidder-original',
          username: 'original-bidder',
        }]),
      },
    };
    const access = { visibleWorkspaceIds: jest.fn().mockResolvedValue(['workspace-visible']) };
    const service = new PaymentsService(prisma as never, access as never);

    await expect(service.report(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({ total_applied: 2 });

    await expect(service.report(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({
      bidders: [{ bidder_id: 'bidder-original', bidder_username: 'original-bidder' }],
    });

    expect(prisma.jobApplication.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspace_id: { in: ['workspace-visible'] } }),
    }));
  });

  it('shows bidders only their own creator-attributed work after workspace reassignment', async () => {
    const prisma = {
      jobApplication: {
        groupBy: jest.fn().mockResolvedValue([{
          workspace_id: 'former-workspace',
          created_by_user_id: 'bidder-1',
          application_status: 'Rejected',
          _count: { _all: 3 },
        }]),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue([{ id: 'former-workspace', name: 'Former Profile' }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'bidder-1', username: 'bidder' }]),
      },
    };
    const access = { visibleWorkspaceIds: jest.fn() };
    const service = new PaymentsService(prisma as never, access as never);

    await expect(service.report(
      { id: 'bidder-1', username: 'bidder', email: 'bidder@example.com', role: 'bidder' },
      {
        start_date: '2026-09-01',
        end_date: '2026-09-07',
        bidder_id: 'someone-else',
      },
    )).resolves.toMatchObject({
      total_applied: 0,
      total_rejected: 3,
      bidders: [{ bidder_id: 'bidder-1', applied_count: 0, rejected_count: 3 }],
      managers: [{
        manager_id: null,
        applied_count: 0,
        rejected_count: 3,
        profiles: [{ workspace_id: 'former-workspace', applied_count: 0, rejected_count: 3 }],
      }],
    });

    expect(access.visibleWorkspaceIds).not.toHaveBeenCalled();
    expect(prisma.jobApplication.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['created_by_user_id', 'workspace_id', 'application_status'],
      where: expect.objectContaining({
        created_by_user_id: 'bidder-1',
        date: { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-07T23:59:59.999Z') },
        OR: [
          { application_status: 'Applied', paid: false },
          { application_status: 'Rejected' },
        ],
      }),
    }));
    expect(prisma.jobApplication.groupBy.mock.calls[0][0].where).not.toHaveProperty('workspace_id');
    expect(prisma.jobApplication.groupBy.mock.calls[0][0].where).not.toHaveProperty('paid');
  });

  it('combines Applied and Rejected counts per creator and profile under their bidder manager', async () => {
    const prisma = {
      jobApplication: {
        groupBy: jest.fn().mockResolvedValue([
          { workspace_id: 'rock-profile', created_by_user_id: 'richard', application_status: 'Rejected', _count: { _all: 5 } },
          { workspace_id: 'rock-profile', created_by_user_id: 'richard', application_status: 'Applied', _count: { _all: 100 } },
          { workspace_id: 'hao-profile', created_by_user_id: 'jacob', application_status: 'Applied', _count: { _all: 100 } },
          { workspace_id: 'hao-profile', created_by_user_id: 'jacob', application_status: 'Rejected', _count: { _all: 7 } },
          { workspace_id: 'rock-profile', created_by_user_id: 'jacob', application_status: 'Rejected', _count: { _all: 3 } },
        ]),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'rock-profile', name: 'Rock workspace', resumeProfile: { name: 'rock' } },
          { id: 'hao-profile', name: 'Hao workspace', resumeProfile: { name: 'hao' } },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'richard', username: 'Richard', role: 'bidder', manager: { id: 'rock-manager', username: 'rock' } },
          { id: 'jacob', username: 'Jacob', role: 'bidder', manager: { id: 'rock-manager', username: 'rock' } },
        ]),
      },
    };
    const access = { visibleWorkspaceIds: jest.fn().mockResolvedValue(null) };
    const service = new PaymentsService(prisma as never, access as never);

    await expect(service.report(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({
      total_applied: 200,
      total_rejected: 15,
      bidders: [
        {
          bidder_id: 'richard', applied_count: 100, rejected_count: 5,
          workspaces: [{ workspace_id: 'rock-profile', applied_count: 100, rejected_count: 5 }],
        },
        {
          bidder_id: 'jacob', applied_count: 100, rejected_count: 10,
          workspaces: [
            { workspace_id: 'hao-profile', applied_count: 100, rejected_count: 7 },
            { workspace_id: 'rock-profile', applied_count: 0, rejected_count: 3 },
          ],
        },
      ],
      managers: [{
        manager_id: 'rock-manager',
        manager_username: 'rock',
        applied_count: 200,
        rejected_count: 15,
        profiles: [
          { profile_name: 'hao', bidder_username: 'Jacob', applied_count: 100, rejected_count: 7 },
          { profile_name: 'rock', bidder_username: 'Jacob', applied_count: 0, rejected_count: 3 },
          { profile_name: 'rock', bidder_username: 'Richard', applied_count: 100, rejected_count: 5 },
        ],
      }],
    });
  });

  it('shows bidder managers their own and their allocated bidders counts', async () => {
    const prisma = { jobApplication: { groupBy: jest.fn().mockResolvedValue([]) } };
    const service = new PaymentsService(prisma as never, { visibleWorkspaceIds: jest.fn() } as never);

    await expect(service.report(
      { id: 'manager-1', username: 'rock', email: 'rock@example.com', role: 'bidder_manager' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({ total_applied: 0, total_rejected: 0, bidders: [], managers: [] });

    expect(prisma.jobApplication.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdByUser: { is: {
          role: { in: ['bidder', 'bidder_manager'] },
          OR: [{ id: 'manager-1' }, { manager_user_id: 'manager-1' }],
        } },
      }),
    }));
  });

  it('includes a manager with only their own rejected applications', async () => {
    const prisma = {
      jobApplication: {
        groupBy: jest.fn().mockResolvedValue([{
          workspace_id: 'manager-profile', created_by_user_id: 'manager-1',
          application_status: 'Rejected', _count: { _all: 4 },
        }]),
      },
      workspace: { findMany: jest.fn().mockResolvedValue([{ id: 'manager-profile', name: 'Manager Profile' }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'manager-1', username: 'manager', role: 'bidder_manager' }]) },
    };
    const service = new PaymentsService(prisma as never, {} as never);

    await expect(service.report(
      { id: 'manager-1', username: 'manager', email: 'manager@example.com', role: 'bidder_manager' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({
      total_applied: 0,
      total_rejected: 4,
      managers: [{
        manager_id: 'manager-1', applied_count: 0, rejected_count: 4,
        profiles: [{ profile_name: 'Manager Profile', applied_count: 0, rejected_count: 4 }],
      }],
    });
  });

  it('returns zero counts when an admin has no visible workspaces', async () => {
    const prisma = { jobApplication: { groupBy: jest.fn() } };
    const access = { visibleWorkspaceIds: jest.fn().mockResolvedValue([]) };
    const service = new PaymentsService(prisma as never, access as never);

    await expect(service.report(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({ total_applied: 0, total_rejected: 0, bidders: [], managers: [] });
    expect(prisma.jobApplication.groupBy).not.toHaveBeenCalled();
  });

  it('rejects payment processing for a non-bidder creator', async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      jobApplication: { updateMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PaymentsService(prisma as never, {} as never);

    await expect(service.process(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { bidder_id: 'admin-2', start_date: '2026-09-01', end_date: '2026-09-07' },
    )).rejects.toThrow('Bidder does not exist');
    expect(tx.jobApplication.updateMany).not.toHaveBeenCalled();
  });

  it('scopes regular-admin history to reports they processed', async () => {
    const prisma = { paymentReport: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PaymentsService(prisma as never, {} as never);

    await service.history(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
    );

    expect(prisma.paymentReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processed_by: 'admin-1' },
    }));
  });
});
