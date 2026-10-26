import { ApplicationGenerationService } from './resume.service';

describe('OpenAI request recovery', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  let service: ApplicationGenerationService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.useFakeTimers();
    service = new ApplicationGenerationService(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
    new Response(JSON.stringify(data), { status, headers });
  const request = (target: ApplicationGenerationService) =>
    (target as any).openAiRequest('/conversations', { items: [] }, 'POST', 'conversation_create');
  const stream = (data: unknown, type: string) => new Response(
    `event: ${type}\ndata: ${JSON.stringify({ type, response: data })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );

  it('recovers from an incomplete response by increasing the output budget', async () => {
    fetchMock.mockResolvedValueOnce(stream({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'response.incomplete'))
      .mockResolvedValueOnce(stream({ status: 'completed', output_text: '{"company_name":"Acme","job_title":"Engineer"}' }, 'response.completed'));
    await expect((service as any).openAi('Extract metadata', { maxOutputTokens: 2048, reasoningEffort: 'low' }))
      .resolves.toContain('Acme');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_output_tokens).toBe(4096);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning.effort).toBe('low');
    expect((service as any).logger.error).not.toHaveBeenCalled();
  });

  it('reports an exhausted output limit without mislabeling it as a connection failure', async () => {
    fetchMock.mockImplementation(async () => stream({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'response.incomplete'));
    await expect((service as any).openAi('Resume prompt')).rejects.toThrow('output limit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a response that ended incomplete for another reason', async () => {
    fetchMock.mockResolvedValueOnce(stream({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'response.incomplete'));
    await expect((service as any).openAi('Resume prompt')).rejects.toThrow('could not complete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a JSON response when an upstream service does not stream', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output_text: 'Generated resume' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect((service as any).openAi('Resume prompt')).resolves.toBe('Generated resume');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a completed stream event without waiting for the connection to close', async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"status":"completed","output_text":"Generated resume"}}\n\n'));
    } });
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    await expect((service as any).openAi('Resume prompt')).resolves.toBe('Generated resume');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves top-level error details from a streaming error event', async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"type":"error","code":"invalid_api_key","message":"Invalid provider credential"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));
    await expect((service as any).openAi('Resume prompt')).rejects.toThrow('Invalid provider credential');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives company extraction enough output space for reasoning and JSON', async () => {
    const openAi = jest.spyOn(service as any, 'openAi').mockResolvedValue('{"company_name":"Acme","job_title":"Engineer"}');
    await expect((service as any).extractJobIdentity('Acme is hiring an engineer.')).resolves.toMatchObject({ company_name: 'Acme' });
    expect(openAi).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxOutputTokens: 2048, reasoningEffort: 'low' }));
  });

  it('recovers from the logged connection-reset then non-JSON 503 sequence', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('<html>Service Unavailable</html>', { status: 503 }))
      .mockResolvedValueOnce(json({ id: 'conv_recovered' }));

    const result = expect(request(service)).resolves.toEqual({ id: 'conv_recovered' });
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((service as any).logger.warn).toHaveBeenCalledTimes(2);
    expect((service as any).logger.error).not.toHaveBeenCalled();
  });

  it.each([408, 409, 429, 500, 502, 503, 504])('recovers from a temporary HTTP %s error', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'Temporary failure' } }, status))
      .mockResolvedValueOnce(json({ id: 'conv_recovered' }));
    const result = expect(request(service)).resolves.toEqual({ id: 'conv_recovered' });
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['retry-after', '2'],
    ['retry-after-ms', '2000'],
    ['retry-after', 'http-date'],
  ])('honors the provider %s header', async (header, value) => {
    jest.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
    if (value === 'http-date') value = new Date(Date.now() + 2000).toUTCString();
    fetchMock.mockResolvedValueOnce(json({}, 503, { [header]: value }))
      .mockResolvedValueOnce(json({ id: 'conv_recovered' }));
    const result = expect(request(service)).resolves.toEqual({ id: 'conv_recovered' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after three attempts and reports the upstream status without exposing HTML', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>upstream failure</html>', { status: 503 }));
    const result = expect(request(service)).rejects.toThrow(
      'The AI provider is temporarily unavailable (HTTP 503). Please try again.',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404])('does not retry a permanent HTTP %s error', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'Fix the request configuration' } }, status));
    await expect(request(service)).rejects.toThrow('Fix the request configuration');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry quota errors', async () => {
    fetchMock.mockResolvedValueOnce(json({
      error: { message: 'Quota exceeded', code: 'insufficient_quota' },
    }, 429));
    await expect(request(service)).rejects.toThrow('Quota exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry before a provider cooldown longer than the retry budget', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503, { 'retry-after': '120' }));
    await expect(request(service)).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed response delivered over a successful HTTP stream', async () => {
    const stream = (response: unknown, type: string) => new Response(
      `data: ${JSON.stringify({ type, response })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
    fetchMock.mockResolvedValueOnce(stream({
      status: 'failed', error: { code: 'server_error', message: 'Temporary stream failure' },
    }, 'response.failed')).mockResolvedValueOnce(stream({
      status: 'completed', output_text: 'Generated resume',
    }, 'response.completed'));

    const result = expect((service as any).openAi('Resume prompt')).resolves.toBe('Generated resume');
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a malformed stream as a response error instead of a connectivity failure', async () => {
    fetchMock.mockImplementation(async () => new Response('data: invalid-json\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const result = expect((service as any).openAi('Resume prompt')).rejects.toThrow('unreadable response');
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse((service as any).logger.error.mock.calls[0][0]).failure_type).toBe('protocol');
  });

  it('keeps truncated transport failures distinct from an unreachable provider', async () => {
    fetchMock.mockImplementation(async () => new Response('data: {"type":"response.created","response":{"id":"resp_partial"}}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const result = expect((service as any).openAi('Resume prompt')).rejects.toThrow('interrupted its response');
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    expect(JSON.parse((service as any).logger.error.mock.calls[0][0]).failure_type).toBe('stream');
  });
});
