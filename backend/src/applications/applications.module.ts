import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { BannedUrlService } from './banned-url.service';
import { ApplicationGenerationService } from '../resume/resume.service';
import { SlackNotificationService } from './slack-notification.service';
import { ApplicationScreenshotService } from './application-screenshot.service';
import { ApplicationScreenshotCleanupService } from './application-screenshot-cleanup.service';
import { ApplicationDraftService } from './application-draft.service';
import { AiSettingsModule } from '../ai/ai-settings.module';
import { GenerationJobsService } from '../resume/generation-jobs.service';
import { GenerationJobsController } from '../resume/generation-jobs.controller';

@Module({
  imports: [AiSettingsModule],
  controllers: [ApplicationsController, GenerationJobsController],
  providers: [
    ApplicationsService, NumberingService, DuplicateService, BannedUrlService,
    ApplicationGenerationService, SlackNotificationService, ApplicationScreenshotService,
    ApplicationScreenshotCleanupService,
    ApplicationDraftService,
    GenerationJobsService,
  ],
  exports: [ApplicationsService, NumberingService, DuplicateService, BannedUrlService, ApplicationGenerationService],
})
export class ApplicationsModule {}
