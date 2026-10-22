import { Transform, Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';

export class ApplicationQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  options?: string[];
}

export class GenerateApplicationDto {
  @IsString()
  workspace_id: string;

  @IsOptional()
  @IsString()
  profile_id?: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(50000)
  job_description: string;
}

export class GenerateProfilePromptDto {
  @IsString()
  profile_id: string;

  @IsUrl({ require_protocol: true })
  url: string;

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
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ApplicationQuestionDto)
  questions?: ApplicationQuestionDto[];

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
  @ValidateNested({ each: true })
  @Type(() => ApplicationQuestionDto)
  questions: ApplicationQuestionDto[];
}
