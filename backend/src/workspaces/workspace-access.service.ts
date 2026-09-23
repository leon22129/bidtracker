import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '@prisma/client';

export type AccessLevel = 'none' | 'view' | 'edit';

/**
 * (B) SCOPE authorization — "may this user touch this workspace, and read or write?"
 *
 * Every application/import/analytics endpoint routes through here. Note that callers pass the
 * workspace id derived from the *stored row*, never from the request body, so a user cannot read or
 * move a row by naming a workspace they don't control.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthUser, workspaceId: string): Promise<AccessLevel> {
    if (user.role === 'super_admin') return 'edit';

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, owner_user_id: true, created_by_user_id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (workspace.created_by_user_id === user.id) return 'edit';
    if (user.role !== 'admin' && workspace.owner_user_id === user.id) return 'edit';

    const grant = await this.prisma.workspacePermission.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: user.id } },
      select: { permission_type: true },
    });
    return (grant?.permission_type as AccessLevel) ?? 'none';
  }

  async assertCanView(user: AuthUser, workspaceId: string): Promise<AccessLevel> {
    const level = await this.resolve(user, workspaceId);
    if (level === 'none') {
      // 404, not 403: a junior bidder should not be able to probe which workspace ids exist.
      throw new NotFoundException('Workspace not found');
    }
    return level;
  }

  async assertCanEdit(user: AuthUser, workspaceId: string): Promise<void> {
    const level = await this.assertCanView(user, workspaceId);
    if (level !== 'edit') {
      throw new ForbiddenException('You have view-only access to this workspace');
    }
  }

  /** Reusable relation filter for one-query authorization on workspace-owned records. */
  visibilityWhere(user: AuthUser): Prisma.WorkspaceWhereInput | null {
    if (user.role === 'super_admin') return null;
    return user.role === 'admin'
      ? {
          OR: [
            { created_by_user_id: user.id },
            { permissions: { some: { user_id: user.id } } },
          ],
        }
      : {
          OR: [
            { owner_user_id: user.id },
            { permissions: { some: { user_id: user.id } } },
          ],
        };
  }

  /** Workspace ids the user may read. `null` means "no restriction" (super admin). */
  async visibleWorkspaceIds(user: AuthUser): Promise<string[] | null> {
    const where = this.visibilityWhere(user);
    if (!where) return null;
    const workspaces = await this.prisma.workspace.findMany({ where, select: { id: true } });
    return workspaces.map((workspace) => workspace.id);
  }
}
