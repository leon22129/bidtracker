import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { AiSettingsService } from './ai-settings.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAiSettingsDto, UpdateResumePromptDto } from './ai-settings.dto';
import { DEFAULT_RESUME_PROMPT } from './resume-prompt';
import { AI_PROVIDERS, AiProvider } from './ai-catalog';

describe('Profile AI settings', () => {
  const admin = { id: 'admin-a', role: 'admin' as const, username: 'Admin', email: 'admin@example.com' };
  const originalSecret = process.env.AI_SETTINGS_ENCRYPTION_KEY;
  beforeEach(() => { process.env.AI_SETTINGS_ENCRYPTION_KEY = 'test-encryption-secret-32-characters-long'; });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
    else process.env.AI_SETTINGS_ENCRYPTION_KEY = originalSecret;
  });
  function setup() {
    const accounts = new Map<string, any>();
    const profiles = new Map<string, any>();
    const workspaces = new Map(['w1', 'w2', 'w3'].map((id) => [id, {
      id, created_by_user_id: id === 'w3' ? 'admin-b' : admin.id,
      creator: { ...admin, id: id === 'w3' ? 'admin-b' : admin.id },
      owner: { id: 'bidder', role: 'bidder', creator: admin },
    }]));
    const table = (records: Map<string, any>, id: string) => ({
      findUnique: jest.fn(async ({ where }) => records.get(where[id]) ?? null),
      deleteMany: jest.fn(async ({ where }) => ({ count: records.delete(where[id]) ? 1 : 0 })),
      updateMany: jest.fn(async ({ where, data }) => {
        const current = records.get(where[id]);
        if (!current || Object.entries(where).some(([field, condition]: [string, any]) => condition?.not === null && current[field] == null)) return { count: 0 };
        records.set(where[id], { ...current, ...data }); return { count: 1 };
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const value = records.has(where[id]) ? { ...records.get(where[id]), ...update } : create;
        records.set(where[id], value); return value;
      }),
    });
    const prisma = {
      aiSettings: table(accounts, 'admin_id'), profileAiSettings: table(profiles, 'workspace_id'),
      workspace: { findUnique: jest.fn(async ({ where }) => workspaces.has(where.id)
        ? { ...workspaces.get(where.id), aiSettings: profiles.get(where.id) ?? null } : null) },
    };
    return { service: new AiSettingsService(prisma as any), prisma, accounts, profiles, workspaces };
  }
  const selection = (provider: AiProvider, api_key?: string) => ({ provider, model: AI_PROVIDERS[provider].default_model, api_key });
  function legacyKey(value: string, adminId: string, provider: AiProvider) {
    const iv = randomBytes(12);
    const key = createHash('sha256').update(process.env.AI_SETTINGS_ENCRYPTION_KEY!).digest();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${adminId}:${provider}`));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
  }

  it.each(Object.keys(AI_PROVIDERS) as AiProvider[])('encrypts %s keys for a single profile and never returns credentials', async (provider) => {
    const { service, profiles } = setup();
    const result = await service.updateProfile(admin, 'w1', selection(provider, 'profile-secret'));
    expect(await validate(plainToInstance(UpdateAiSettingsDto, selection(provider)))).toHaveLength(0);
    expect(profiles.get('w1')[`${provider}_key`]).toMatch(/^v2:/);
    expect(JSON.stringify(profiles.get('w1'))).not.toContain('profile-secret');
    expect(JSON.stringify(result)).not.toContain('profile-secret');
    expect(result.keys[provider]).toEqual({ saved: true, configured: true });
    expect((await service.getProfile(admin, 'w2')).keys[provider].saved).toBe(false);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider, apiKey: 'profile-secret',
      model: AI_PROVIDERS[provider].default_model, baseUrl: AI_PROVIDERS[provider].base_url });
  });

  it('keeps models and keys independent between profiles belonging to the same admin', async () => {
    const { service, profiles } = setup();
    await service.update(admin, selection('gemini', 'account-key'));
    await service.updateProfile(admin, 'w1', selection('claude', 'first-key'));
    await service.updateProfile(admin, 'w2', { ...selection('claude', 'second-key'), model: 'claude-haiku-5-5' });
    await service.updateProfile(admin, 'w1', { ...selection('claude'), model: 'claude-opus-5-5' });
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ model: 'claude-opus-5-5', apiKey: 'first-key' });
    await expect(service.forWorkspace('w2')).resolves.toMatchObject({ model: 'claude-haiku-5-5', apiKey: 'second-key' });
    const reset = await service.resetProfile(admin, 'w1');
    expect(reset.uses_account_defaults).toBe(true);
    expect(profiles.has('w1')).toBe(false);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider: 'gemini', apiKey: 'account-key' });
    await expect(service.forWorkspace('w2')).resolves.toMatchObject({ apiKey: 'second-key' });
  });

  it('keeps separate platform keys within a profile, including legacy OpenAI conversation access', async () => {
    const { service } = setup();
    await service.updateProfile(admin, 'w1', selection('openai', 'own-openai'));
    await service.updateProfile(admin, 'w1', selection('gemini', 'own-gemini'));
    await expect(service.forWorkspace('w1', 'openai')).resolves.toMatchObject({ provider: 'openai', apiKey: 'own-openai' });
    await expect(service.updateProfile(admin, 'w1', selection('claude'))).rejects.toThrow('separate API key');
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider: 'gemini', apiKey: 'own-gemini' });
    await expect(service.forWorkspace('w1', 'openai')).resolves.toMatchObject({ apiKey: 'own-openai' });
  });

  it.each(['bidder', 'bidder_manager'] as const)('denies %s profile settings access before reading credentials', async (role) => {
    const { service, prisma } = setup();
    await expect(service.getProfile({ ...admin, role }, 'w1')).rejects.toThrow('Only admins');
    await expect(service.updateProfile({ ...admin, role }, 'w1', selection('openai'))).rejects.toThrow('Only admins');
    await expect(service.resetProfile({ ...admin, role }, 'w1')).rejects.toThrow('Only admins');
    await expect(service.get({ ...admin, role })).rejects.toThrow('Only admins');
    await expect(service.update({ ...admin, role }, selection('openai'))).rejects.toThrow('Only admins');
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(prisma.profileAiSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.profileAiSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.profileAiSettings.deleteMany).not.toHaveBeenCalled();
    expect(prisma.aiSettings.findUnique).not.toHaveBeenCalled();
  });

  it('denies another admin and unknown profiles, but lets a super admin manage the profile', async () => {
    const { service, prisma } = setup();
    for (const id of ['w3', 'unknown']) {
      await expect(service.getProfile(admin, id)).rejects.toThrow('Profile not found');
      await expect(service.updateProfile(admin, id, selection('openai'))).rejects.toThrow('Profile not found');
      await expect(service.resetProfile(admin, id)).rejects.toThrow('Profile not found');
    }
    expect(prisma.profileAiSettings.findUnique).not.toHaveBeenCalled();
    await service.updateProfile({ ...admin, role: 'super_admin' }, 'w3', selection('gemini', 'profile-w3'));
    await expect(service.forWorkspace('w3')).resolves.toMatchObject({ apiKey: 'profile-w3' });
    expect((await service.getProfile({ ...admin, role: 'super_admin' }, 'w3')).keys.gemini.saved).toBe(true);
  });

  it('binds new encrypted keys to both the profile and provider', async () => {
    const { service, profiles } = setup();
    await service.updateProfile(admin, 'w1', selection('gemini', 'own-key'));
    profiles.set('w2', { ...profiles.get('w1'), workspace_id: 'w2' });
    await expect(service.forWorkspace('w2')).rejects.toThrow('cannot be read');
    profiles.set('w1', { ...profiles.get('w1'), ...selection('claude'), claude_key: profiles.get('w1').gemini_key });
    await expect(service.forWorkspace('w1')).rejects.toThrow('cannot be read');
  });

  it.each(Object.keys(AI_PROVIDERS) as AiProvider[])('reads migrated %s credentials using the original admin identity', async (provider) => {
    const { service, profiles, workspaces } = setup();
    profiles.set('w1', { workspace_id: 'w1', ...selection(provider), legacy_admin_id: admin.id,
      [`${provider}_key`]: legacyKey('migrated-key', admin.id, provider) });
    workspaces.get('w1')!.owner.id = 'another-bidder';
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ apiKey: 'migrated-key' });
    await service.updateProfile({ ...admin, id: 'super', role: 'super_admin' }, 'w1', selection(provider, 'replacement'));
    expect(profiles.get('w1')[`${provider}_key`]).toMatch(/^v2:/);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ apiKey: 'replacement' });
  });

  it.each(Object.keys(AI_PROVIDERS) as AiProvider[])('inherits existing %s account keys without creating a profile override', async (provider) => {
    const { service, accounts, profiles } = setup();
    accounts.set(admin.id, { ...selection(provider), [`${provider}_key`]: legacyKey('old-account-key', admin.id, provider) });
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider, model: selection(provider).model, apiKey: 'old-account-key' });
    const result = await service.getProfile(admin, 'w1');
    expect(result.uses_account_defaults).toBe(true);
    expect(result.account_defaults).toMatchObject({ provider, configured: true });
    expect(result.keys[provider].saved).toBe(false);
    expect(JSON.stringify(result)).not.toContain('old-account-key');
    expect(profiles.size).toBe(0);
  });

  it.each(Object.keys(AI_PROVIDERS) as AiProvider[])('encrypts new %s account keys, follows account updates and isolates other admins', async (provider) => {
    const { service, accounts } = setup();
    const publicResult = await service.update(admin, selection(provider, 'account-secret'));
    expect(accounts.get(admin.id)[`${provider}_key`]).toMatch(/^v1:/);
    expect(JSON.stringify(publicResult)).not.toContain('account-secret');
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider, apiKey: 'account-secret' });
    await expect(service.forWorkspace('w3')).rejects.toThrow('Account');
    await service.updateProfile(admin, 'w1', selection('claude', 'special-key'));
    await service.update(admin, selection('gemini', 'updated-account-key'));
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider: 'claude', apiKey: 'special-key' });
    await expect(service.forWorkspace('w2')).resolves.toMatchObject({ provider: 'gemini', apiKey: 'updated-account-key' });
    await service.resetProfile(admin, 'w1');
    await service.resetProfile(admin, 'w1'); // Reset is idempotent.
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ provider: 'gemini', apiKey: 'updated-account-key' });
    await service.update(admin, { ...selection('gemini'), model: 'gemini-4-carbon' });
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ model: 'gemini-4-carbon', apiKey: 'updated-account-key' });
  });

  it('requires a complete profile override and never mixes an override model with an account key', async () => {
    const { service, profiles } = setup();
    await service.update(admin, selection('gemini', 'account-key'));
    await expect(service.updateProfile(admin, 'w1', selection('gemini'))).rejects.toThrow('separate API key');
    await expect(service.updateProfile(admin, 'w1', { ...selection('gemini'), remove_api_key: true })).rejects.toThrow('Use account defaults');
    expect(profiles.size).toBe(0);
    await service.updateProfile(admin, 'w1', selection('gemini', 'override-key'));
    profiles.get('w1').gemini_key = null;
    await expect(service.forWorkspace('w1')).rejects.toThrow('for this profile');
    profiles.get('w1').gemini_key = 'invalid-ciphertext';
    await expect(service.forWorkspace('w1')).rejects.toThrow('cannot be read');
  });

  it('uses the profile creator account even for super admins or reassigned bidders', async () => {
    const { service, workspaces } = setup();
    await service.update(admin, selection('openai', 'creator-key'));
    await service.update({ ...admin, id: 'admin-b' }, selection('claude', 'other-key'));
    workspaces.get('w1')!.owner.creator = { ...admin, id: 'admin-b' };
    const result = await service.getProfile({ ...admin, id: 'super', role: 'super_admin' }, 'w1');
    expect(result.account_defaults.provider).toBe('openai');
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ apiKey: 'creator-key' });
    await expect(service.forWorkspace('w3')).resolves.toMatchObject({ apiKey: 'other-key' });
  });

  it('does not recreate a keyless override when a model-only save races with a reset', async () => {
    const { service, profiles, prisma } = setup();
    await service.update(admin, selection('gemini', 'account-key'));
    await service.updateProfile(admin, 'w1', selection('claude', 'special-key'));
    prisma.profileAiSettings.updateMany.mockImplementationOnce(async () => {
      profiles.delete('w1'); return { count: 0 };
    });
    await expect(service.updateProfile(admin, 'w1', { ...selection('claude'), model: 'claude-haiku-5-5' })).rejects.toThrow('Reload AI settings');
    expect(profiles.has('w1')).toBe(false);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ apiKey: 'account-key', provider: 'gemini' });
  });

  it('never uses environment keys when account defaults are missing or cleared', async () => {
    const { service } = setup();
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-be-used';
    try {
      expect((await service.getProfile(admin, 'w1')).keys.openai.configured).toBe(false);
      await expect(service.forWorkspace('w1')).rejects.toThrow('Account');
      await service.updateProfile(admin, 'w1', selection('openai', 'own-key'));
      await service.update(admin, selection('openai', 'account-key'));
      await service.update(admin, { ...selection('openai'), remove_api_key: true });
      await expect(service.forWorkspace('w1')).resolves.toMatchObject({ apiKey: 'own-key' });
      await service.resetProfile(admin, 'w1');
      await expect(service.forWorkspace('w1')).rejects.toThrow('Account');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('rejects unsupported models, mismatched providers and conflicting key updates', async () => {
    const { service, prisma } = setup();
    await expect(service.updateProfile(admin, 'w1', { provider: 'claude', model: 'gemini-4-hydrogen' })).rejects.toThrow('supported model');
    await expect(service.updateProfile(admin, 'w1', { ...selection('gemini', 'new-key'), remove_api_key: true })).rejects.toThrow('not both');
    expect(await validate(plainToInstance(UpdateAiSettingsDto, { provider: 'unknown', model: 'unknown' }))).not.toHaveLength(0);
    expect(prisma.profileAiSettings.upsert).not.toHaveBeenCalled();
  });

  it('keeps the account prompt independent of profile credentials and never reveals account keys', async () => {
    const { service, accounts, profiles } = setup();
    accounts.set(admin.id, { openai_key: 'legacy-secret' });
    const custom = `${DEFAULT_RESUME_PROMPT}\nUse concise sentences.`;
    await service.updateProfile(admin, 'w1', selection('deepseek', 'own-key'));
    const before = { ...profiles.get('w1') };
    expect((await service.updateResumePrompt(admin, custom)).resume_prompt_customized).toBe(true);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ resumePrompt: custom, apiKey: 'own-key' });
    expect((await service.get({ ...admin, id: 'admin-b' })).resume_prompt).toBe(DEFAULT_RESUME_PROMPT);
    const result = await service.get(admin);
    expect(result.keys.openai.saved).toBe(true);
    expect(result.provider).toBe('openai');
    expect(JSON.stringify(result)).not.toContain('legacy-secret');
    await service.updateResumePrompt(admin, null);
    expect(profiles.get('w1')).toEqual(before);
    await expect(service.forWorkspace('w1')).resolves.toMatchObject({ resumePrompt: DEFAULT_RESUME_PROMPT });
  });

  it('rejects unauthorized and invalid prompt updates', async () => {
    const { service, prisma } = setup();
    await expect(service.updateResumePrompt({ ...admin, role: 'bidder' }, DEFAULT_RESUME_PROMPT)).rejects.toThrow('Only admins');
    await expect(service.updateResumePrompt(admin, 'Missing placeholders')).rejects.toThrow('placeholders');
    for (const resume_prompt of [undefined, '', 42, 'a'.repeat(50001)]) {
      expect(await validate(plainToInstance(UpdateResumePromptDto, { resume_prompt }))).not.toHaveLength(0);
    }
    expect(await validate(plainToInstance(UpdateResumePromptDto, { resume_prompt: null }))).toHaveLength(0);
    expect(prisma.aiSettings.upsert).not.toHaveBeenCalled();
  });
});
