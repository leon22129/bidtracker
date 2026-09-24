import { openAiUsageFields } from './openai-telemetry';

describe('openAiUsageFields', () => {
  const rateNames = [
    'OPENAI_INPUT_COST_PER_1M_TOKENS',
    'OPENAI_CACHED_INPUT_COST_PER_1M_TOKENS',
    'OPENAI_OUTPUT_COST_PER_1M_TOKENS',
  ] as const;
  const originalRates = Object.fromEntries(rateNames.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of rateNames) {
      const original = originalRates[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it('reports token details and separate input/output costs', () => {
    process.env.OPENAI_INPUT_COST_PER_1M_TOKENS = '10';
    process.env.OPENAI_CACHED_INPUT_COST_PER_1M_TOKENS = '2';
    process.env.OPENAI_OUTPUT_COST_PER_1M_TOKENS = '30';

    expect(openAiUsageFields({
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 200 },
      output_tokens: 500,
      output_tokens_details: { reasoning_tokens: 125 },
      total_tokens: 1500,
    })).toMatchObject({
      input_tokens: 1000,
      cached_input_tokens: 200,
      uncached_input_tokens: 800,
      output_tokens: 500,
      reasoning_output_tokens: 125,
      uncached_input_cost_usd: 0.008,
      cached_input_cost_usd: 0.0004,
      input_cost_usd: 0.0084,
      output_cost_usd: 0.015,
      estimated_total_cost_usd: 0.0234,
      pricing_rates_configured: true,
    });
  });

  it('keeps costs null when pricing has not been configured', () => {
    for (const name of rateNames) delete process.env[name];

    expect(openAiUsageFields({ input_tokens: 10, output_tokens: 5 })).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      input_cost_usd: null,
      output_cost_usd: null,
      estimated_total_cost_usd: null,
      pricing_rates_configured: false,
    });
  });
});
