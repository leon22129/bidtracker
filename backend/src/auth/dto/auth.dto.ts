import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Password is required' })
  @MaxLength(200)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  current_password: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(200)
  new_password: string;
}

export class UpdateSlackSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  slack_webhook_url?: string | null;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() || null : value)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[UW][A-Z0-9]+$/, {
    message: 'Slack user ID must look like U012ABCDEF',
  })
  slack_user_id?: string | null;
}
