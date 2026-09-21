import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { ResumeController } from './resume.controller';
import { ResumeService } from './resume.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [ResumeController],
  providers: [ResumeService],
})
export class ResumeModule {}
