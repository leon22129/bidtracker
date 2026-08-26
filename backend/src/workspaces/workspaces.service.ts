import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
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
      },
      orderBy: { name: 'asc' },
    });

    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      owner_user_id: w.owner_user_id,
      owner: w.owner,
      is_archived: w.is_archived,
      created_at: w.created_at,
      updated_at: w.updated_at,
      application_count: w._count.applications,
      my_access:
        user.role === 'admin' || w.owner_user_id === user.id
          ? 'edit'
          : (w.permissions.find((p) => p.user_id === user.id)?.permission_type ?? 'none'),
      // Grant list is admin-only information: who else can edit this tab.
      permissions:
        user.role === 'admin'
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

  async create(dto: CreateWorkspaceDto) {
    const owner = await this.prisma.user.findUnique({ where: { id: dto.owner_user_id } });
    if (!owner) throw new BadRequestException('Owner user does not exist');

    const name = dto.name.trim();
    const clash = await this.prisma.workspace.findUnique({ where: { name } });
    if (clash) throw new ConflictException('A workspace with that name already exists');

    return this.prisma.workspace.create({
      data: { name, owner_user_id: dto.owner_user_id },
      include: { owner: { select: { id: true, username: true, email: true } } },
    });
  }

  async update(id: string, dto: UpdateWorkspaceDto) {
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

    return this.prisma.workspace.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.owner_user_id !== undefined ? { owner_user_id: dto.owner_user_id } : {}),
        ...(dto.is_archived !== undefined ? { is_archived: dto.is_archived } : {}),
      },
      include: { owner: { select: { id: true, username: true, email: true } } },
    });
  }

  /** Cascades to applications, permissions and weekly reports. Admin-only, irreversible. */
  async remove(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    await this.prisma.workspace.delete({ where: { id } });
    return { success: true, deleted_applications: workspace._count.applications };
  }

  async grantPermission(workspaceId: string, dto: GrantPermissionDto) {
    const [workspace, user] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      this.prisma.user.findUnique({ where: { id: dto.user_id } }),
    ]);
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!user) throw new BadRequestException('User does not exist');

    if (workspace.owner_user_id === dto.user_id) {
      throw new BadRequestException('The owner already has full edit access to this workspace');
    }
    if (user.role === 'admin') {
      throw new BadRequestException('Admins already have access to every workspace');
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

  async revokePermission(workspaceId: string, userId: string) {
    const grant = await this.prisma.workspacePermission.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (!grant) throw new NotFoundException('That user has no grant on this workspace');

    await this.prisma.workspacePermission.delete({ where: { id: grant.id } });
    return { success: true };
  }
}
