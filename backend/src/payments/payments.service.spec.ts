import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  it('returns the existing exact-period report when payment was already processed', async () => {
    const existing = {
      id: 'report-1', bidder_id: 'bidder-1', start_date: new Date('2026-09-01'),
      end_date: new Date('2026-09-07'), applied_count: 4,
      processed_by: 'admin-1', processed_at: new Date('2026-09-08'),
    };
    const tx = {
      jobApplication: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      paymentReport: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PaymentsService(prisma as never);

    await expect(service.process(
      { id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      { bidder_id: 'bidder-1', start_date: '2026-09-01', end_date: '2026-09-07' },
    )).resolves.toMatchObject({ id: 'report-1', already_processed: true });

    expect(tx.paymentReport.create).not.toHaveBeenCalled();
    expect(tx.jobApplication.updateMany).not.toHaveBeenCalled();
  });
});
