import OpenAI from 'openai';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import type { ConversationCreateParams } from 'openai/resources/conversations/conversations';
import type { ItemListParams } from 'openai/resources/conversations/items';

type Credentials = { apiKey: string; baseUrl: string };

/** Use SDK resources while retaining the application's stream parser and retry policy. */
export class OpenAiSdk {
  async request(path: string, body: unknown, method: string, credentials: Credentials, timeoutMs: number, requestSignal?: AbortSignal): Promise<Response> {
    if (!credentials.apiKey) throw new Error('OpenAI API key is not configured');
    const client = new OpenAI({
      apiKey: credentials.apiKey, baseURL: credentials.baseUrl,
      // Account/profile credentials must never inherit routing from environment settings.
      adminAPIKey: null, organization: null, project: null,
      defaultHeaders: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'OpenAI-Organization': null, 'OpenAI-Project': null,
      },
      maxRetries: 0, timeout: timeoutMs, logLevel: 'off',
    });
    const signal = requestSignal ?? AbortSignal.timeout(timeoutMs);
    const options = { signal };
    try {
      // asResponse() preserves HTTP headers, JSON fallbacks and terminal SSE events for the existing reader.
      if (method === 'POST' && path === '/responses') {
        return await client.responses.create(body as ResponseCreateParams, options).asResponse();
      }
      if (method === 'POST' && path === '/conversations') {
        return await client.conversations.create(body as ConversationCreateParams, options).asResponse();
      }
      const items = /^\/conversations\/([^/?]+)\/items(?:\?(.*))?$/.exec(path);
      if (method === 'GET' && items) {
        const query = new URLSearchParams(items[2]);
        const params: ItemListParams = {};
        const order = query.get('order');
        if (order === 'asc' || order === 'desc') params.order = order;
        if (query.has('limit')) params.limit = Number(query.get('limit'));
        if (query.has('after')) params.after = query.get('after')!;
        return await client.conversations.items.list(decodeURIComponent(items[1]), params, options).asResponse();
      }
      const item = /^\/conversations\/([^/?]+)\/items\/([^/?]+)$/.exec(path);
      if (method === 'DELETE' && item) {
        return await client.conversations.items.delete(decodeURIComponent(item[2]), {
          conversation_id: decodeURIComponent(item[1]),
        }, options).asResponse();
      }
      const conversation = /^\/conversations\/([^/?]+)$/.exec(path);
      if (method === 'DELETE' && conversation) {
        return await client.conversations.delete(decodeURIComponent(conversation[1]), options).asResponse();
      }
      throw new Error(`Unsupported OpenAI operation: ${method} ${path}`);
    } catch (error) {
      if (error instanceof OpenAI.APIError && error.status !== undefined) {
        const headers = new Headers(error.headers);
        headers.set('content-type', 'application/json');
        headers.delete('content-length');
        headers.delete('content-encoding');
        // Do not expose HTML/text proxy failures through the SDK's error.message.
        const payload = error.error && typeof error.error === 'object' ? { error: error.error } : {};
        return new Response(JSON.stringify(payload), { status: error.status, headers });
      }
      if (signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new DOMException('OpenAI request timed out', 'TimeoutError');
      }
      // Avoid logging the SDK's request details or nested causes, which may contain credentials.
      const message = (error instanceof Error ? error.message : 'OpenAI request failed')
        .split(credentials.apiKey).join('[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
      throw new Error(message);
    }
  }
}
