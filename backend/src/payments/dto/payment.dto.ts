import { IsDateString, IsOptional, IsString } from 'class-validator';

export class PaymentPeriodDto {
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  bidder_id?: string;
}

export class ProcessPaymentDto {
  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;

  @IsString()
  bidder_id: string;
}
