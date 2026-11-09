import { findAiModel } from '../ai-catalog';
import { AiResponseRequest, responseInput, SendAiResponse } from './ai-provider';

export class OpenAiProvider {
  async generate<T>(request: AiResponseRequest, send: SendAiResponse<T>): Promise<T> {
    const model = findAiModel('openai', request.model);
    const effort = request.model === 'gpt-5-pro' ? 'high'
      : request.model.includes('-pro') && request.reasoningEffort === 'low' ? 'medium'
      : request.reasoningEffort ?? 'medium';
    return send({
      model: request.model,
      input: responseInput(request),
      max_output_tokens: request.maxOutputTokens,
      ...(model?.reasoning !== false ? { reasoning: { effort } } : {}),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.legacyConversationId && !request.referenceContext
        ? { conversation: request.legacyConversationId }
        : { store: false }),
    });
  }
}
