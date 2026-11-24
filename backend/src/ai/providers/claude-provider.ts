import { AiResponseRequest, SendAiResponse } from './ai-provider';

export class ClaudeProvider {
  async generate<T>(request: AiResponseRequest, send: SendAiResponse<T>): Promise<T> {
    if (request.legacyConversationId) throw new Error('Claude requires local reference context, not a provider conversation ID');
    const effort = request.reasoningEffort ?? 'medium';
    // Haiku 4.5 supports extended thinking only; reserve at least half the output for the answer.
    // https://platform.claude.com/docs/en/build-with-claude/extended-thinking
    const budget = Math.min({ low: 1024, medium: 4096, high: 8192 }[effort], Math.floor(request.maxOutputTokens / 2));
    const thinking = request.model.startsWith('claude-haiku-4-5')
      ? { thinking: budget >= 1024 ? { type: 'enabled', budget_tokens: budget } : { type: 'disabled' } }
      : { thinking: { type: 'adaptive' }, output_config: { effort } };
    return send({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      ...(request.instructions ? { system: request.instructions } : {}),
      messages: [{ role: 'user', content: [
        ...(request.referenceContext ? [{ type: 'text', text: request.referenceContext,
          cache_control: { type: 'ephemeral' } }] : []),
        { type: 'text', text: request.prompt },
      ] }],
      ...thinking,
      stream: true,
    }, '/messages');
  }
}
