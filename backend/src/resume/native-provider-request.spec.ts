import { ApplicationGenerationService } from './resume.service';
import { AI_MODELS, AI_PROVIDERS, currentModelPrices } from '../ai/ai-catalog';
import { normalizeNativeResponse, readNativeResponseStream } from '../ai/providers/native-response';
import { combineOpenAiUsage, openAiUsageFields } from './openai-telemetry';

describe('Gemini and Claude generation', () => {
  let service: any;
  let fetchMock: jest.SpyInstance;
  const config = (provider: 'gemini' | 'claude', model = AI_PROVIDERS[provider].default_model as string) => ({
    provider, model, baseUrl: AI_PROVIDERS[provider].base_url, apiKey: `${provider}-secret`,
  });
  const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
  const gemini = (text = 'Answer', reason = 'STOP') => ({ responseId: 'g1',
    candidates: [{ content: { parts: [{ text: 'Private thought', thought: true }, { text }] }, finishReason: reason }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 15, thoughtsTokenCount: 5 },
  });
  const claude = (text = 'Answer', reason = 'end_turn') => ({ id: 'c1', type: 'message', stop_reason: reason,
    content: [{ type: 'thinking', thinking: 'Private thought' }, { type: 'text', text }],
    usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 15 },
  });
  const reply = (provider: 'gemini' | 'claude') => provider === 'gemini' ? gemini() : claude();
  const sse = (events: unknown[], interrupted = false) => {
    const bytes = new TextEncoder().encode(events.map((data) => `data: ${JSON.stringify(data)}\r\n\r\n`).join(''));
    return new Response(new ReadableStream({ start(controller) {
      // Split inside JSON, CRLF boundaries and multi-byte UTF-8 characters.
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      if (interrupted) controller.error(new Error('connection closed')); else controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  beforeEach(() => {
    jest.useFakeTimers();
    service = new ApplicationGenerationService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it.each([
    config('gemini'), config('gemini', 'gemini-3.8-flash'),
    config('claude'), config('claude', 'claude-sonnet-5'), config('claude', 'claude-sonnet-4-6'),
  ])('routes $model with native authentication, instructions and bounded local context', async (settings) => {
    const { provider } = settings;
    fetchMock.mockResolvedValueOnce(json(reply(provider)));
    await expect(service.generateText('Why this role?', { config: settings, referenceContext: 'Resume and job',
      instructions: 'Return JSON', reasoningEffort: 'low', maxOutputTokens: 4096 })).resolves.toBe('Answer');
    const [url, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe(AI_PROVIDERS[provider].target_url.replace('{model}', settings.model));
    expect(request.headers.Authorization).toBeUndefined();
    for (const field of ['conversation', 'previous_response_id', 'store', 'input', 'reasoning']) expect(body).not.toHaveProperty(field);
    if (provider === 'gemini') {
      expect(request.headers['x-goog-api-key']).toBe('gemini-secret');
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Resume and job' }, { text: 'Why this role?' }] }]);
      expect(body.systemInstruction.parts).toEqual([{ text: 'Return JSON' }]);
      expect(body.generationConfig).toEqual({ maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } });
      expect(body).not.toHaveProperty('stream');
    } else {
      expect(body.model).toBe(settings.model);
      expect(request.headers['x-api-key']).toBe('claude-secret');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(body.messages[0].content).toEqual([{ type: 'text', text: 'Resume and job', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Why this role?' }]);
      expect(body).toMatchObject({ system: 'Return JSON', max_tokens: 4096, output_config: { effort: 'low' }, thinking: { type: 'adaptive' }, stream: true });
      expect(body).not.toHaveProperty('temperature');
    }
    expect(JSON.stringify(service.logger.log.mock.calls)).not.toContain('Private thought');
  });

  it.each([
    { effort: 'low', maxTokens: 4096, budget: 1024 },
    { effort: 'medium', maxTokens: 16000, budget: 4096 },
    { effort: 'high', maxTokens: 20000, budget: 8192 },
    { effort: undefined, maxTokens: 16000, budget: 4096 },
    { effort: 'high', maxTokens: 2048, budget: 1024 },
    { effort: 'low', maxTokens: 1024, budget: null },
  ])('uses supported Haiku 4.5 thinking with $effort effort and $maxTokens output tokens', async ({ effort, maxTokens, budget }) => {
    fetchMock.mockResolvedValueOnce(json(claude()));
    await expect(service.generateText('Answer', { config: config('claude', 'claude-haiku-4-5-20251001'),
      reasoningEffort: effort, maxOutputTokens: maxTokens })).resolves.toBe('Answer');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, stream: true });
    expect(body.thinking).toEqual(budget === null ? { type: 'disabled' } : { type: 'enabled', budget_tokens: budget });
    expect(body).not.toHaveProperty('output_config');
    expect(body).not.toHaveProperty('temperature');
  });

  it.each(AI_MODELS.filter((m) => m.provider === 'gemini' || m.provider === 'claude'))('caps output for $id', async (model) => {
    const provider = model.provider as 'gemini' | 'claude';
    fetchMock.mockResolvedValueOnce(json(reply(provider)));
    await service.generateText('Resume', { config: config(provider, model.id), maxOutputTokens: 999999 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(provider === 'gemini' ? body.generationConfig.maxOutputTokens : body.max_tokens).toBe(model.max_output_tokens);
  });

  it('reads Gemini chunks and final usage without including thought text', async () => {
    fetchMock.mockResolvedValueOnce(sse([
      { candidates: [{ content: { parts: [{ text: 'secret', thought: true }, { text: 'Café ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] },
      { usageMetadata: gemini().usageMetadata },
    ]));
    const onUsage = jest.fn();
    await expect(service.generateText('Question', { config: config('gemini'), onUsage })).resolves.toBe('Café answer');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 100, output_tokens: 20, total_tokens: 120,
      output_tokens_details: { reasoning_tokens: 5 } }));
  });

  it('reads Claude text deltas, terminal status and cumulative usage', async () => {
    fetchMock.mockResolvedValueOnce(sse([
      { type: 'message_start', message: { ...claude(''), stop_reason: null, content: [], usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: 'content_block_start', content_block: { type: 'thinking' } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'secret' } },
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Café answer' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } },
      { type: 'message_stop' },
    ]));
    const onUsage = jest.fn();
    await expect(service.generateText('Question', { config: config('claude'), onUsage })).resolves.toBe('Café answer');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 100, output_tokens: 15, total_tokens: 115 }));
  });

  it.each(['gemini', 'claude'] as const)('rejects interrupted %s streams', async (provider) => {
    const event = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'partial' }] } }] }
      : { type: 'message_start', message: { ...claude('partial'), stop_reason: null } };
    await expect(readNativeResponseStream(provider, sse([event]))).rejects.toThrow('before completion');
  });

  it.each(['gemini', 'claude'] as const)('retries %s output exhaustion with a larger budget', async (provider) => {
    fetchMock.mockResolvedValueOnce(json(provider === 'gemini' ? gemini('partial', 'MAX_TOKENS') : claude('partial', 'max_tokens')))
      .mockResolvedValueOnce(json(reply(provider)));
    await expect(service.generateText('Resume', { config: config(provider), maxOutputTokens: 2000 })).resolves.toBe('Answer');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(provider === 'gemini' ? body.generationConfig.maxOutputTokens : body.max_tokens).toBe(4000);
  });

  it.each(['gemini', 'claude'] as const)('does not accept or retry blocked %s content', async (provider) => {
    fetchMock.mockResolvedValueOnce(json(provider === 'gemini' ? { promptFeedback: { blockReason: 'SAFETY' } } : claude('partial', 'refusal')));
    await expect(service.generateText('Question', { config: config(provider) })).rejects.toThrow('could not complete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['gemini', 'claude'] as const)('honors %s rate limit retry headers', async (provider) => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'Slow down', type: 'rate_limit_error', status: 'RESOURCE_EXHAUSTED' } }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json(reply(provider)));
    const result = service.generateText('Question', { config: config(provider) });
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('Answer');
  });

  it('retries a Claude overload delivered inside an HTTP 200 stream', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]))
      .mockResolvedValueOnce(json(claude()));
    const result = service.generateText('Question', { config: config('claude') });
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe('Answer');
  });

  it.each(['gemini', 'claude'] as const)('redacts %s credentials and never retries authentication failures', async (provider) => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: `Invalid ${provider}-secret`, type: 'authentication_error' } }, 401));
    await expect(service.generateText('Question', { config: config(provider) })).rejects.toThrow('Invalid [redacted]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(service.logger.error.mock.calls)).not.toContain(`${provider}-secret`);
  });

  it.each(['gemini', 'claude'] as const)('rejects missing %s keys and legacy provider IDs without sending requests', async (provider) => {
    await expect(service.generateText('Question', { config: { ...config(provider), apiKey: '' } })).rejects.toThrow('configure an API key');
    await expect(service.generateText('Question', { config: config(provider), conversationId: 'conv_old' })).rejects.toThrow('local reference context');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accounts for Claude cache writes and cache hits separately', () => {
    const usage = normalizeNativeResponse('claude', claude()).usage!;
    expect(usage.input_tokens).toBe(150);
    expect(openAiUsageFields(usage, service.usageRates(config('claude'), usage))).toMatchObject({
      uncached_input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 30,
      input_cost_usd: 0.000277, output_cost_usd: 0.00015, estimated_total_cost_usd: 0.000427,
    });
    expect(combineOpenAiUsage([usage, usage])?.input_tokens_details?.cache_write_tokens).toBe(60);
  });

  it('uses Haiku long-context rates only above the threshold, including cached input', () => {
    expect(service.usageRates(config('claude', 'claude-haiku-5-5'), { input_tokens: 100000 }).input).toBe(0.1);
    const usage = normalizeNativeResponse('claude', { ...claude(), usage: { input_tokens: 1, cache_read_input_tokens: 100000, output_tokens: 1 } }).usage;
    expect(service.usageRates(config('claude', 'claude-haiku-5-5'), usage)).toMatchObject({ input: 0.5, output: 2.5, cached_input: 0.05, cache_write: 0.625 });
  });

  it('prices each call separately when workflow totals cross a prompt-length tier', () => {
    const settings = config('claude', 'claude-haiku-5-5');
    const smallCalls = combineOpenAiUsage([{ input_tokens: 60000, output_tokens: 1000 }, { input_tokens: 60000, output_tokens: 1000 }]);
    expect(openAiUsageFields(smallCalls, service.usageRates(settings, smallCalls)).estimated_total_cost_usd).toBe(0.013);
    const mixedCalls = combineOpenAiUsage([{ input_tokens: 120000, output_tokens: 1000 }, { input_tokens: 10000, output_tokens: 1000 }]);
    expect(openAiUsageFields(mixedCalls, service.usageRates(settings, mixedCalls)).estimated_total_cost_usd).toBe(0.064);
  });

  it.each([
    { id: 'gemini-4-carbon', date: '2026-12-01', input: 2, rates: { input: 4, output: 20, cached_input: 0.2 } },
    { id: 'gemini-4-argon', date: '2026-12-01', input: 2, rates: { input: 4, output: 20, cached_input: 0.2 } },
    { id: 'gemini-3.8-flash', date: '2027-01-01', input: 0.75, rates: { input: 1.5, output: 7.5, cached_input: 0.15 } },
  ])('changes $id promotional prices on the published date', ({ id, date, input, rates }) => {
    const model = AI_MODELS.find((m) => m.id === id)!;
    const effectiveAt = new Date(`${date}T00:00:00Z`);
    expect(currentModelPrices(model, new Date(effectiveAt.getTime() - 1)).input).toBe(input);
    expect(currentModelPrices(model, effectiveAt)).toMatchObject(rates);
    expect(model.input).toBe(input);
  });
});
