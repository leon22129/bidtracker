import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PaymentPeriodDto, ProcessPaymentDto } from './dto/payment.dto';

@Controller('payments')
@UseGuards(RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('report')
  @Roles('bidder', 'bidder_manager', 'admin', 'super_admin')
  report(@CurrentUser() user: AuthUser, @Query() period: PaymentPeriodDto) {
    return this.payments.report(user, period);
  }

  @Get('history')
  @Roles('admin', 'super_admin')
  history(@CurrentUser() user: AuthUser) {
    return this.payments.history(user);
  }

  @Post('process')
  @Roles('admin', 'super_admin')
  process(@CurrentUser() user: AuthUser, @Body() period: ProcessPaymentDto) {
    return this.payments.process(user, period);
  }
}
