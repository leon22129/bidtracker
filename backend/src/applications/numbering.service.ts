import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-date row numbering.
 *
 * Spec: `number` starts at 1 and resets for every date.
 *   Aug 25 -> 1, 2, 3        Aug 26 -> 1, 2
 *
 * Implementation choice: derive the next value from `MAX(number)` inside the same transaction as the
 * insert, and rely on the `(workspace_id, date, number)` UNIQUE index as the real guarantee. A cached
 * in-memory counter would be faster but wrong the moment there are two app processes, and a separate
 * "counters" table would add a write-hotspot row plus its own lock contention. With the unique index
 * the worst case under a race is a P2002, which we simply retry — correctness comes from the database,
 * not from hoping the application layer is single-threaded.
 */
@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Highest number currently used for (workspace, date); 0 when the day is empty. */
  async currentMax(
    tx: Prisma.TransactionClient | PrismaService,
    workspaceId: string,
    date: Date,
  ): Promise<number> {
    const result = await tx.jobApplication.aggregate({
      where: { workspace_id: workspaceId, date },
      _max: { number: true },
    });
    return result._max.number ?? 0;
  }

  /**
   * Reserves `count` consecutive numbers for a day and returns the first one.
   * Used by bulk paths such as Excel import so a 20k-row import does one MAX query per date
   * instead of one per row.
   */
  async reserveBlock(
    tx: Prisma.TransactionClient | PrismaService,
    workspaceId: string,
    date: Date,
    count: number,
  ): Promise<number> {
    const max = await this.currentMax(tx, workspaceId, date);
    return max + 1;
  }

  /**
   * Runs `fn` with the next available number, retrying on unique-constraint collisions caused by a
   * concurrent insert into the same (workspace, date).
   */
  async withNextNumber<T>(
    workspaceId: string,
    date: Date,
    fn: (nextNumber: number) => Promise<T>,
    attempts = 5,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const next = (await this.currentMax(db, workspaceId, date)) + 1;
      try {
        return await fn(next);
      } catch (err) {
        if (isNumberCollision(err) && attempt < attempts) {
          this.logger.warn(
            `Number ${next} collided for workspace ${workspaceId} on ${date.toISOString().slice(0, 10)}; retrying (${attempt}/${attempts})`,
          );
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate a row number after multiple attempts');
  }
}

export function isNumberCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    JSON.stringify(err.meta ?? {}).includes('number')
  );
}
