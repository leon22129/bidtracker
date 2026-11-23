import { AiResponseRequest, SendAiResponse } from './ai-provider';

export class ClaudeProvider {
  async generate<T>(request: AiResponseRequest, send: SendAiResponse<T>): Promise<T> {
    if (request.legacyConversationId) throw new Error('Claude requires local reference context, not a provider conversation ID');
    return send({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      ...(request.instructions ? { system: request.instructions } : {}),
      messages: [{ role: 'user', content: [
        ...(request.referenceContext ? [{ type: 'text', text: request.referenceContext,
          cache_control: { type: 'ephemeral' } }] : []),
        { type: 'text', text: request.prompt },
      ] }],
      // Current Claude families use adaptive thinking; sampling parameters are unsupported.
      thinking: { type: 'adaptive' },
      output_config: { effort: request.reasoningEffort ?? 'medium' },
      stream: true,
    }, '/messages');
  }
}
