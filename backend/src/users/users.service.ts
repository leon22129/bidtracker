import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/auth.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto/user.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ConversationCleanupService } from '../resume/conversation-cleanup.service';

/** Fields returned to clients. `password_hash` is absent by construction, not by filtering. */
const PUBLIC_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationCleanup: ConversationCleanupService,
  ) {}

  async findAll(actingUser: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: this.visibilityWhere(actingUser),
      select: {
        ...PUBLIC_SELECT,
        _count: { select: { ownedWorkspaces: true } },
      },
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
    });
    return users.map(({ _count, ...u }) => ({
      ...u,
      owned_workspace_count: _count.ownedWorkspaces,
    }));
  }

  async findOne(id: string, actingUser: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...PUBLIC_SELECT,
        ownedWorkspaces: { select: { id: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.assertCanManage(id, actingUser);
    return user;
  }

  async create(dto: CreateUserDto, actingUser: AuthUser) {
    const allowedRoles = actingUser.role === 'super_admin'
      ? ['admin']
      : ['bidder', 'bidder_manager'];
    if (!allowedRoles.includes(dto.role)) {
      throw new BadRequestException(
        actingUser.role === 'super_admin'
          ? 'Super admins can only add admins'
          : 'Admins can only add bidders and bidder managers',
      );
    }
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();

    await this.assertUnique(email, username);

    return this.prisma.user.create({
      data: {
        username,
        email,
        password_hash: await hashPassword(dto.password),
        role: dto.role,
        created_by_user_id: actingUser.role === 'super_admin' ? null : actingUser.id,
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto, actingUser: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.assertCanManage(id, actingUser);

    if (dto.role) {
      const allowedRoles = actingUser.role === 'super_admin'
        ? ['admin']
        : ['bidder', 'bidder_manager'];
      if (!allowedRoles.includes(dto.role)) {
        throw new BadRequestException(
          actingUser.role === 'super_admin'
            ? 'Super admins can only assign the admin role'
            : 'Admins can only assign bidder and bidder manager roles',
        );
      }
    }

    // Guard rails against an admin locking themselves out of their own instance.
    if (id === actingUser.id && dto.role && dto.role !== 'admin' && dto.role !== 'super_admin') {
      throw new BadRequestException('You cannot remove your own admin role');
    }
    if (id === actingUser.id && dto.is_active === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (user.role === 'admin' && (dto.role && dto.role !== 'admin' || dto.is_active === false)) {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'admin', is_active: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('At least one active admin must remain');
      }
    }

    const email = dto.email?.trim().toLowerCase();
    const username = dto.username?.trim();
    await this.assertUnique(email, username, id);

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(username !== undefined ? { username } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      },
      select: PUBLIC_SELECT,
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actingUser: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.assertCanManage(id, actingUser);

    await this.prisma.user.update({
      where: { id },
      data: { password_hash: await hashPassword(dto.new_password) },
    });
    return { success: true };
  }

  /**
   * Hard delete. Blocked when the user owns a workspace or created applications, because both are
   * part of the payment audit trail. Deactivate instead; restrictive FKs are the second line of defence.
   */
  async remove(id: string, actingUser: AuthUser) {
    if (id === actingUser.id) throw new BadRequestException('You cannot delete your own account');

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { ownedWorkspaces: true, createdApplications: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.assertCanManage(id, actingUser);

    if (user._count.ownedWorkspaces > 0) {
      throw new BadRequestException(
        'This user owns one or more workspaces and cannot be deleted. Reassign the workspaces or ' +
          'deactivate the user instead.',
      );
    }
    if (user._count.createdApplications > 0) {
      throw new BadRequestException(
        'This user created applications and cannot be deleted because payment attribution depends ' +
          'on that history. Deactivate the user instead.',
      );
    }
    if (user.role === 'admin') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'admin', is_active: true, id: { not: id } },
      });
      if (otherAdmins === 0) throw new BadRequestException('At least one active admin must remain');
    }

    await this.conversationCleanup.deleteForUserOrThrow(id);
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  private async assertUnique(email?: string, username?: string, exceptId?: string) {
    if (email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== exceptId) {
        throw new ConflictException('That email is already in use');
      }
    }
    if (username) {
      const existing = await this.prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== exceptId) {
        throw new ConflictException('That username is already taken');
      }
    }
  }

  private visibilityWhere(actingUser: AuthUser) {
    if (actingUser.role === 'super_admin') return undefined;
    return {
      role: { in: ['bidder', 'bidder_manager'] },
      created_by_user_id: actingUser.id,
    };
  }

  private async assertCanManage(userId: string, actingUser: AuthUser) {
    if (actingUser.role === 'super_admin') return;
    const visible = await this.prisma.user.findFirst({
      where: { id: userId, ...this.visibilityWhere(actingUser) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('User not found');
  }
}
