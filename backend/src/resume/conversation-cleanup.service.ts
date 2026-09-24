import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const CLEANUP_LOCK_ID = 734927451012345679n;
const PROVIDER_CONCURRENCY = 5;

function retentionDays() {
  const configured = Number(process.env.OPENAI_CONVERSATION_RETENTION_DAYS ?? 30);
  return Number.isFinite(configured) ? Math.min(365, Math.max(1, Math.trunc(configured))) : 30;
}

@Injectable()
export class ConversationCleanupService {
  private readonly logger = new Logger(ConversationCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily provider-side retention cleanup. Failed provider deletes remain in the DB for retry. */
  @Cron('30 3 * * *', { name: 'openai-conversation-retention', timeZone: 'UTC' })
  async cleanupExpired() {
    if (['1', 'true', 'yes', 'on'].includes(
      (process.env.DISABLE_CONVERSATION_CLEANUP ?? '').trim().toLowerCase(),
    )) {
      return { skipped: true, reason: 'disabled', deleted: 0 };
    }

    const cutoff = new Date(Date.now() - retentionDays() * 86_400_000);
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_ID}) AS acquired
      `);
      if (!lock?.acquired) return { skipped: true, reason: 'another_backend_is_processing', deleted: 0 };

      const rows = await tx.resumeConversation.findMany({
        where: { updated_at: { lt: cutoff } },
        select: { id: true, openai_conversation_id: true },
        orderBy: { updated_at: 'asc' },
        take: 50,
      });
      const deletedIds = await this.deleteAtProvider(rows);
      if (deletedIds.length) {
        await tx.resumeConversation.deleteMany({ where: { id: { in: deletedIds } } });
      }
      this.logger.log(`OpenAI conversation retention removed ${deletedIds.length} record(s)`);
      return { skipped: false, deleted: deletedIds.length };
    }, { timeout: 180_000, maxWait: 15_000 });
  }

  async deleteForWorkspaceOrThrow(workspaceId: string) {
    return this.deleteMatchingOrThrow({ workspace_id: workspaceId });
  }

  async deleteForUserOrThrow(userId: string) {
    return this.deleteMatchingOrThrow({ user_id: userId });
  }

  private async deleteMatchingOrThrow(where: { workspace_id?: string; user_id?: string }) {
    const rows = await this.prisma.resumeConversation.findMany({
      where,
      select: { id: true, openai_conversation_id: true },
    });
    if (!rows.length) return 0;

    const deletedIds = await this.deleteAtProvider(rows);
    if (deletedIds.length !== rows.length) {
      if (deletedIds.length) {
        await this.prisma.resumeConversation.deleteMany({ where: { id: { in: deletedIds } } });
      }
      throw new ServiceUnavailableException(
        'Unable to delete every OpenAI conversation. The local record was retained for retry.',
      );
    }
    await this.prisma.resumeConversation.deleteMany({ where: { id: { in: deletedIds } } });
    return deletedIds.length;
  }

  private async deleteAtProvider(
    rows: Array<{ id: string; openai_conversation_id: string }>,
  ): Promise<string[]> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      if (rows.length) this.logger.error('Cannot clean OpenAI conversations: OPENAI_API_KEY is missing');
      return [];
    }

    const results = await mapWithConcurrency(rows, PROVIDER_CONCURRENCY, async (row) => {
      try {
        await this.purgeProviderConversation(row.openai_conversation_id, apiKey);
        return row.id;
      } catch (error) {
        this.logger.warn(
          `OpenAI conversation deletion failed for local record ${row.id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      return null;
    });
    return results.filter((id): id is string => id !== null);
  }

  /** The conversation DELETE endpoint does not delete its items, so purge items first. */
  private async purgeProviderConversation(conversationId: string, apiKey: string) {
    const encodedConversationId = encodeURIComponent(conversationId);
    const headers = { Authorization: `Bearer ${apiKey}` };

    while (true) {
      const listResponse = await fetch(
        `${OPENAI_API_BASE}/conversations/${encodedConversationId}/items?limit=100`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (listResponse.status === 404) return;
      if (!listResponse.ok) throw new Error(`item listing returned ${listResponse.status}`);

      const body = await listResponse.json() as { data?: Array<{ id?: unknown }> };
      const itemIds = Array.isArray(body.data)
        ? body.data.map((item) => item.id).filter((id): id is string => typeof id === 'string')
        : [];
      if (Array.isArray(body.data) && itemIds.length !== body.data.length) {
        throw new Error('item listing returned an invalid payload');
      }
      if (!itemIds.length) break;

      await mapWithConcurrency(itemIds, 10, async (itemId) => {
        const response = await fetch(
          `${OPENAI_API_BASE}/conversations/${encodedConversationId}/items/${encodeURIComponent(itemId)}`,
          { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) },
        );
        if (!response.ok && response.status !== 404) {
          throw new Error(`item deletion returned ${response.status}`);
        }
      });
    }

    const response = await fetch(`${OPENAI_API_BASE}/conversations/${encodedConversationId}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`conversation deletion returned ${response.status}`);
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}
