import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '@prisma/client';

/**
 * Workspace scope authorization based only on creator/owner relationships.
 *
 * Every application/import/analytics endpoint routes through here. Note that callers pass the
 * workspace id derived from the *stored row*, never from the request body, so a user cannot read or
 * move a row by naming a workspace they don't control.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertHasAccess(user: AuthUser, workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, owner_user_id: true, created_by_user_id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const allowed = user.role === 'super_admin'
      || (user.role === 'admin' && workspace.created_by_user_id === user.id)
      || (user.role !== 'admin' && workspace.owner_user_id === user.id);
    if (!allowed) throw new NotFoundException('Workspace not found');
  }

  async assertCanView(user: AuthUser, workspaceId: string): Promise<void> {
    await this.assertHasAccess(user, workspaceId);
  }

  async assertCanEdit(user: AuthUser, workspaceId: string): Promise<void> {
    await this.assertHasAccess(user, workspaceId);
  }

  /** Reusable relation filter for one-query authorization on workspace-owned records. */
  visibilityWhere(user: AuthUser): Prisma.WorkspaceWhereInput | null {
    if (user.role === 'super_admin') return null;
    return user.role === 'admin'
      ? { created_by_user_id: user.id }
      : { owner_user_id: user.id };
  }

  /** Workspace ids the user may read. `null` means "no restriction" (super admin). */
  async visibleWorkspaceIds(user: AuthUser): Promise<string[] | null> {
    const where = this.visibilityWhere(user);
    if (!where) return null;
    const workspaces = await this.prisma.workspace.findMany({ where, select: { id: true } });
    return workspaces.map((workspace) => workspace.id);
  }
}
