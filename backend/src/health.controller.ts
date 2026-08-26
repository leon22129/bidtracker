import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Used by the Docker healthcheck and by the tunnel's origin check. */
  @Public()
  @Get('health')
  async health() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      ok: db === 'up',
      db,
      uptime_seconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION || '1.0.0',
    };
  }
}
