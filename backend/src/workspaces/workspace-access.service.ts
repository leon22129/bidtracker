import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '@prisma/client';

/**
 * Workspace scope authorization based on creator/owner relationships plus the manager's read-only
 * relationship to assigned bidders.
 *
 * Every application/import/analytics endpoint routes through here. Note that callers pass the
 * workspace id derived from the *stored row*, never from the request body, so a user cannot read or
 * move a row by naming a workspace they don't control.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private async workspaceAccessRecord(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        owner_user_id: true,
        created_by_user_id: true,
        owner: { select: { manager_user_id: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  private canEditRecord(
    user: AuthUser,
    workspace: { owner_user_id: string; created_by_user_id: string | null },
  ): boolean {
    return user.role === 'super_admin'
      || (user.role === 'admin' && workspace.created_by_user_id === user.id)
      || (user.role !== 'admin' && workspace.owner_user_id === user.id);
  }

  async assertCanView(user: AuthUser, workspaceId: string): Promise<void> {
    const workspace = await this.workspaceAccessRecord(workspaceId);
    const canViewAssignedBidder = user.role === 'bidder_manager'
      && workspace.owner.manager_user_id === user.id;
    if (!this.canEditRecord(user, workspace) && !canViewAssignedBidder) {
      throw new NotFoundException('Workspace not found');
    }
  }

  async assertCanEdit(user: AuthUser, workspaceId: string): Promise<void> {
    const workspace = await this.workspaceAccessRecord(workspaceId);
    if (!this.canEditRecord(user, workspace)) {
      throw new NotFoundException('Workspace not found');
    }
  }

  /** Reusable relation filter for one-query authorization on workspace-owned records. */
  visibilityWhere(user: AuthUser): Prisma.WorkspaceWhereInput | null {
    if (user.role === 'super_admin') return null;
    if (user.role === 'admin') return { created_by_user_id: user.id };
    if (user.role === 'bidder_manager') {
      return {
        OR: [
          { owner_user_id: user.id },
          { owner: { is: { manager_user_id: user.id } } },
        ],
      };
    }
    return { owner_user_id: user.id };
  }

  /** Workspace ids the user may read. `null` means "no restriction" (super admin). */
  async visibleWorkspaceIds(user: AuthUser): Promise<string[] | null> {
    const where = this.visibilityWhere(user);
    if (!where) return null;
    const workspaces = await this.prisma.workspace.findMany({ where, select: { id: true } });
    return workspaces.map((workspace) => workspace.id);
  }
}
