import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsStreaming, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BetaMessageThread } from '@anthropic-ai/sdk/lib/threads/BetaMessageThread';
import { createHash } from 'node:crypto';

export type ClaudeMessageParams = MessageCreateParamsStreaming;
export class ClaudeStreamError extends Error {}
type Credentials = { apiKey: string; baseUrl: string };
type SavedThread = { thread: BetaMessageThread; fingerprint: string; expiresAt: number; turns: number };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Short-lived SDK threads for independent application questions; the database retains the reference material. */
export class ClaudeSdk {
  private readonly threads = new Map<string, SavedThread>();
  private readonly locks = new Map<string, Promise<void>>();

  async request(params: ClaudeMessageParams, credentials: Credentials, timeoutMs: number, conversationKey?: string): Promise<Response> {
    const key = conversationKey ? fingerprint([conversationKey, credentials.baseUrl, credentials.apiKey]) : undefined;
    if (!key) return this.send(params, credentials, timeoutMs);

    // A response ID can only be continued once. Serialize overlapping requests for the same conversation.
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, pending);
    await previous;
    try { return await this.send(params, credentials, timeoutMs, key); }
    finally {
      release();
      if (this.locks.get(key) === pending) this.locks.delete(key);
    }
  }

  private async send(params: ClaudeMessageParams, credentials: Credentials, timeoutMs: number, key?: string): Promise<Response> {
    this.prune();
    const client = new Anthropic({
      apiKey: credentials.apiKey, authToken: null,
      baseURL: credentials.baseUrl.replace(/\/v1\/?$/, ''),
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
      // The application's request loop owns retries, credential redaction and usage logging.
      maxRetries: 0, timeout: timeoutMs, logLevel: 'off',
    });
    const signal = AbortSignal.timeout(timeoutMs);
    const options = { signal, timeout: timeoutMs, maxRetries: 0 };
    const { messages, stream: _stream, max_tokens, ...fixed } = params;
    const content = messages.length === 1 && Array.isArray(messages[0].content) ? messages[0].content : undefined;
    const reference = content?.[0];
    const canThread = key && reference?.type === 'text' && reference.cache_control && content!.length > 1;
    let saved: SavedThread | undefined;
    let nextMessages = messages;
    if (canThread) {
      const signature = fingerprint([fixed, reference]);
      saved = this.threads.get(key);
      if (saved?.fingerprint !== signature || saved.expiresAt <= Date.now()) saved = undefined;
      if (!saved) {
        saved = {
          thread: client.beta.messages.thread({ ...fixed, max_tokens,
            cache_control: { type: 'ephemeral' }, unsupportedRequestBehavior: 'continue_unthreaded' }),
          fingerprint: signature, expiresAt: Date.now() + 300_000, turns: 0,
        };
        this.threads.set(key, saved);
      } else {
        // The SDK sends previous_message_id and omits system/history on a continuation.
        nextMessages = [{ role: 'user', content: content!.slice(1) }] as BetaMessageParam[];
      }
    }
    const stream = saved ? saved.thread.stream(nextMessages, { max_tokens }, options)
      : client.beta.messages.stream(params, options);
    let stopped = false;
    stream.on('streamEvent', (event) => { if (event.type === 'message_stop') stopped = true; });
    try {
      const message = await stream.finalMessage();
      if (!stopped) throw new Error('The Claude stream ended before completion');
      if (saved && key) {
        saved.turns++;
        saved.expiresAt = Date.now() + 300_000;
        // Keep billed history and memory bounded. Each question is self-contained against saved reference data.
        if (!['end_turn', 'stop_sequence'].includes(message.stop_reason ?? '') || saved.turns >= 8
          || JSON.stringify(saved.thread.messages).length > 256_000) this.threads.delete(key);
      }
      return this.jsonResponse(message, 200, stream.response?.headers);
    } catch (error) {
      if (key) this.threads.delete(key);
      if (error instanceof Anthropic.APIError && error.error) {
        return this.jsonResponse(error.error, error.status ?? 200, error.headers ?? stream.response?.headers);
      }
      if (signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new DOMException('Claude request timed out', 'TimeoutError');
      }
      // SDK errors can include request details; never pass credentials or their original stack to the logger.
      const message = (error instanceof Error ? error.message : 'Claude request failed')
        .split(credentials.apiKey).join('[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
      if (stream.response?.ok) throw new ClaudeStreamError(message);
      throw new Error(message);
    } finally {
      if (!stopped) stream.abort();
    }
  }

  private jsonResponse(value: unknown, status: number, originalHeaders?: Headers): Response {
    const headers = new Headers(originalHeaders);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(value), { status, headers });
  }

  private prune() {
    for (const [key, saved] of this.threads) {
      if (!this.locks.has(key) && (saved.expiresAt <= Date.now() || this.threads.size >= 64)) this.threads.delete(key);
    }
  }
}
