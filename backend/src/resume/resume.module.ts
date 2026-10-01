import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { ResumeController } from './resume.controller';

@Module({
  imports: [ApplicationsModule],
  controllers: [ResumeController],
})
export class ResumeModule {}
