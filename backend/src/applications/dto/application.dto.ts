import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject,
  IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import {
  APPLICATION_STATUSES, ApplicationStatus, DEFAULT_PAGE_SIZE, JOB_SOURCES, JobSource,
  MAX_PAGE_SIZE, PIPELINE_STATUSES, PipelineStatus,
} from '../../common/constants';

const toBool = ({ value }: { value: any }) =>
  value === undefined || value === '' ? undefined : value === true || value === 'true' || value === 1;

export class QueryApplicationsDto {
  @IsString()
  workspace_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  page_size?: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor_after?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor_before?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  include_total?: boolean = true;

  /** Free-text search across job title, company and URL. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsIn(APPLICATION_STATUSES, { each: true })
  application_status?: ApplicationStatus[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsIn(PIPELINE_STATUSES, { each: true })
  pipeline_status?: PipelineStatus[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsIn(JOB_SOURCES, { each: true })
  job_source?: JobSource[];

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsIn([
    'date', 'number', 'job_title', 'company_name', 'job_source',
    'application_status', 'pipeline_status', 'paid', 'interview_date', 'created_at',
  ])
  sort_by?: string = 'date';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc' = 'desc';
}

export class UpdateApplicationDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  job_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsIn(JOB_SOURCES)
  job_source?: JobSource;

  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  application_status?: ApplicationStatus;

  @IsOptional()
  @IsIn(PIPELINE_STATUSES)
  pipeline_status?: PipelineStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

export class BulkUpdatePatchDto {
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  application_status?: ApplicationStatus;

  @IsOptional()
  @IsIn(PIPELINE_STATUSES)
  pipeline_status?: PipelineStatus;

  @IsOptional()
  @IsIn(JOB_SOURCES)
  job_source?: JobSource;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  job_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string | null;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

// Keep this declaration after BulkUpdatePatchDto. Decorator metadata emits a runtime
// reference to the patch class, so placing it first causes a temporal-dead-zone error
// when Node loads the compiled CommonJS module.
export class BulkUpdateApplicationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids: string[];

  @ValidateNested()
  @Type(() => BulkUpdatePatchDto)
  patch: BulkUpdatePatchDto;
}

export class BulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids: string[];
}

/** A complete application entered directly from the workspace UI. */
export class CreateManualApplicationDto {
  @IsString()
  workspace_id: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  job_title: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company_name: string;

  @IsIn(APPLICATION_STATUSES)
  application_status: ApplicationStatus;
}

/** Compatibility payload for older resume clients that save after generation. */
export class CreateGeneratedApplicationDto {
  @IsString()
  workspace_id: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  job_title: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company_name: string;

  /** Deprecated compatibility field. The per-profile company cooldown cannot be overridden. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allow_similar_job?: boolean = false;

  /** Final, user-reviewed ResumeData used by the PDF renderer. */
  @IsOptional()
  @IsObject()
  generated_resume?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(20000)
  job_description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  conversation_id?: string;

  @IsOptional()
  @IsIn(['classic', 'modern', 'minimal', 'executive', 'academic', 'tech', 'elegant', 'bold', 'corporate'])
  resume_template?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  cover_letter_text?: string;

  @IsOptional()
  @IsIn(['classic', 'modern', 'minimal'])
  cover_letter_template?: string;
}

export class UpdatePipelineDto {
  @IsOptional()
  @IsIn(PIPELINE_STATUSES)
  pipeline_status?: PipelineStatus;

  @IsOptional()
  @IsDateString()
  interview_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  interview_note?: string | null;
}
