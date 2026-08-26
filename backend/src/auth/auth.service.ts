import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { Role } from '../common/constants';

export const BCRYPT_ROUNDS = 10;

/** The only place in the codebase that hashes or compares a password. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Identical error for "no such user" and "wrong password" so the endpoint can't be used to
    // enumerate which emails exist.
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) {
      // Constant-ish work even on the miss path, to avoid a timing oracle.
      await bcrypt.compare(dto.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      throw invalid;
    }
    if (!user.is_active) throw new UnauthorizedException('This account has been deactivated');

    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) throw invalid;

    return {
      access_token: await this.signToken(user),
      user: this.toPublicUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toPublicUser(user);
  }

  async changeOwnPassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.current_password, user.password_hash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash: await hashPassword(dto.new_password) },
    });
    return { success: true };
  }

  private signToken(user: { id: string; email: string; username: string; role: string }) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as Role,
    });
  }

  /** Whitelist projection — `password_hash` can only leak if someone adds it here deliberately. */
  private toPublicUser(user: {
    id: string; username: string; email: string; role: string;
    is_active: boolean; created_at: Date; updated_at: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as Role,
      is_active: user.is_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
