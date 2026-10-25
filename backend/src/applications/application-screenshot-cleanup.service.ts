import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CLEANUP_LOCK_ID = 734927451012345681n;

@Injectable()
export class ApplicationScreenshotCleanupService {
  private readonly logger = new Logger(ApplicationScreenshotCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * *', { name: 'application-screenshot-retention', timeZone: 'UTC' })
  async cleanupExpired() {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_ID}) AS acquired
      `);
      if (!lock?.acquired) return { skipped: true, deleted: 0 };
      const result = await tx.applicationScreenshot.deleteMany({
        where: { expires_at: { lte: new Date() } },
      });
      if (result.count) this.logger.log(`Removed ${result.count} expired application screenshot(s)`);
      return { skipped: false, deleted: result.count };
    });
  }
}
