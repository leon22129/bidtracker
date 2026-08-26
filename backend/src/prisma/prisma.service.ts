import { INestApplication, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'production'
          ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.applySqlitePragmas();
  }

  /**
   * SQLite tuning. Without these the app is both slower and less correct:
   *  - foreign_keys defaults to OFF in SQLite, which would make every cascade/FK in the schema decorative
   *  - WAL is what allows readers to keep working while a write (e.g. a 20k-row import) is in flight
   *  - busy_timeout turns "SQLITE_BUSY" crashes into a short wait, which is the behaviour we want with
   *    a single-writer database and a handful of concurrent editors
   */
  private async applySqlitePragmas() {
    const pragmas = [
      'PRAGMA journal_mode = WAL',
      'PRAGMA busy_timeout = 5000',
      'PRAGMA synchronous = NORMAL',
      'PRAGMA foreign_keys = ON',
      'PRAGMA cache_size = -64000',
      'PRAGMA temp_store = MEMORY',
    ];
    for (const pragma of pragmas) {
      try {
        await this.$queryRawUnsafe(pragma);
      } catch (err) {
        this.logger.warn(`Failed to apply "${pragma}": ${(err as Error).message}`);
      }
    }
    this.logger.log('SQLite pragmas applied (WAL, foreign_keys=ON, busy_timeout=5000ms)');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
