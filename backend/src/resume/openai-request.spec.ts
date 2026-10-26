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
    ['retry-after', new Date(Date.now() + 2000).toUTCString()],
  ])('honors the provider %s header', async (header, value) => {
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
});
