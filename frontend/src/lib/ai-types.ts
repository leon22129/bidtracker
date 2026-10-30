export type AiProvider = 'openai' | 'deepseek';
export interface AiModel {
  id: string;
  provider: AiProvider;
  input: number;
  cached_input: number | null;
  output: number;
  deprecated?: boolean;
  off_peak?: { input: number; cached_input: number; output: number };
}
export interface AiSettings {
  provider: AiProvider;
  model: string;
  keys: Record<AiProvider, { saved: boolean; configured: boolean }>;
  resume_prompt: string;
  default_resume_prompt: string;
  resume_prompt_customized: boolean;
  resume_prompt_variables: string[];
  resume_prompt_max_length: number;
  checked_at: string;
  models: AiModel[];
  sources: Record<AiProvider, string>;
}
