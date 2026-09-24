import { Global, Module } from '@nestjs/common';
import { ConversationCleanupService } from './conversation-cleanup.service';

@Global()
@Module({
  providers: [ConversationCleanupService],
  exports: [ConversationCleanupService],
})
export class ConversationCleanupModule {}
