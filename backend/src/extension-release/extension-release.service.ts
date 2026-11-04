import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateExtensionReleaseDto } from './extension-release.dto';
import { DEFAULT_RESUME_BUILDER_MIN_VERSION, versionParts } from './extension-version';

@Injectable()
export class ExtensionReleaseService {
  private readonly fallbackVersion: string;

  constructor(private readonly prisma: PrismaService) {
    this.fallbackVersion = process.env.RESUME_BUILDER_MIN_VERSION?.trim() || DEFAULT_RESUME_BUILDER_MIN_VERSION;
    if (!versionParts(this.fallbackVersion)) {
      throw new Error('RESUME_BUILDER_MIN_VERSION must contain three or four numeric version components (for example 0.9.3).');
    }
  }

  async get() {
    const release = await this.prisma.extensionRelease.findUnique({ where: { id: 'current' } });
    return {
      latest_version: release?.latest_version ?? this.fallbackVersion,
      download_url: release?.download_url ?? null,
      updated_at: release?.updated_at ?? null,
    };
  }

  async update(user: AuthUser, dto: UpdateExtensionReleaseDto) {
    if (user.role !== 'super_admin') throw new ForbiddenException('Only super admins can manage extension releases');
    if (!versionParts(dto.latest_version)) {
      throw new BadRequestException('Version must have three or four numeric components between 0 and 65535.');
    }
    const data = { latest_version: dto.latest_version, download_url: dto.download_url };
    const release = await this.prisma.extensionRelease.upsert({
      where: { id: 'current' },
      create: { id: 'current', ...data },
      update: data,
    });
    return { latest_version: release.latest_version, download_url: release.download_url, updated_at: release.updated_at };
  }
}
