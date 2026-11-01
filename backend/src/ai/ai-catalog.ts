export type AiProvider = 'openai' | 'deepseek';
export interface AiModel {
  id: string;
  provider: AiProvider;
  input: number;
  cached_input: number | null;
  output: number;
  reasoning: boolean;
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
];

export const AI_CATALOG = {
  checked_at: '2026-10-30', currency: 'USD', unit: '1M tokens', models: AI_MODELS,
  sources: {
    openai: 'https://developers.openai.com/api/docs/pricing',
    deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  },
};

export function findAiModel(provider: string, model: string) {
  return AI_MODELS.find((entry) => entry.provider === provider && entry.id === model);
}
