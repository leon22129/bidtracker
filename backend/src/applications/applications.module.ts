import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { BannedUrlService } from './banned-url.service';
import { ApplicationGenerationService } from '../resume/resume.service';
import { ApplicationIngestionLockService } from './application-ingestion-lock.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, NumberingService, DuplicateService, BannedUrlService, ApplicationGenerationService, ApplicationIngestionLockService],
  exports: [ApplicationsService, NumberingService, DuplicateService, BannedUrlService, ApplicationGenerationService, ApplicationIngestionLockService],
})
export class ApplicationsModule {}
