import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from './workspace-access.service';
import { CreateWorkspaceDto, GrantPermissionDto, UpdateWorkspaceDto } from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /**
   * Returns only the workspaces the caller may see, each annotated with the caller's own access
   * level. The frontend's workspace switcher is therefore correct by construction — there is nothing
   * to hide client-side because nothing extra is sent.
   */
  async findAllForUser(user: AuthUser, includeArchived = false) {
    const ids = await this.access.visibleWorkspaceIds(user);

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(includeArchived ? {} : { is_archived: false }),
      },
      include: {
        owner: { select: { id: true, username: true, email: true } },
        permissions: {
          include: { user: { select: { id: true, username: true, role: true } } },
        },
        _count: { select: { applications: true } },
        resumeProfile: true,
      },
      orderBy: { name: 'asc' },
    });

    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      owner_user_id: w.owner_user_id,
      created_by_user_id: w.created_by_user_id,
      owner: w.owner,
      is_archived: w.is_archived,
      created_at: w.created_at,
      updated_at: w.updated_at,
      resume_profile_id: w.resume_profile_id,
      profile: w.resumeProfile ? this.toProfile(w.resumeProfile) : null,
      application_count: w._count.applications,
      my_access:
        user.role === 'super_admin' || w.created_by_user_id === user.id || w.owner_user_id === user.id
          ? 'edit'
          : (w.permissions.find((p) => p.user_id === user.id)?.permission_type ?? 'none'),
      // Grant list is admin-only information: who else can edit this tab.
      permissions:
        user.role === 'admin' || user.role === 'super_admin'
          ? w.permissions.map((p) => ({
              id: p.id,
              user_id: p.user_id,
              username: p.user.username,
              role: p.user.role,
              permission_type: p.permission_type,
            }))
          : undefined,
    }));
  }

  async findOne(user: AuthUser, id: string) {
    await this.access.assertCanView(user, id);
    const all = await this.findAllForUser(user, true);
    const found = all.find((w) => w.id === id);
    if (!found) throw new NotFoundException('Workspace not found');
    return found;
  }

  async create(dto: CreateWorkspaceDto, user: AuthUser) {
    const owner = await this.prisma.user.findUnique({ where: { id: dto.owner_user_id } });
    if (!owner) throw new BadRequestException('Owner user does not exist');

    const name = dto.name.trim();
    const clash = await this.prisma.workspace.findUnique({ where: { name } });
    if (clash) throw new ConflictException('A workspace with that name already exists');

    const profile = await this.prisma.resumeProfile.create({
      data: { user_id: dto.owner_user_id, created_by_user_id: user.id, name },
    });

    return this.prisma.workspace.create({
      data: {
        name,
        owner_user_id: dto.owner_user_id,
        created_by_user_id: user.id,
        resume_profile_id: profile.id,
      },
      include: { owner: { select: { id: true, username: true, email: true } } },
    });
  }

  async update(id: string, dto: UpdateWorkspaceDto, user: AuthUser) {
    await this.access.assertCanEdit(user, id);
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (dto.name && dto.name.trim() !== workspace.name) {
      const clash = await this.prisma.workspace.findUnique({ where: { name: dto.name.trim() } });
      if (clash) throw new ConflictException('A workspace with that name already exists');
    }
    if (dto.owner_user_id) {
      const owner = await this.prisma.user.findUnique({ where: { id: dto.owner_user_id } });
      if (!owner) throw new BadRequestException('Owner user does not exist');
      // Reassigning ownership changes which bidder owns future application reports. Historical
      // PaymentReport rows retain their original bidder.
      // snapshots and intentionally stay as they were.
    }

    const profile = await this.ensureProfile(workspace);
    const profileData = this.profileData(dto);
    if (dto.profile_name !== undefined) profileData.name = dto.profile_name.trim();
    if (Object.keys(profileData).length) {
      await this.prisma.resumeProfile.update({ where: { id: profile.id }, data: profileData });
    }

    return this.prisma.workspace.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.owner_user_id !== undefined ? { owner_user_id: dto.owner_user_id } : {}),
        ...(dto.is_archived !== undefined ? { is_archived: dto.is_archived } : {}),
        ...(dto.resume_profile_id !== undefined ? { resume_profile_id: dto.resume_profile_id } : {}),
      },
      include: { owner: { select: { id: true, username: true, email: true } }, resumeProfile: true },
    });
  }

  async listProfiles(user: AuthUser) {
    const ownership = user.role === 'admin' || user.role === 'super_admin'
      ? { OR: [{ user_id: user.id }, { created_by_user_id: user.id }] }
      : { user_id: user.id };

    return this.prisma.resumeProfile.findMany({
      where: {
        AND: [
          ownership,
          { workspaces: { some: { is_archived: false } } },
        ],
      },
      orderBy: { name: 'asc' },
    }).then((profiles) => profiles.map((profile) => this.toProfile(profile)));
  }

  async updateProfile(profileId: string, dto: UpdateWorkspaceDto, user: AuthUser) {
    const profile = await this.prisma.resumeProfile.findFirst({
      where: {
        id: profileId,
        OR: user.role === 'admin' || user.role === 'super_admin'
          ? [{ user_id: user.id }, { created_by_user_id: user.id }]
          : [{ user_id: user.id }],
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const data = this.profileData(dto);
    if (Object.keys(data).length) {
      await this.prisma.resumeProfile.update({ where: { id: profileId }, data });
    }
    const updated = await this.prisma.resumeProfile.findUnique({ where: { id: profileId } });
    return this.toProfile(updated);
  }

  async profileForWorkspace(user: AuthUser, workspaceId: string) {
    await this.access.assertCanView(user, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.toProfile(await this.ensureProfile(workspace));
  }

  private async ensureProfile(workspace: { id: string; owner_user_id: string; created_by_user_id: string | null; resume_profile_id: string | null }) {
    if (workspace.resume_profile_id) {
      const existing = await this.prisma.resumeProfile.findUnique({ where: { id: workspace.resume_profile_id } });
      if (existing) return existing;
    }
    const profile = await this.prisma.resumeProfile.create({
      data: {
        user_id: workspace.owner_user_id,
        created_by_user_id: workspace.created_by_user_id,
        name: `Profile for ${workspace.id}`,
      },
    });
    await this.prisma.workspace.update({ where: { id: workspace.id }, data: { resume_profile_id: profile.id } });
    return profile;
  }

  private profileData(dto: UpdateWorkspaceDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [dtoKey, dbKey] of [
      ['career_path', 'career_path'], ['full_name', 'full_name'], ['title', 'title'],
      ['email', 'email'], ['phone', 'phone'], ['location', 'location'], ['linkedin', 'linkedin'],
      ['update_headline', 'update_headline'], ['use_generated_role_titles', 'use_generated_role_titles'],
      ['template', 'template'], ['save_in_folder', 'save_in_folder'], ['auto_download', 'auto_download'],
      ['download_jd_with_pdf', 'download_jd_with_pdf'], ['use_company_name', 'use_company_name'],
      ['generate_cover_letter', 'generate_cover_letter'], ['cover_letter_template', 'cover_letter_template'],
    ]) {
      if (dto[dtoKey as keyof UpdateWorkspaceDto] !== undefined) data[dbKey] = dto[dtoKey as keyof UpdateWorkspaceDto];
    }
    if (dto.education !== undefined) data.education_json = JSON.stringify(dto.education);
    if (dto.certifications !== undefined) data.certifications_json = JSON.stringify(dto.certifications);
    return data;
  }

  private toProfile(profile: any) {
    const parse = (value: string) => {
      try { return JSON.parse(value); } catch { return []; }
    };
    return {
      id: profile.id,
      name: profile.name,
      career_path: profile.career_path,
      personal_info: {
        fullName: profile.full_name, title: profile.title, email: profile.email,
        phone: profile.phone, location: profile.location, linkedin: profile.linkedin,
      },
      update_headline: profile.update_headline,
      use_generated_role_titles: profile.use_generated_role_titles,
      template: profile.template,
      save_in_folder: profile.save_in_folder,
      auto_download: profile.auto_download,
      download_jd_with_pdf: profile.download_jd_with_pdf,
      use_company_name: profile.use_company_name,
      generate_cover_letter: profile.generate_cover_letter,
      cover_letter_template: profile.cover_letter_template,
      education: parse(profile.education_json),
      certifications: parse(profile.certifications_json),
    };
  }

  /** Cascades to applications, permissions and weekly reports. Admin-only, irreversible. */
  async remove(id: string, user: AuthUser) {
    await this.access.assertCanEdit(user, id);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    await this.prisma.workspace.delete({ where: { id } });
    return { success: true, deleted_applications: workspace._count.applications };
  }

  async grantPermission(workspaceId: string, dto: GrantPermissionDto, actingUser: AuthUser) {
    await this.assertCanManageSharing(workspaceId, actingUser);
    await this.access.assertCanEdit(actingUser, workspaceId);
    const [workspace, user] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      this.prisma.user.findUnique({ where: { id: dto.user_id } }),
    ]);
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!user) throw new BadRequestException('User does not exist');

    if (workspace.owner_user_id === dto.user_id) {
      throw new BadRequestException('The owner already has full edit access to this workspace');
    }
    if (user.role === 'super_admin') {
      throw new BadRequestException('Super admins already have access to every workspace');
    }

    // Upsert on (workspace_id, user_id): re-granting changes the level instead of duplicating.
    return this.prisma.workspacePermission.upsert({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: dto.user_id } },
      create: {
        workspace_id: workspaceId,
        user_id: dto.user_id,
        permission_type: dto.permission_type,
      },
      update: { permission_type: dto.permission_type },
      include: { user: { select: { id: true, username: true, role: true } } },
    });
  }

  async revokePermission(workspaceId: string, userId: string, user: AuthUser) {
    await this.assertCanManageSharing(workspaceId, user);
    await this.access.assertCanEdit(user, workspaceId);
    const grant = await this.prisma.workspacePermission.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (!grant) throw new NotFoundException('That user has no grant on this workspace');

    await this.prisma.workspacePermission.delete({ where: { id: grant.id } });
    return { success: true };
  }

  private async assertCanManageSharing(workspaceId: string, user: AuthUser) {
    if (user.role === 'super_admin') return;
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { created_by_user_id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.created_by_user_id !== user.id) {
      throw new ForbiddenException('Only the workspace owner admin can manage sharing');
    }
  }
}
