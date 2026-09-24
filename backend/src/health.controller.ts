import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness and database probe for operators and reverse proxies. */
  @Public()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException(this.response(false, 'down'));
    }

    return this.response(true, 'up');
  }

  private response(ok: boolean, db: 'up' | 'down') {
    return {
      ok,
      db,
      uptime_seconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION || '1.0.0',
    };
  }
}
