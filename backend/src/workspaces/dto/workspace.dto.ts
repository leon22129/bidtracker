import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /** The bidder who gets paid for this tab. */
  @IsString()
  owner_user_id: string;

  @IsOptional()
  @IsString()
  manager_user_id?: string;
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
  @IsString()
  manager_user_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_archived?: boolean;

  @IsOptional()
  @IsString()
  profile_name?: string;

  @IsOptional()
  @IsString()
  career_path?: string;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middle_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  county?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  zip?: string;

  @IsOptional()
  @IsString()
  linkedin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  hispanic_latino?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  ethnicity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  requires_sponsorship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  legally_authorized_us?: string;

  @IsOptional()
  @IsString()
  @IsIn(['', 'US Citizen', 'Green Card', 'Other'])
  us_work_status?: string;

  @IsOptional()
  @IsBoolean()
  update_headline?: boolean;

  @IsOptional()
  @IsBoolean()
  use_generated_role_titles?: boolean;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @IsBoolean()
  save_in_folder?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_download?: boolean;

  @IsOptional()
  @IsBoolean()
  download_jd_with_pdf?: boolean;

  @IsOptional()
  @IsBoolean()
  use_company_name?: boolean;

  @IsOptional()
  @IsBoolean()
  generate_cover_letter?: boolean;

  @IsOptional()
  @IsString()
  cover_letter_template?: string;

  @IsOptional()
  @IsArray()
  education?: Array<{ degree: string; school: string; year: string }>;

  @IsOptional()
  @IsArray()
  certifications?: Array<{ name: string; issuer: string; year: string }>;
}
