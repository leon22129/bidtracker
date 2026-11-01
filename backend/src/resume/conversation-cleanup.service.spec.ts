import { ServiceUnavailableException } from '@nestjs/common';
import { ConversationCleanupService } from './conversation-cleanup.service';

describe('ConversationCleanupService', () => {
  const originalRetentionDays = process.env.OPENAI_CONVERSATION_RETENTION_DAYS;
  const aiSettings = { forWorkspace: jest.fn() };

  beforeEach(() => {
    aiSettings.forWorkspace.mockReset().mockResolvedValue({ apiKey: 'saved-admin-key' });
    delete process.env.OPENAI_CONVERSATION_RETENTION_DAYS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalRetentionDays === undefined) delete process.env.OPENAI_CONVERSATION_RETENTION_DAYS;
    else process.env.OPENAI_CONVERSATION_RETENTION_DAYS = originalRetentionDays;
  });

  it('deletes expired conversations at the provider before removing local mappings', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    const row = { id: 'local-1', openai_conversation_id: 'conv-1', workspace_id: 'workspace-1' };
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
    const service = new ConversationCleanupService(prisma as never, aiSettings as never);

    await expect(service.cleanupExpired()).resolves.toMatchObject({ deleted: 1 });
    expect(tx.resumeConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { updated_at: { lt: new Date('2026-06-26T12:00:00.000Z') } },
    }));
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.openai.com/v1/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer saved-admin-key' } }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/conversations/conv-1/items/item-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(tx.resumeConversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['local-1'] } },
    });
    expect(aiSettings.forWorkspace).toHaveBeenCalledWith('workspace-1', 'openai');
  });

  it('retains the local mapping and blocks parent deletion when provider cleanup fails', async () => {
    const prisma = {
      resumeConversation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'local-1', openai_conversation_id: 'conv-1', workspace_id: 'workspace-1' },
        ]),
        deleteMany: jest.fn(),
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    const service = new ConversationCleanupService(prisma as never, aiSettings as never);

    await expect(service.deleteForWorkspaceOrThrow('workspace-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.resumeConversation.deleteMany).not.toHaveBeenCalled();
  });

  it('cleans local question context without a provider key or network request', async () => {
    const prisma = { resumeConversation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'local-1', openai_conversation_id: 'local_uuid' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    } };
    const request = jest.spyOn(globalThis, 'fetch');
    await expect(new ConversationCleanupService(prisma as any, aiSettings as any).deleteForWorkspaceOrThrow('workspace-1')).resolves.toBe(1);
    expect(request).not.toHaveBeenCalled();
    expect(aiSettings.forWorkspace).not.toHaveBeenCalled();
  });

  it('retains legacy conversations if the owning admin has no saved key', async () => {
    aiSettings.forWorkspace.mockRejectedValue(new ServiceUnavailableException('Configure your own key'));
    const prisma = { resumeConversation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'local-1', openai_conversation_id: 'conv-1', workspace_id: null, profile: { workspace_id: 'workspace-1' } }]),
      deleteMany: jest.fn(),
    } };
    const request = jest.spyOn(globalThis, 'fetch');
    await expect(new ConversationCleanupService(prisma as any, aiSettings as any).deleteForWorkspaceOrThrow('workspace-1')).rejects.toThrow('retained for retry');
    expect(aiSettings.forWorkspace).toHaveBeenCalledWith('workspace-1', 'openai');
    expect(request).not.toHaveBeenCalled();
    expect(prisma.resumeConversation.deleteMany).not.toHaveBeenCalled();
  });
});
