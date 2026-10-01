import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsCron } from './payments.cron';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsCron],
  exports: [PaymentsService],
})
export class PaymentsModule {}
