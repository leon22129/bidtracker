import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

function cronDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.DISABLE_CRON ?? '').trim().toLowerCase(),
  );
}

@Injectable()
export class PaymentsCron {
  private readonly logger = new Logger(PaymentsCron.name);

  constructor(private readonly payments: PaymentsService) {}

  @Cron('5 0 * * 1', {
    name: 'weekly-payment-settlement',
    timeZone: 'UTC',
  })
  async handleWeeklySettlement() {
    if (cronDisabled()) {
      this.logger.log('Weekly payment settlement skipped because DISABLE_CRON is enabled');
      return { skipped: true, reason: 'disabled' };
    }

    const result = await this.payments.processPreviousWeekAutomatically();
    if (result.skipped) {
      this.logger.log('Weekly payment settlement is already running on another backend');
    } else {
      this.logger.log(
        `Weekly payment settlement completed: ${result.reports.length} report(s), ` +
          `${result.total_applied} application(s)`,
      );
    }
    return result;
  }
}
