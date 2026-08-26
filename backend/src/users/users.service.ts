import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/auth.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto/user.dto';

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
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        ...PUBLIC_SELECT,
        _count: { select: { ownedWorkspaces: true, permissions: true } },
      },
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
    });
    return users.map(({ _count, ...u }) => ({
      ...u,
      owned_workspace_count: _count.ownedWorkspaces,
      granted_workspace_count: _count.permissions,
    }));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...PUBLIC_SELECT,
        ownedWorkspaces: { select: { id: true, name: true } },
        permissions: {
          select: { permission_type: true, workspace: { select: { id: true, name: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();

    await this.assertUnique(email, username);

    return this.prisma.user.create({
      data: {
        username,
        email,
        password_hash: await hashPassword(dto.password),
        role: dto.role,
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    // Guard rails against an admin locking themselves out of their own instance.
    if (id === actingUserId && dto.role && dto.role !== 'admin') {
      throw new BadRequestException('You cannot remove your own admin role');
    }
    if (id === actingUserId && dto.is_active === false) {
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

  async resetPassword(id: string, dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { password_hash: await hashPassword(dto.new_password) },
    });
    return { success: true };
  }

  /**
   * Hard delete. Blocked when the user owns a workspace — payment attribution flows through
   * `Workspace.owner_user_id`, so deleting an owner would destroy the audit trail for money already
   * paid. Deactivate instead; the FK is `onDelete: Restrict` as a second line of defence.
   */
  async remove(id: string, actingUserId: string) {
    if (id === actingUserId) throw new BadRequestException('You cannot delete your own account');

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { ownedWorkspaces: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user._count.ownedWorkspaces > 0) {
      throw new BadRequestException(
        'This user owns one or more workspaces and cannot be deleted (payment history depends on ' +
          'workspace ownership). Reassign the workspaces or deactivate the user instead.',
      );
    }
    if (user.role === 'admin') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'admin', is_active: true, id: { not: id } },
      });
      if (otherAdmins === 0) throw new BadRequestException('At least one active admin must remain');
    }

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
}
