import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { NumberingService } from './numbering.service';
import { DuplicateService } from './duplicate.service';
import { MetadataService } from './metadata.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, NumberingService, DuplicateService, MetadataService],
  exports: [ApplicationsService, NumberingService, DuplicateService, MetadataService],
})
export class ApplicationsModule {}
