export interface AiResponseRequest {
  model: string;
  prompt: string;
  referenceContext?: string;
  instructions?: string;
  maxOutputTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Only used to read legacy OpenAI sessions without locally saved context. */
  legacyConversationId?: string;
}

export type SendAiResponse<T> = (body: Record<string, unknown>) => Promise<T>;

export function responseInput(request: AiResponseRequest) {
  // Keep the reusable material in its own message, with changing questions last.
  return request.referenceContext
    ? [
      { role: 'user', content: request.referenceContext },
      { role: 'user', content: request.prompt },
    ]
    : request.prompt;
}
