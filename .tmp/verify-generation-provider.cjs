const path = require('node:path');
const backend = path.resolve(__dirname, '../backend');
require(path.join(backend, 'node_modules/dotenv')).config({ path: path.join(backend, '.env') });
const { Logger } = require(path.join(backend, 'node_modules/@nestjs/common'));
const { ApplicationGenerationService } = require(path.join(backend, 'dist/resume/resume.service.js'));

Logger.overrideLogger(['warn', 'error']);
const service = new ApplicationGenerationService({}, {}, {}, {}, {}, {});

(async () => {
  let conversationId;
  try {
    const conversation = await service.openAiRequest('/conversations', {
      items: [{ type: 'message', role: 'user', content: 'Connection verification.' }],
      metadata: { purpose: 'generation_connection_verification' },
    }, 'POST', 'conversation_create_verification');
    if (!conversation?.id) throw new Error('The provider did not return a conversation ID');
    conversationId = conversation.id;
    console.log('PASS: live OpenAI conversation creation');
  } finally {
    if (conversationId) {
      const result = await service.openAiRequest(
        `/conversations/${encodeURIComponent(conversationId)}`, undefined, 'DELETE',
        'conversation_verification_cleanup',
      );
      if (!result?.deleted) throw new Error('Verification conversation cleanup was not confirmed');
      console.log('PASS: verification conversation deleted');
    }
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
