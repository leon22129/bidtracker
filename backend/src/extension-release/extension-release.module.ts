import { Module } from '@nestjs/common';
import { ExtensionReleaseController } from './extension-release.controller';
import { ExtensionReleaseService } from './extension-release.service';

@Module({
  controllers: [ExtensionReleaseController],
  providers: [ExtensionReleaseService],
  exports: [ExtensionReleaseService],
})
export class ExtensionReleaseModule {}
