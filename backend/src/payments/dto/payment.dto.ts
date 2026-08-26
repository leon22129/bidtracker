import { IsDateString, IsOptional, IsString } from 'class-validator';

export class PaymentPeriodDto {
  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @IsOptional()
  @IsString()
  bidder_id?: string;
}