import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AI_CATALOG, AiProvider, findAiModel } from './ai-catalog';
import { UpdateAiSettingsDto } from './ai-settings.dto';
import { DEFAULT_RESUME_PROMPT, RESUME_PROMPT_MAX_LENGTH, RESUME_PROMPT_VARIABLES, validateResumePrompt } from './resume-prompt';

export const DEFAULT_AI_MODEL = 'gpt-6.1-sol';

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
      provider: saved?.provider || 'openai', model: saved?.model || DEFAULT_AI_MODEL,
      resume_prompt: saved?.resume_prompt ?? DEFAULT_RESUME_PROMPT,
      default_resume_prompt: DEFAULT_RESUME_PROMPT,
      resume_prompt_customized: Boolean(saved?.resume_prompt),
      resume_prompt_variables: RESUME_PROMPT_VARIABLES,
      resume_prompt_max_length: RESUME_PROMPT_MAX_LENGTH,
      keys: {
        openai: { saved: Boolean(saved?.openai_key), configured: Boolean(saved?.openai_key) },
        deepseek: { saved: Boolean(saved?.deepseek_key), configured: Boolean(saved?.deepseek_key) },
      },
      ...AI_CATALOG,
    };
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

  async update(user: AuthUser, dto: UpdateAiSettingsDto) {
    this.assertAdmin(user);
    if (!findAiModel(dto.provider, dto.model)) throw new BadRequestException('Choose a supported model for this AI platform');
    if (dto.api_key && dto.remove_api_key) throw new BadRequestException('Enter a key or remove it, not both');
    const keyField = dto.provider === 'openai' ? 'openai_key' : 'deepseek_key';
    const key = dto.api_key?.trim();
    const data = {
      provider: dto.provider, model: dto.model,
      ...(dto.remove_api_key ? { [keyField]: null } : key ? { [keyField]: this.encrypt(key, user.id, dto.provider) } : {}),
    };
    await this.prisma.aiSettings.upsert({
      where: { admin_id: user.id }, create: { admin_id: user.id, ...data }, update: data,
    });
    return this.get(user);
  }

  // Call only after the caller has checked access to the workspace. The stored creator determines
  // the billing account, including when a super admin operates another admin's workspace.
  async forWorkspace(workspaceId: string, providerOverride?: AiProvider): Promise<AiConfiguration> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        creator: { select: { id: true, role: true } },
        owner: { select: { id: true, role: true, creator: { select: { id: true, role: true } } } },
      },
    });
    if (!workspace) throw new BadRequestException('Workspace not found');
    const admin = [workspace.creator, workspace.owner, workspace.owner.creator]
      .find((candidate) => candidate && ['admin', 'super_admin'].includes(candidate.role));
    if (!admin) throw new ServiceUnavailableException('This profile needs an owning admin with AI settings');
    return this.forAdmin(admin.id, providerOverride);
  }

  // Internal provider access; public routes never return this object or accept an arbitrary admin id.
  async forAdmin(adminId: string, providerOverride?: AiProvider): Promise<AiConfiguration> {
    const saved = await this.prisma.aiSettings.findUnique({ where: { admin_id: adminId } });
    const provider = providerOverride ?? (saved?.provider as AiProvider);
    const model = providerOverride && saved?.provider !== providerOverride
      ? (providerOverride === 'openai' ? DEFAULT_AI_MODEL : 'deepseek-flash') : saved?.model;
    if (!saved || !model) throw new ServiceUnavailableException('Ask your admin to configure their own API key in Account > AI generation');
    if (!findAiModel(provider, model)) throw new BadRequestException('Ask your admin to choose a supported AI model');
    const encrypted = provider === 'openai' ? saved.openai_key : saved.deepseek_key;
    if (!encrypted) throw new ServiceUnavailableException(`Ask your admin to configure their own ${provider === 'openai' ? 'OpenAI' : 'DeepSeek'} API key in Account > AI generation`);
    return {
      provider, model,
      apiKey: this.decrypt(encrypted, adminId, provider),
      baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com',
      resumePrompt: saved.resume_prompt ?? DEFAULT_RESUME_PROMPT,
    };
  }

  private encryptionKey() {
    const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('The server needs AI_SETTINGS_ENCRYPTION_KEY or JWT_SECRET with at least 32 characters to save API keys');
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(value: string, adminId: string, provider: AiProvider) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`${adminId}:${provider}`));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
  }

  private decrypt(value: string, adminId: string, provider: AiProvider) {
    try {
      const [version, iv, tag, encrypted] = value.split(':');
      if (version !== 'v1') throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(`${adminId}:${provider}`));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('The saved AI key cannot be read. Ask your admin to save it again.');
    }
  }
}
