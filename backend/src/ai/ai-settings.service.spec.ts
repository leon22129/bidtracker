import { AiSettingsService } from './ai-settings.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAiSettingsDto, UpdateResumePromptDto } from './ai-settings.dto';
import { DEFAULT_RESUME_PROMPT } from './resume-prompt';

describe('Admin AI settings', () => {
  const admin = { id: 'admin-a', role: 'admin' as const, username: 'Admin', email: 'admin@example.com' };
  const originalSecret = process.env.AI_SETTINGS_ENCRYPTION_KEY;
  beforeEach(() => { process.env.AI_SETTINGS_ENCRYPTION_KEY = 'test-encryption-secret-32-characters-long'; });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
    else process.env.AI_SETTINGS_ENCRYPTION_KEY = originalSecret;
  });

  function setup() {
    const records = new Map<string, any>();
    const prisma = {
      aiSettings: {
        findUnique: jest.fn(async ({ where }) => records.get(where.admin_id) ?? null),
        upsert: jest.fn(async ({ where, create, update }) => {
          const saved = records.has(where.admin_id) ? { ...records.get(where.admin_id), ...update } : create;
          records.set(where.admin_id, saved); return saved;
        }),
      },
      workspace: { findUnique: jest.fn(async () => ({ creator: admin, owner: { id: 'bidder', role: 'bidder', creator: admin } })) },
    };
    return { service: new AiSettingsService(prisma as any), prisma, records };
  }

  it('encrypts keys, never returns them, and resolves the workspace administrator', async () => {
    const { service, records, prisma } = setup();
    const result = await service.update(admin, { provider: 'deepseek', model: 'deepseek-flash', api_key: 'sk-test-secret' });
    expect(records.get(admin.id).deepseek_key).toMatch(/^v1:/);
    expect(JSON.stringify(records.get(admin.id))).not.toContain('sk-test-secret');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
    expect(result.keys.deepseek).toEqual({ saved: true, configured: true });
    await expect(service.forWorkspace('workspace-a')).resolves.toMatchObject({
      provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-test-secret', baseUrl: 'https://api.deepseek.com',
    });
    expect(prisma.aiSettings.findUnique).toHaveBeenLastCalledWith({ where: { admin_id: 'admin-a' } });
    expect((await service.get({ ...admin, id: 'admin-b' })).keys.deepseek.saved).toBe(false);
  });

  it('keeps a separate key for each provider when switching, and removes only the selected key', async () => {
    const { service, records } = setup();
    await service.update(admin, { provider: 'openai', model: 'gpt-6.1-sol', api_key: 'sk-openai-test' });
    await service.update(admin, { provider: 'deepseek', model: 'deepseek-flash', api_key: 'sk-deepseek-test' });
    await service.update(admin, { provider: 'openai', model: 'gpt-4.1' });
    await expect(service.forWorkspace('w')).resolves.toMatchObject({ apiKey: 'sk-openai-test', model: 'gpt-4.1' });
    await service.update(admin, { provider: 'deepseek', model: 'deepseek-v4-pro', remove_api_key: true });
    expect(records.get(admin.id).openai_key).toBeTruthy();
    expect(records.get(admin.id).deepseek_key).toBeNull();
    await expect(service.forWorkspace('w')).rejects.toThrow('configure their own DeepSeek API key');
  });

  it('rejects bidders, unsupported providers, and models from a different provider', async () => {
    const { service, prisma } = setup();
    await expect(service.get({ ...admin, role: 'bidder' })).rejects.toThrow('Only admins');
    await expect(service.update({ ...admin, role: 'bidder' }, { provider: 'openai', model: 'gpt-6.1-sol' })).rejects.toThrow('Only admins');
    await expect(service.update(admin, { provider: 'deepseek', model: 'gpt-6.1-sol' })).rejects.toThrow('supported model');
    expect(await validate(plainToInstance(UpdateAiSettingsDto, { provider: 'anthropic', model: 'unknown' }))).not.toHaveLength(0);
    expect(prisma.aiSettings.upsert).not.toHaveBeenCalled();
  });

  it('does not decrypt keys copied to another admin account', async () => {
    const { service, records } = setup();
    await service.update({ ...admin, id: 'admin-b' }, { provider: 'deepseek', model: 'deepseek-flash', api_key: 'sk-other-admin' });
    records.set(admin.id, records.get('admin-b'));
    await expect(service.forWorkspace('w')).rejects.toThrow('cannot be read');
  });

  it('never uses environment keys when an admin has no saved key or removes it', async () => {
    const previousOpenai = process.env.OPENAI_API_KEY;
    const previousDeepseek = process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-be-used';
    process.env.DEEPSEEK_API_KEY = 'must-not-be-used';
    try {
      const { service } = setup();
      expect((await service.get(admin)).keys).toEqual({
        openai: { saved: false, configured: false }, deepseek: { saved: false, configured: false },
      });
      await expect(service.forWorkspace('w')).rejects.toThrow('configure their own API key');
      await service.update(admin, { provider: 'openai', model: 'gpt-6.1-sol', api_key: 'own-key' });
      await service.update(admin, { provider: 'openai', model: 'gpt-6.1-sol', remove_api_key: true });
      await expect(service.forWorkspace('w')).rejects.toThrow('configure their own OpenAI API key');
      await service.update(admin, { provider: 'deepseek', model: 'deepseek-flash' });
      await expect(service.forWorkspace('w')).rejects.toThrow('configure their own DeepSeek API key');
    } finally {
      if (previousOpenai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenai;
      if (previousDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDeepseek;
    }
  });

  it('uses the same admin\'s saved OpenAI key for legacy conversations after switching providers', async () => {
    const { service } = setup();
    await service.update(admin, { provider: 'openai', model: 'gpt-4.1', api_key: 'own-openai' });
    await service.update(admin, { provider: 'deepseek', model: 'deepseek-flash', api_key: 'own-deepseek' });
    await expect(service.forWorkspace('w', 'openai')).resolves.toMatchObject({ provider: 'openai', apiKey: 'own-openai' });
    await expect(service.forWorkspace('w')).resolves.toMatchObject({ provider: 'deepseek', apiKey: 'own-deepseek' });
  });

  it('saves and resets prompts independently of keys and keeps other admins on their own prompt', async () => {
    const { service, records } = setup();
    const custom = `${DEFAULT_RESUME_PROMPT}\nUse concise sentences.`;
    expect((await service.get(admin)).resume_prompt).toBe(DEFAULT_RESUME_PROMPT);
    expect((await service.updateResumePrompt(admin, custom)).resume_prompt_customized).toBe(true);
    expect((await service.get({ ...admin, id: 'admin-b' })).resume_prompt).toBe(DEFAULT_RESUME_PROMPT);
    await expect(service.forWorkspace('w')).rejects.toThrow('configure their own OpenAI API key');
    await service.update(admin, { provider: 'deepseek', model: 'deepseek-flash', api_key: 'own-key' });
    await expect(service.forWorkspace('w')).resolves.toMatchObject({ resumePrompt: custom, apiKey: 'own-key' });
    const encryptedKey = records.get(admin.id).deepseek_key;
    expect((await service.updateResumePrompt(admin, null)).resume_prompt).toBe(DEFAULT_RESUME_PROMPT);
    expect(records.get(admin.id).deepseek_key).toBe(encryptedKey);
    expect(records.get(admin.id).provider).toBe('deepseek');
    await expect(service.forWorkspace('w')).resolves.toMatchObject({ resumePrompt: DEFAULT_RESUME_PROMPT });
  });

  it('rejects unauthorized and invalid prompt updates without changing stored settings', async () => {
    const { service, prisma } = setup();
    await expect(service.updateResumePrompt({ ...admin, role: 'bidder' }, DEFAULT_RESUME_PROMPT)).rejects.toThrow('Only admins');
    await expect(service.updateResumePrompt(admin, 'Missing candidate placeholders')).rejects.toThrow('placeholders');
    for (const resume_prompt of [undefined, '', 42, 'a'.repeat(50001)]) {
      expect(await validate(plainToInstance(UpdateResumePromptDto, { resume_prompt }))).not.toHaveLength(0);
    }
    expect(await validate(plainToInstance(UpdateResumePromptDto, { resume_prompt: null }))).toHaveLength(0);
    expect(prisma.aiSettings.upsert).not.toHaveBeenCalled();
  });
});
