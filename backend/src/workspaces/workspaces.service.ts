import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from './workspace-access.service';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { isAdmin } from '../common/policies/application.policy';
import { ConversationCleanupService } from '../resume/conversation-cleanup.service';
import { todayUtc } from '../common/utils/date.util';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly conversationCleanup: ConversationCleanupService,
  ) {}

  /** Returns only workspaces in the caller's ownership/creator scope. */
  async findAllForUser(user: AuthUser, includeArchived = false) {
    const ids = await this.access.visibleWorkspaceIds(user);

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(includeArchived ? {} : { is_archived: false }),
      },
      include: {
        owner: { select: { id: true, username: true, email: true } },
        _count: { select: { applications: true } },
        resumeProfile: true,
      },
      orderBy: { name: 'asc' },
    });

    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const todayGroups = isAdmin(user.role) && workspaceIds.length
      ? await this.prisma.jobApplication.groupBy({
        by: ['workspace_id', 'created_by_user_id'],
        where: {
          workspace_id: { in: workspaceIds },
          date: todayUtc(),
          application_status: 'Applied',
        },
        _count: { _all: true },
      })
      : [];
    const submitterIds = [...new Set(todayGroups.map((group) => group.created_by_user_id))];
    const submitters = submitterIds.length
      ? await this.prisma.user.findMany({
        where: { id: { in: submitterIds } },
        select: { id: true, username: true },
      })
      : [];
    const usernameById = new Map(submitters.map((submitter) => [submitter.id, submitter.username]));

    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      owner_user_id: w.owner_user_id,
      created_by_user_id: w.created_by_user_id,
      owner: w.owner,
      is_archived: w.is_archived,
      created_at: w.created_at,
      updated_at: w.updated_at,
      profile: w.resumeProfile ? this.toProfile(w.resumeProfile) : null,
      can_edit: user.role === 'super_admin'
        || (user.role === 'admin' && w.created_by_user_id === user.id)
        || (user.role !== 'admin' && w.owner_user_id === user.id),
      application_count: w._count.applications,
      applied_today_by_user: todayGroups
        .filter((group) => group.workspace_id === w.id)
        .map((group) => ({
          user_id: group.created_by_user_id,
          username: usernameById.get(group.created_by_user_id) ?? 'Unknown user',
          count: group._count._all,
        }))
        .sort((a, b) => a.username.localeCompare(b.username)),
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
    if (!['bidder', 'bidder_manager'].includes(owner.role)) {
      throw new BadRequestException('A workspace owner must be a bidder or bidder manager');
    }

    const name = dto.name.trim();
    const clash = await this.prisma.workspace.findUnique({ where: { name } });
    if (clash) throw new ConflictException('A workspace with that name already exists');

    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name,
          owner_user_id: dto.owner_user_id,
          created_by_user_id: user.id,
        },
        include: { owner: { select: { id: true, username: true, email: true } } },
      });
      await tx.resumeProfile.create({ data: { workspace_id: workspace.id, name } });
      return tx.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
        include: {
          owner: { select: { id: true, username: true, email: true } },
          resumeProfile: true,
        },
      });
    });
  }

  async update(id: string, dto: UpdateWorkspaceDto, user: AuthUser) {
    await this.access.assertCanEdit(user, id);
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (
      !isAdmin(user.role) &&
      (dto.owner_user_id !== undefined || dto.is_archived !== undefined)
    ) {
      throw new ForbiddenException('Only an admin can change workspace ownership or archive state');
    }

    const profileData = this.profileData(dto);
    if (dto.profile_name !== undefined || Object.keys(profileData).length) {
      this.assertCanEditProfile(user, dto);
    }

    if (dto.name && dto.name.trim() !== workspace.name) {
      const clash = await this.prisma.workspace.findUnique({ where: { name: dto.name.trim() } });
      if (clash) throw new ConflictException('A workspace with that name already exists');
    }
    if (dto.owner_user_id) {
      const owner = await this.prisma.user.findUnique({ where: { id: dto.owner_user_id } });
      if (!owner) throw new BadRequestException('Owner user does not exist');
      if (!['bidder', 'bidder_manager'].includes(owner.role)) {
        throw new BadRequestException('A workspace owner must be a bidder or bidder manager');
      }
      // Reassignment only changes current workspace/profile ownership. Each application's immutable
      // creator continues to receive credit for both settled and still-unpaid historical work.
    }

    return this.prisma.$transaction(async (tx) => {
      let profile = await tx.resumeProfile.findUnique({ where: { workspace_id: workspace.id } });
      if (!profile) {
        profile = await tx.resumeProfile.create({
          data: { workspace_id: workspace.id, name: `Profile for ${workspace.id}` },
        });
      }
      if (dto.profile_name !== undefined) profileData.name = dto.profile_name.trim();
      if (Object.keys(profileData).length) {
        await tx.resumeProfile.update({ where: { id: profile.id }, data: profileData });
      }
      return tx.workspace.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.owner_user_id !== undefined ? { owner_user_id: dto.owner_user_id } : {}),
          ...(dto.is_archived !== undefined ? { is_archived: dto.is_archived } : {}),
        },
        include: { owner: { select: { id: true, username: true, email: true } }, resumeProfile: true },
      });
    });
  }

  async listProfiles(user: AuthUser) {
    const workspaceIds = await this.access.visibleWorkspaceIds(user);

    return this.prisma.resumeProfile.findMany({
      where: {
        workspace: {
          is_archived: false,
          ...(workspaceIds ? { id: { in: workspaceIds } } : {}),
        },
      },
      include: { workspace: { select: { id: true } } },
      orderBy: { name: 'asc' },
    }).then((profiles) => profiles.map((profile) => this.toProfile(profile)));
  }

  async updateProfile(profileId: string, dto: UpdateWorkspaceDto, user: AuthUser) {
    this.assertCanEditProfile(user, dto);
    const profile = await this.prisma.resumeProfile.findUnique({
      where: { id: profileId },
      select: { id: true, workspace_id: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    await this.access.assertCanEdit(user, profile.workspace_id);

    const data = this.profileData(dto);
    if (Object.keys(data).length) {
      await this.prisma.resumeProfile.update({ where: { id: profileId }, data });
    }
    const updated = await this.prisma.resumeProfile.findUnique({ where: { id: profileId } });
    return this.toProfile(updated);
  }

  private assertCanEditProfile(user: AuthUser, dto: UpdateWorkspaceDto = {}): void {
    if (user.role !== 'bidder' && user.role !== 'bidder_manager') return;

    const data = this.profileData(dto);
    if (dto.profile_name !== undefined) data.name = dto.profile_name;

    const forbidden = Object.keys(data).filter((key) => ![
      'template',
      'save_in_folder',
      'auto_download',
      'download_jd_with_pdf',
      'use_company_name',
      'generate_cover_letter',
      'cover_letter_template',
    ].includes(key));

    if (forbidden.length) {
      throw new ForbiddenException('Bidders and bidder managers can only edit resume export and template settings.');
    }
  }

  async profileForWorkspace(user: AuthUser, workspaceId: string) {
    await this.access.assertCanView(user, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.toProfile(await this.ensureProfile(workspace));
  }

  async ensureProfile(workspace: { id: string; name?: string }) {
    return this.prisma.resumeProfile.upsert({
      where: { workspace_id: workspace.id },
      update: {},
      create: {
        workspace_id: workspace.id,
        name: workspace.name || `Profile for ${workspace.id}`,
      },
    });
  }

  private profileData(dto: UpdateWorkspaceDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [dtoKey, dbKey] of [
      ['career_path', 'career_path'], ['full_name', 'full_name'],
      ['first_name', 'first_name'], ['middle_name', 'middle_name'], ['last_name', 'last_name'],
      ['title', 'title'],
      ['email', 'email'], ['phone', 'phone'], ['location', 'location'], ['country', 'country'],
      ['address1', 'address1'], ['city', 'city'], ['county', 'county'], ['state', 'state'], ['zip', 'zip'],
      ['linkedin', 'linkedin'], ['gender', 'gender'], ['hispanic_latino', 'hispanic_latino'],
      ['ethnicity', 'ethnicity'],
      ['requires_sponsorship', 'requires_sponsorship'], ['legally_authorized_us', 'legally_authorized_us'],
      ['us_work_status', 'us_work_status'],
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
    const fullNameParts = String(profile.full_name || '').trim().split(/\s+/).filter(Boolean);
    const fallbackFirstName = fullNameParts[0] || '';
    const fallbackMiddleName = fullNameParts.length > 2 ? fullNameParts.slice(1, -1).join(' ') : '';
    const fallbackLastName = fullNameParts.length > 1 ? fullNameParts.at(-1) || '' : '';
    return {
      id: profile.id,
      workspace_id: profile.workspace_id,
      name: profile.name,
      career_path: profile.career_path,
      personal_info: {
        fullName: profile.full_name,
        firstName: profile.first_name || fallbackFirstName,
        middleName: profile.middle_name || fallbackMiddleName,
        lastName: profile.last_name || fallbackLastName,
        title: profile.title, email: profile.email,
        phone: profile.phone, location: profile.location, country: profile.country,
        address1: profile.address1, city: profile.city, county: profile.county,
        state: profile.state, zip: profile.zip,
        linkedin: profile.linkedin, gender: profile.gender,
        hispanicLatino: profile.hispanic_latino, ethnicity: profile.ethnicity,
        requiresSponsorship: profile.requires_sponsorship,
        legallyAuthorizedUs: profile.legally_authorized_us,
        usWorkStatus: profile.us_work_status,
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

  /** Cascades to applications, the resume profile, and conversations. Admin-only, irreversible. */
  async remove(id: string, user: AuthUser) {
    await this.access.assertCanEdit(user, id);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    await this.conversationCleanup.deleteForWorkspaceOrThrow(id);
    await this.prisma.workspace.delete({ where: { id } });
    return { success: true, deleted_applications: workspace._count.applications };
  }

}
