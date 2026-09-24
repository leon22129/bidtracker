import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateApplicationDto {
  @IsString()
  workspace_id: string;

  @IsOptional()
  @IsString()
  profile_id?: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  questions?: string[];

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(20000)
  job_description: string;
}

export class GenerateProfilePromptDto {
  @IsString()
  profile_id: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(50000)
  job_description?: string;

  @IsOptional()
  @IsIn(['resume', 'jobEligibility', 'applicationAnswers'])
  kind?: 'resume' | 'jobEligibility' | 'applicationAnswers';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  questions?: string[];

  @IsOptional()
  resume?: unknown;
}

export class AnswerApplicationQuestionsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  conversation_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(2000, { each: true })
  questions: string[];
}
