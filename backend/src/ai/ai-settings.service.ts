import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AI_CATALOG, AI_PROVIDERS, AiProvider, currentModelPrices, findAiModel } from './ai-catalog';
import { UpdateAiSettingsDto } from './ai-settings.dto';
import { DEFAULT_RESUME_PROMPT, RESUME_PROMPT_MAX_LENGTH, RESUME_PROMPT_VARIABLES, validateResumePrompt } from './resume-prompt';

export const DEFAULT_AI_MODEL = AI_PROVIDERS.openai.default_model;
const KEY_FIELDS = { openai: 'openai_key', deepseek: 'deepseek_key', gemini: 'gemini_key', claude: 'claude_key' } as const;
const ADMIN_SELECT = {
  creator: { select: { id: true, role: true } },
  owner: { select: { id: true, role: true, creator: { select: { id: true, role: true } } } },
} as const;
type AdminIdentity = { id: string; role: string };
type KeyScope = { adminId: string } | { workspaceId: string; legacyAdminId?: string | null };
type SavedSelection = { provider: string; model: string; openai_key?: string | null; deepseek_key?: string | null;
  gemini_key?: string | null; claude_key?: string | null } | null;

export interface AiConfiguration {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  resumePrompt: string;
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (!['admin', 'super_admin'].includes(user.role)) throw new ForbiddenException('Only admins can manage AI settings');
  }

  async get(user: AuthUser) {
    this.assertAdmin(user);
    const saved = await this.prisma.aiSettings.findUnique({ where: { admin_id: user.id } });
    return {
      ...this.publicSelection(saved),
      resume_prompt: saved?.resume_prompt ?? DEFAULT_RESUME_PROMPT,
      default_resume_prompt: DEFAULT_RESUME_PROMPT,
      resume_prompt_customized: Boolean(saved?.resume_prompt),
      resume_prompt_variables: RESUME_PROMPT_VARIABLES,
      resume_prompt_max_length: RESUME_PROMPT_MAX_LENGTH,
    };
  }

  private publicSelection(saved: SavedSelection) {
    return {
      provider: saved?.provider || 'openai', model: saved?.model || DEFAULT_AI_MODEL,
      keys: {
        openai: { saved: Boolean(saved?.openai_key), configured: Boolean(saved?.openai_key) },
        deepseek: { saved: Boolean(saved?.deepseek_key), configured: Boolean(saved?.deepseek_key) },
        gemini: { saved: Boolean(saved?.gemini_key), configured: Boolean(saved?.gemini_key) },
        claude: { saved: Boolean(saved?.claude_key), configured: Boolean(saved?.claude_key) },
      },
      ...AI_CATALOG,
      models: AI_CATALOG.models.map((model) => currentModelPrices(model)),
    };
  }

  private owningAdminId(workspace: { creator: AdminIdentity | null; owner: AdminIdentity & { creator: AdminIdentity | null } }) {
    return [workspace.creator, workspace.owner, workspace.owner.creator]
      .find((candidate) => candidate && ['admin', 'super_admin'].includes(candidate.role))?.id;
  }

  private async assertProfileAdmin(user: AuthUser, workspaceId: string) {
    this.assertAdmin(user);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId }, select: { id: true, created_by_user_id: true, ...ADMIN_SELECT },
    });
    if (!workspace || (user.role !== 'super_admin' && workspace.created_by_user_id !== user.id)) {
      throw new NotFoundException('Profile not found');
    }
    return workspace;
  }

  async getProfile(user: AuthUser, workspaceId: string) {
    const workspace = await this.assertProfileAdmin(user, workspaceId);
    const adminId = this.owningAdminId(workspace);
    const [saved, defaults] = await Promise.all([
      this.prisma.profileAiSettings.findUnique({ where: { workspace_id: workspaceId } }),
      adminId ? this.prisma.aiSettings.findUnique({ where: { admin_id: adminId } }) : null,
    ]);
    const account = this.publicSelection(defaults);
    return {
      ...this.publicSelection(saved ?? defaults),
      workspace_id: workspaceId,
      uses_account_defaults: !saved,
      // These flags describe profile keys only. Inherited keys cannot be kept as a new override.
      keys: this.publicSelection(saved).keys,
      account_defaults: {
        provider: account.provider, model: account.model,
        configured: Boolean(defaults?.[KEY_FIELDS[account.provider as AiProvider]]),
      },
    };
  }

  private validateSelection(dto: UpdateAiSettingsDto) {
    if (!findAiModel(dto.provider, dto.model)) throw new BadRequestException('Choose a supported model for this AI platform');
    if (dto.api_key && dto.remove_api_key) throw new BadRequestException('Enter a key or remove it, not both');
  }

  async update(user: AuthUser, dto: UpdateAiSettingsDto) {
    this.assertAdmin(user);
    this.validateSelection(dto);
    const keyField = KEY_FIELDS[dto.provider];
    const key = dto.api_key?.trim();
    const data = {
      provider: dto.provider, model: dto.model,
      ...(dto.remove_api_key ? { [keyField]: null } : key ? { [keyField]: this.encrypt(key, dto.provider, { adminId: user.id }) } : {}),
    };
    await this.prisma.aiSettings.upsert({
      where: { admin_id: user.id }, create: { admin_id: user.id, ...data }, update: data,
    });
    return this.get(user);
  }

  async updateResumePrompt(user: AuthUser, value: string | null) {
    this.assertAdmin(user);
    const resume_prompt = validateResumePrompt(value);
    await this.prisma.aiSettings.upsert({
      where: { admin_id: user.id },
      create: { admin_id: user.id, provider: 'openai', model: DEFAULT_AI_MODEL, resume_prompt },
      update: { resume_prompt },
    });
    return this.get(user);
  }

  async updateProfile(user: AuthUser, workspaceId: string, dto: UpdateAiSettingsDto) {
    await this.assertProfileAdmin(user, workspaceId);
    this.validateSelection(dto);
    if (dto.remove_api_key) throw new BadRequestException('Use account defaults to clear this profile override');
    const keyField = KEY_FIELDS[dto.provider];
    const key = dto.api_key?.trim();
    const saved = await this.prisma.profileAiSettings.findUnique({ where: { workspace_id: workspaceId } });
    if (!key && !saved?.[keyField]) throw new BadRequestException('Enter a separate API key for this profile override');
    const data = {
      provider: dto.provider, model: dto.model,
      ...(key ? { [keyField]: this.encrypt(key, dto.provider, { workspaceId }) } : {}),
    };
    if (key) {
      await this.prisma.profileAiSettings.upsert({
        where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId, ...data }, update: data,
      });
    } else {
      // A simultaneous reset must not recreate an override with no key. Keep the currently saved
      // provider key when only the model changes, even if another admin has just rotated it.
      const updated = await this.prisma.profileAiSettings.updateMany({
        where: { workspace_id: workspaceId, [keyField]: { not: null } }, data,
      });
      if (!updated.count) throw new BadRequestException('The profile override changed. Reload AI settings before saving.');
    }
    return this.getProfile(user, workspaceId);
  }

  async resetProfile(user: AuthUser, workspaceId: string) {
    await this.assertProfileAdmin(user, workspaceId);
    await this.prisma.profileAiSettings.deleteMany({ where: { workspace_id: workspaceId } });
    return this.getProfile(user, workspaceId);
  }

  // Call only after workspace access has been checked. An explicit profile override is a complete
  // model/key configuration. Otherwise use the owning admin's current account defaults.
  async forWorkspace(workspaceId: string, providerOverride?: AiProvider): Promise<AiConfiguration> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        aiSettings: true,
        ...ADMIN_SELECT,
      },
    });
    if (!workspace) throw new BadRequestException('Workspace not found');
    const adminId = this.owningAdminId(workspace);
    const account = adminId ? await this.prisma.aiSettings.findUnique({ where: { admin_id: adminId } }) : null;
    const override = workspace.aiSettings;
    const saved = override ?? account;
    const location = override ? 'Dashboard > AI settings for this profile' : "the profile admin's Account > AI generation";
    const provider = providerOverride ?? (saved?.provider as AiProvider);
    const model = providerOverride && saved?.provider !== providerOverride
      ? AI_PROVIDERS[providerOverride].default_model : saved?.model;
    if (!saved || !model) throw new ServiceUnavailableException(`Ask your admin to configure a model and API key in ${location}`);
    if (!findAiModel(provider, model)) throw new BadRequestException('Ask your admin to choose a supported AI model');
    const encrypted = saved[KEY_FIELDS[provider]];
    if (!encrypted) throw new ServiceUnavailableException(`Ask your admin to configure a ${AI_PROVIDERS[provider].name} API key in ${location}`);
    return {
      provider, model,
      apiKey: this.decrypt(encrypted, provider, override
        ? { workspaceId, legacyAdminId: override.legacy_admin_id } : { adminId: adminId! }),
      baseUrl: AI_PROVIDERS[provider].base_url,
      resumePrompt: account?.resume_prompt ?? DEFAULT_RESUME_PROMPT,
    };
  }

  private encryptionKey() {
    const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('The server needs AI_SETTINGS_ENCRYPTION_KEY or JWT_SECRET with at least 32 characters to save API keys');
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(value: string, provider: AiProvider, scope: KeyScope) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const profile = 'workspaceId' in scope;
    cipher.setAAD(Buffer.from(profile ? `profile:${scope.workspaceId}:${provider}` : `${scope.adminId}:${provider}`));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [profile ? 'v2' : 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
  }

  private decrypt(value: string, provider: AiProvider, scope: KeyScope) {
    try {
      const [version, iv, tag, encrypted] = value.split(':');
      const profile = 'workspaceId' in scope;
      const adminId = profile ? scope.legacyAdminId : scope.adminId;
      if (!(version === 'v2' && profile) && !(version === 'v1' && adminId)) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(version === 'v2' && profile ? `profile:${scope.workspaceId}:${provider}` : `${adminId}:${provider}`));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('The saved AI key cannot be read. Ask your admin to save it again.');
    }
  }
}
