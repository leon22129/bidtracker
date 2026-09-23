import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBannedUrlPatternDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  pattern: string;
}
