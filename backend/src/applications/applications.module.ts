import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { MetadataService } from './metadata.service';
import { BannedUrlService } from './banned-url.service';
import { ApplicationGenerationService } from '../resume/resume.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, NumberingService, DuplicateService, MetadataService, BannedUrlService, ApplicationGenerationService],
  exports: [ApplicationsService, NumberingService, DuplicateService, MetadataService, BannedUrlService, ApplicationGenerationService],
})
export class ApplicationsModule {}
