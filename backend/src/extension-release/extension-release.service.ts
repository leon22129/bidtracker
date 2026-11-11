import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateExtensionReleaseDto } from './extension-release.dto';
import { RESUME_BUILDER_VERSION } from './extension-build-version.generated';

@Injectable()
export class ExtensionReleaseService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const release = await this.prisma.extensionRelease.findUnique({ where: { id: 'current' } });
    return {
      latest_version: RESUME_BUILDER_VERSION,
      download_url: release?.download_url ?? null,
      updated_at: release?.updated_at ?? null,
    };
  }

  async update(user: AuthUser, dto: UpdateExtensionReleaseDto) {
    if (user.role !== 'super_admin') throw new ForbiddenException('Only super admins can manage extension releases');
    const data = { latest_version: RESUME_BUILDER_VERSION, download_url: dto.download_url };
    const release = await this.prisma.extensionRelease.upsert({
      where: { id: 'current' },
      create: { id: 'current', ...data },
      update: data,
    });
    return { latest_version: RESUME_BUILDER_VERSION, download_url: release.download_url, updated_at: release.updated_at };
  }
}
