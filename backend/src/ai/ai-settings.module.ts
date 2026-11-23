import { Module } from '@nestjs/common';
import { AiSettingsController, ProfileAiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';

@Module({ controllers: [AiSettingsController, ProfileAiSettingsController], providers: [AiSettingsService], exports: [AiSettingsService] })
export class AiSettingsModule {}
