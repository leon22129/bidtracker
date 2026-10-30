import { Global, Module } from '@nestjs/common';
import { ConversationCleanupService } from './conversation-cleanup.service';
import { AiSettingsModule } from '../ai/ai-settings.module';

@Global()
@Module({
  imports: [AiSettingsModule],
  providers: [ConversationCleanupService],
  exports: [ConversationCleanupService],
})
export class ConversationCleanupModule {}
