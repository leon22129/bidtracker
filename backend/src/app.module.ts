import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ApplicationsModule } from './applications/applications.module';
import { ImportModule } from './import/import.module';
import { PaymentsModule } from './payments/payments.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';
import { ResumeModule } from './resume/resume.module';
import { ConversationCleanupModule } from './resume/conversation-cleanup.module';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    ConversationCleanupModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    ApplicationsModule,
    ImportModule,
    PaymentsModule,
    AnalyticsModule,
    ResumeModule,
  ],
  controllers: [HealthController],
  providers: [
    AdminBootstrapService,
    // Deny by default: every route needs a valid JWT unless explicitly marked @Public().
    // Forgetting the decorator makes an endpoint private, which is the safe direction to fail.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
