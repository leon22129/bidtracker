import {
  IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';
import { ROLES, Role } from '../../common/constants';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Username may only contain letters, numbers, dot, dash and underscore',
  })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password: string;

  @IsIn(ROLES)
  role: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  new_password: string;
}
