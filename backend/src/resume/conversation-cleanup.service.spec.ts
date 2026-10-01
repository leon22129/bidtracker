import { ServiceUnavailableException } from '@nestjs/common';
import { ConversationCleanupService } from './conversation-cleanup.service';

describe('ConversationCleanupService', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalRetentionDays = process.env.OPENAI_CONVERSATION_RETENTION_DAYS;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_CONVERSATION_RETENTION_DAYS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalRetentionDays === undefined) delete process.env.OPENAI_CONVERSATION_RETENTION_DAYS;
    else process.env.OPENAI_CONVERSATION_RETENTION_DAYS = originalRetentionDays;
  });

  it('deletes expired conversations at the provider before removing local mappings', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    const row = { id: 'local-1', openai_conversation_id: 'conv-1' };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
      resumeConversation: {
        findMany: jest.fn().mockResolvedValue([row]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'item-1' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'conv-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    const service = new ConversationCleanupService(prisma as never);

    await expect(service.cleanupExpired()).resolves.toMatchObject({ deleted: 1 });
    expect(tx.resumeConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { updated_at: { lt: new Date('2026-06-26T12:00:00.000Z') } },
    }));
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.openai.com/v1/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/conversations/conv-1/items/item-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(tx.resumeConversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['local-1'] } },
    });
  });

  it('retains the local mapping and blocks parent deletion when provider cleanup fails', async () => {
    const prisma = {
      resumeConversation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'local-1', openai_conversation_id: 'conv-1' },
        ]),
        deleteMany: jest.fn(),
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    const service = new ConversationCleanupService(prisma as never);

    await expect(service.deleteForWorkspaceOrThrow('workspace-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.resumeConversation.deleteMany).not.toHaveBeenCalled();
  });
});
