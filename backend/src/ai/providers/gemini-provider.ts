import { AiResponseRequest, SendAiResponse } from './ai-provider';

export class GeminiProvider {
  async generate<T>(request: AiResponseRequest, send: SendAiResponse<T>): Promise<T> {
    if (request.legacyConversationId) throw new Error('Gemini requires local reference context, not a provider conversation ID');
    return send({
      contents: [{ role: 'user', parts: [
        ...(request.referenceContext ? [{ text: request.referenceContext }] : []),
        { text: request.prompt },
      ] }],
      ...(request.instructions ? { systemInstruction: { parts: [{ text: request.instructions }] } } : {}),
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        thinkingConfig: { thinkingLevel: request.reasoningEffort ?? 'medium' },
      },
    }, `/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`);
  }
}
