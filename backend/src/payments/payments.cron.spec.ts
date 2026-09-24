import { PaymentsCron } from './payments.cron';

describe('PaymentsCron', () => {
  const original = process.env.DISABLE_CRON;

  afterEach(() => {
    if (original === undefined) delete process.env.DISABLE_CRON;
    else process.env.DISABLE_CRON = original;
  });

  it('honors DISABLE_CRON without invoking payment settlement', async () => {
    process.env.DISABLE_CRON = 'true';
    const payments = { processPreviousWeekAutomatically: jest.fn() };
    const cron = new PaymentsCron(payments as never);

    await expect(cron.handleWeeklySettlement()).resolves.toEqual({
      skipped: true,
      reason: 'disabled',
    });
    expect(payments.processPreviousWeekAutomatically).not.toHaveBeenCalled();
  });

  it('runs automatic settlement when enabled', async () => {
    process.env.DISABLE_CRON = 'false';
    const result = { skipped: false, reports: [], total_applied: 0 };
    const payments = { processPreviousWeekAutomatically: jest.fn().mockResolvedValue(result) };
    const cron = new PaymentsCron(payments as never);

    await expect(cron.handleWeeklySettlement()).resolves.toBe(result);
    expect(payments.processPreviousWeekAutomatically).toHaveBeenCalledTimes(1);
  });
});
