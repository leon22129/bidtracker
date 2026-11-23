import type { OpenAiUsage } from '../../resume/openai-telemetry';

export interface AiResponse {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  usage?: OpenAiUsage;
  error?: { message?: string; type?: string; code?: string; param?: string };
}

type JsonObject = Record<string, any>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI response object');
  return value as JsonObject;
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function normalizeNativeResponse(provider: 'gemini' | 'claude', value: unknown): AiResponse {
  const data = object(value);
  if (data.error) {
    const error = object(data.error);
    return { status: 'failed', error: {
      message: typeof error.message === 'string' ? error.message : 'The AI provider rejected this request',
      type: error.type ?? error.status, code: String(error.status ?? error.code ?? error.type ?? ''),
    } };
  }
  return provider === 'gemini' ? geminiResponse(data) : claudeResponse(data);
}

function geminiResponse(data: JsonObject): AiResponse {
  const candidate = data.candidates?.[0];
  const reason = data.promptFeedback?.blockReason || candidate?.finishReason;
  if (!reason) throw new Error('Gemini response has no finish reason');
  const raw = data.usageMetadata;
  const input = count(raw?.promptTokenCount);
  const thinking = count(raw?.thoughtsTokenCount);
  const output = count(raw?.candidatesTokenCount) + thinking;
  return {
    id: data.responseId,
    status: reason === 'STOP' ? 'completed' : 'incomplete',
    ...(reason === 'STOP' ? {} : { incomplete_details: { reason: reason === 'MAX_TOKENS' ? 'max_output_tokens' : reason } }),
    output_text: (candidate?.content?.parts ?? []).filter((part: JsonObject) => !part.thought && typeof part.text === 'string')
      .map((part: JsonObject) => part.text).join(''),
    ...(raw ? { usage: { input_tokens: input, input_tokens_details: { cached_tokens: count(raw.cachedContentTokenCount) },
      output_tokens: output, output_tokens_details: { reasoning_tokens: thinking }, total_tokens: input + output } } : {}),
  };
}

function claudeResponse(data: JsonObject): AiResponse {
  if (data.type !== 'message' || !data.stop_reason || !Array.isArray(data.content)) throw new Error('Invalid Claude message response');
  const raw = data.usage;
  const cached = count(raw?.cache_read_input_tokens);
  const writes = count(raw?.cache_creation_input_tokens);
  const input = count(raw?.input_tokens) + cached + writes;
  const output = count(raw?.output_tokens);
  const complete = ['end_turn', 'stop_sequence'].includes(data.stop_reason);
  return {
    id: data.id, status: complete ? 'completed' : 'incomplete',
    ...(complete ? {} : { incomplete_details: { reason: data.stop_reason === 'max_tokens' ? 'max_output_tokens' : data.stop_reason } }),
    output_text: data.content.filter((part: JsonObject) => part.type === 'text' && typeof part.text === 'string')
      .map((part: JsonObject) => part.text).join(''),
    ...(raw ? { usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached, cache_write_tokens: writes },
      output_tokens: output, total_tokens: input + output } } : {}),
  };
}

/** Assemble native SSE replies, ignoring thinking blocks and rejecting interrupted streams. */
export async function readNativeResponseStream(provider: 'gemini' | 'claude', response: Response): Promise<AiResponse> {
  if (!response.body) throw new Error('The AI streaming response had no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  let data: JsonObject = {};
  const parts: JsonObject[] = [];
  const consume = (block: string) => {
    const payload = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    const event = object(JSON.parse(payload));
    if (event.error) { data = event; terminal = true; return; }
    if (provider === 'gemini') {
      const candidate = event.candidates?.[0];
      parts.push(...(candidate?.content?.parts ?? []));
      data = { ...data, ...event, candidates: [{ ...data.candidates?.[0], ...candidate, content: { parts } }] };
      // Read through EOF: a provider may send final usage in a separate chunk.
      if (candidate?.finishReason || event.promptFeedback?.blockReason) terminal = true;
    } else {
      if (event.type === 'message_start') data = { ...event.message, content: parts };
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        parts.push({ type: 'text', text: event.content_block.text ?? '' });
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        parts.push({ type: 'text', text: event.delta.text });
      }
      if (event.type === 'message_delta') data = { ...data, ...event.delta, usage: { ...data.usage, ...event.usage } };
      if (event.type === 'message_stop') terminal = true;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) { consume(block); if (data.error) break; }
      if (data.error || (provider === 'claude' && terminal)) break;
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!terminal) throw new Error('The AI stream ended before completion');
  return normalizeNativeResponse(provider, data);
}
