export interface OpenAiUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
}

function rate(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function usd(tokens: number, usdPerMillionTokens: number | null): number | null {
  if (usdPerMillionTokens === null) return null;
  return Number(((tokens * usdPerMillionTokens) / 1_000_000).toFixed(8));
}

/**
 * OpenAI returns token counts but not dollar costs. Rates are deliberately supplied through the
 * environment so model price changes do not silently make the logs inaccurate.
 */
export function openAiUsageFields(usage?: OpenAiUsage): Record<string, unknown> {
  if (!usage) return { usage_available: false };

  const inputTokens = usage.input_tokens ?? 0;
  const cachedInputTokens = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, inputTokens);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = usage.output_tokens ?? 0;
  const inputRate = rate('OPENAI_INPUT_COST_PER_1M_TOKENS');
  const cachedInputRate = rate('OPENAI_CACHED_INPUT_COST_PER_1M_TOKENS') ?? inputRate;
  const outputRate = rate('OPENAI_OUTPUT_COST_PER_1M_TOKENS');
  const uncachedInputCost = usd(uncachedInputTokens, inputRate);
  const cachedInputCost = usd(cachedInputTokens, cachedInputRate);
  const outputCost = usd(outputTokens, outputRate);
  const inputCost = uncachedInputCost === null || cachedInputCost === null
    ? null
    : Number((uncachedInputCost + cachedInputCost).toFixed(8));
  const totalCost = inputCost === null || outputCost === null
    ? null
    : Number((inputCost + outputCost).toFixed(8));

  return {
    usage_available: true,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    uncached_input_tokens: uncachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    uncached_input_cost_usd: uncachedInputCost,
    cached_input_cost_usd: cachedInputCost,
    input_cost_usd: inputCost,
    output_cost_usd: outputCost,
    estimated_total_cost_usd: totalCost,
    pricing_rates_configured: inputRate !== null && outputRate !== null,
    input_rate_usd_per_1m_tokens: inputRate,
    cached_input_rate_usd_per_1m_tokens: cachedInputRate,
    output_rate_usd_per_1m_tokens: outputRate,
  };
}
