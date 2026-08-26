import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSION_TYPES, PermissionType } from '../../common/constants';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /** The bidder who gets paid for this tab. */
  @IsString()
  owner_user_id: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  owner_user_id?: string;

  @IsOptional()
  @IsBoolean()
  is_archived?: boolean;
}

export class GrantPermissionDto {
  @IsString()
  user_id: string;

  @IsIn(PERMISSION_TYPES)
  permission_type: PermissionType;
}
