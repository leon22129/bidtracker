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

@Module({
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService, NumberingService, DuplicateService, BannedUrlService,
    ApplicationGenerationService, SlackNotificationService, ApplicationScreenshotService,
    ApplicationScreenshotCleanupService,
  ],
  exports: [ApplicationsService, NumberingService, DuplicateService, BannedUrlService, ApplicationGenerationService],
})
export class ApplicationsModule {}
