import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AiProvider } from './ai-catalog';
import { RESUME_PROMPT_MAX_LENGTH } from './resume-prompt';

export class UpdateAiSettingsDto {
  @IsIn(['openai', 'deepseek'])
  provider: AiProvider;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  model: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  api_key?: string;

  @IsOptional()
  @IsBoolean()
  remove_api_key?: boolean;
}

export class UpdateResumePromptDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(RESUME_PROMPT_MAX_LENGTH)
  resume_prompt: string | null;
}
