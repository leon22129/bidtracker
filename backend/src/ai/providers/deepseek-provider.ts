import { AiResponseRequest, responseInput, SendAiResponse } from './ai-provider';

/** DeepSeek supports Responses, but every request must carry its own context. */
export class DeepSeekProvider {
  async generate<T>(request: AiResponseRequest, send: SendAiResponse<T>): Promise<T> {
    if (request.legacyConversationId) {
      throw new Error('DeepSeek requires local reference context, not a provider conversation ID');
    }
    // Explicit allow-list: never send OpenAI conversation, storage or cache parameters.
    return send({
      model: request.model,
      input: responseInput(request),
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: request.reasoningEffort === 'low' ? 'low' : 'high' },
      ...(request.instructions ? { instructions: request.instructions } : {}),
    });
  }
}
