export const AI_PROVIDERS = {
  openai: {
    name: 'OpenAI', base_url: 'https://api.openai.com/v1',
    target_url: 'https://api.openai.com/v1/responses', default_model: 'gpt-6.1-sol',
    key_url: 'https://platform.openai.com/api-keys', checked_at: '2026-10-30', notes: '',
  },
  deepseek: {
    name: 'DeepSeek', base_url: 'https://api.deepseek.com',
    target_url: 'https://api.deepseek.com/responses', default_model: 'deepseek-flash',
    key_url: 'https://platform.deepseek.com/api_keys', checked_at: '2026-10-30', notes: '',
  },
  gemini: {
    name: 'Gemini (Google)', base_url: 'https://generativelanguage.googleapis.com/v1beta',
    target_url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse',
    default_model: 'gemini-4-hydrogen', key_url: 'https://aistudio.google.com/api-keys', checked_at: '2026-11-23',
    notes: 'Use a Gemini Developer API key. Prices are paid-tier rates and include thinking tokens. '
      + 'Free-tier content may be used to improve Google products; use a paid project for candidate data. '
      + 'Cache discounts depend on implicit cache hits.',
  },
  claude: {
    name: 'Claude (Anthropic)', base_url: 'https://api.anthropic.com/v1',
    target_url: 'https://api.anthropic.com/v1/messages', default_model: 'claude-sonnet-5-5',
    key_url: 'https://platform.claude.com/settings/keys', checked_at: '2026-11-23',
    notes: 'Use an Anthropic API key with API credits; a Claude chat subscription is separate. '
      + 'Thinking tokens are billed as output. Reusable reference context uses a 5-minute prompt cache; '
      + 'cache writes cost extra and hits depend on prompt length and reuse.',
  },
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export interface AiPrices { input: number; cached_input: number | null; output: number; cache_write?: number }
export interface AiModel {
  id: string;
  provider: AiProvider;
  input: number;
  cached_input: number | null;
  output: number;
  reasoning: boolean;
  max_output_tokens?: number;
  context_window?: number;
  cache_write?: number;
  long_context?: AiPrices & { above_tokens: number };
  price_change?: AiPrices & { effective_at: string };
  deprecated?: boolean;
  off_peak?: { input: number; cached_input: number; output: number };
}

// USD / 1M text tokens, standard processing and short context. Reviewed 2026-10-30.
// Sources: https://developers.openai.com/api/docs/pricing and each /models/{id} page;
// https://api-docs.deepseek.com/quick_start/pricing/ . List model families without dated snapshots
// or duplicate aliases. Audio/image/embedding/moderation models cannot perform this workflow.
const openai = (id: string, input: number, cached_input: number | null, output: number,
  reasoning = true, deprecated = false): AiModel =>
  ({ id, provider: 'openai', input, cached_input, output, reasoning, deprecated });

export const AI_MODELS: AiModel[] = [
  openai('gpt-6.1-sol', 2, 0.1, 10),
  openai('gpt-6-astra', 10, 1, 50),
  openai('gpt-6.1-terra', 1, 0.05, 5),
  openai('gpt-6-luna', 0.1, 0.01, 0.5),
  openai('gpt-6-sol', 2, 0.2, 10),
  openai('gpt-5.6-sol', 4, 0.4, 20),
  openai('gpt-5.6-terra', 2, 0.2, 12),
  openai('gpt-5.6-luna', 0.2, 0.02, 1.2),
  openai('gpt-5.5', 5, 0.5, 30),
  openai('gpt-5.5-pro', 30, null, 180),
  openai('gpt-5.4', 2.5, 0.25, 15),
  openai('gpt-5.4-pro', 30, null, 180),
  openai('gpt-5.4-mini', 0.75, 0.075, 4.5),
  openai('gpt-5.2', 1.75, 0.175, 14),
  openai('gpt-5.2-pro', 21, null, 168),
  openai('chat-latest', 5, 0.5, 30, false),
  openai('gpt-5.4-nano', 0.2, 0.02, 1.25, true, true),
  openai('gpt-5.3-codex', 1.75, 0.175, 14, true, true),
  openai('gpt-5.1', 1.25, 0.125, 10, true, true),
  openai('gpt-5', 1.25, 0.125, 10, true, true),
  openai('gpt-5-mini', 0.25, 0.025, 2, true, true),
  openai('gpt-5-nano', 0.05, 0.005, 0.4, true, true),
  openai('gpt-5-pro', 15, null, 120, true, true),
  openai('o3', 2, 0.5, 8, true, true),
  openai('o3-pro', 20, null, 80, true, true),
  openai('gpt-4.1', 2, 0.5, 8, false, true),
  openai('gpt-4.1-mini', 0.4, 0.1, 1.6, false, true),
  openai('gpt-4o', 2.5, 1.25, 10, false, true),
  openai('gpt-4o-mini', 0.15, 0.075, 0.6, false, true),
  { id: 'deepseek-flash', provider: 'deepseek', input: 0.3, cached_input: 0.006, output: 1.2,
    reasoning: true, off_peak: { input: 0.15, cached_input: 0.003, output: 0.6 } },
  { id: 'deepseek-v4-pro', provider: 'deepseek', input: 1.32, cached_input: 0.044, output: 3.96,
    reasoning: true, off_peak: { input: 0.66, cached_input: 0.022, output: 1.98 } },
  // Current publicly available families. Native APIs; synchronous output limits (no long-decode beta).
  // https://aistudio.google.com/docs/models and /docs/pricing, checked 2026-11-23.
  ...[
    { id: 'gemini-4-hydrogen', input: 1.5, cached_input: 0.075, output: 7.5 },
    { id: 'gemini-4-carbon', input: 2, cached_input: 0.1, output: 10,
      price_change: { effective_at: '2026-12-01', input: 4, cached_input: 0.2, output: 20 } },
    { id: 'gemini-4-neon', input: 3, cached_input: 0.15, output: 15 },
    { id: 'gemini-4-argon', input: 2, cached_input: 0.1, output: 10,
      price_change: { effective_at: '2026-12-01', input: 4, cached_input: 0.2, output: 20 } },
  ].map((model): AiModel => ({ ...model, provider: 'gemini', reasoning: true,
    context_window: 1048576, max_output_tokens: 65536 })),
  // https://platform.claude.com/docs/en/models/overview and /en/about-claude/pricing.
  ...[
    { id: 'claude-sonnet-5-5', input: 2, cached_input: 0.1, output: 10, cache_write: 2.5 },
    { id: 'claude-haiku-5-5', input: 0.1, cached_input: 0.01, output: 0.5, cache_write: 0.125,
      long_context: { above_tokens: 100000, input: 0.5, cached_input: 0.05, output: 2.5, cache_write: 0.625 } },
    { id: 'claude-opus-5-5', input: 4, cached_input: 0.2, output: 20, cache_write: 5 },
    { id: 'claude-fable-5-2', input: 8, cached_input: 0.2, output: 40, cache_write: 10 },
  ].map((model): AiModel => ({ ...model, provider: 'claude', reasoning: true,
    context_window: 1000000, max_output_tokens: 128000 })),
];

export const AI_CATALOG = {
  checked_at: '2026-11-23', currency: 'USD', unit: '1M tokens', models: AI_MODELS,
  providers: AI_PROVIDERS,
  sources: {
    openai: 'https://developers.openai.com/api/docs/pricing',
    deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
    gemini: 'https://aistudio.google.com/docs/pricing',
    claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
};

export function findAiModel(provider: string, model: string) {
  const entry = AI_MODELS.find((entry) => entry.provider === provider && entry.id === model);
  return entry && currentModelPrices(entry);
}

export function currentModelPrices(model: AiModel, now = new Date()): AiModel {
  return model.price_change && now.toISOString().slice(0, 10) >= model.price_change.effective_at
    ? { ...model, ...model.price_change } : { ...model };
}
