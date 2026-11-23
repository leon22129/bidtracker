export type AiProvider = 'openai' | 'deepseek' | 'gemini' | 'claude';
export interface AiPrices { input: number; cached_input: number | null; output: number; cache_write?: number }
export interface AiModel {
  id: string;
  provider: AiProvider;
  input: number;
  cached_input: number | null;
  output: number;
  max_output_tokens?: number;
  context_window?: number;
  cache_write?: number;
  long_context?: AiPrices & { above_tokens: number };
  price_change?: AiPrices & { effective_at: string };
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
  providers: Record<AiProvider, { name: string; base_url: string; target_url: string; default_model: string;
    key_url: string; checked_at: string; notes: string }>;
}
