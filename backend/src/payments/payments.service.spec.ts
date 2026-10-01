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
      where: expect.objectContaining({ created_by_user_id: 'bidder-1', paid: false }),
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
      where: expect.objectContaining({ created_by_user_id: 'bidder-1' }),
    }));
  });

  it('groups exact visible workspaces by immutable application creator', async () => {
    const prisma = {
      jobApplication: {
        groupBy: jest.fn().mockResolvedValue([
          {
            workspace_id: 'workspace-visible',
            created_by_user_id: 'bidder-original',
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
      total_applied: 3,
      bidders: [{ bidder_id: 'bidder-1', applied_count: 3 }],
    });

    expect(access.visibleWorkspaceIds).not.toHaveBeenCalled();
    expect(prisma.jobApplication.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ created_by_user_id: 'bidder-1' }),
    }));
    expect(prisma.jobApplication.groupBy.mock.calls[0][0].where).not.toHaveProperty('workspace_id');
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
