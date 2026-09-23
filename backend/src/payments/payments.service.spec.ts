import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
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
