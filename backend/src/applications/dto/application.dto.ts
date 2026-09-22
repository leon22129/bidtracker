import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional,
  IsString, IsUrl, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import {
  APPLICATION_STATUSES, ApplicationStatus, DEFAULT_PAGE_SIZE, JOB_SOURCES, JobSource,
  MAX_PAGE_SIZE, MAX_ROWS_PER_INGEST, PIPELINE_STATUSES, PipelineStatus,
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
    'application_status', 'pipeline_status', 'paid', 'created_at',
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

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resume_link?: string | null;
}

export class BulkUpdateApplicationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids: string[];

  @ValidateNested()
  @Type(() => UpdateApplicationDto)
  patch: UpdateApplicationDto;
}

export class BulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids: string[];
}

export class BulkPaidDto extends BulkIdsDto {
  @IsBoolean()
  paid: boolean;
}

/** Manual URL paste: one textarea, one date, N lines -> N applications. */
export class CreateFromUrlsDto {
  @IsString()
  workspace_id: string;

  @IsDateString()
  date: string;

  @IsString()
  @MaxLength(MAX_ROWS_PER_INGEST * 500)
  urls: string;

  /** Set false to skip network enrichment (faster, leaves title/company blank). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  enrich?: boolean = true;
}

/** A reviewed application returned by resume generation and explicitly saved by the extension. */
export class CreateGeneratedApplicationDto {
  @IsString()
  workspace_id: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  job_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string | null;
}

export class UpdatePipelineDto {
  @IsOptional()
  @IsIn(PIPELINE_STATUSES)
  pipeline_status?: PipelineStatus;

}
