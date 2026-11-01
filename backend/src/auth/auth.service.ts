import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, UpdateSlackSettingsDto } from './dto/auth.dto';
import { Role } from '../common/constants';
import { todayUtc } from '../common/utils/date.util';

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

  async slackSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { slack_webhook_url: true, slack_user_id: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      webhook_configured: Boolean(user.slack_webhook_url),
      slack_user_id: user.slack_user_id,
    };
  }

  async updateSlackSettings(userId: string, dto: UpdateSlackSettingsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, slack_webhook_url: true, slack_user_id: true },
    });
    if (!user) throw new UnauthorizedException();

    if (dto.slack_webhook_url !== undefined && !['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Only admins can change the Slack webhook');
    }

    const webhook = dto.slack_webhook_url === undefined
      ? undefined
      : this.normalizeSlackWebhook(dto.slack_webhook_url);
    const slackUserId = dto.slack_user_id === undefined
      ? undefined
      : dto.slack_user_id?.trim() || null;
    const data: Record<string, unknown> = {
      ...(webhook !== undefined ? { slack_webhook_url: webhook } : {}),
      ...(slackUserId !== undefined ? { slack_user_id: slackUserId } : {}),
    };

    // Enabling notifications starts at the next milestone instead of sending old milestones late.
    const resultingWebhook = webhook === undefined ? user.slack_webhook_url : webhook;
    const wasComplete = Boolean(user.slack_webhook_url);
    const willBeComplete = Boolean(resultingWebhook);
    if (!wasComplete && willBeComplete) {
      const day = todayUtc();
      const tomorrow = new Date(day.getTime() + 86_400_000);
      const total = await this.prisma.jobApplication.count({
        where: {
          created_by_user_id: userId,
          application_status: 'Applied',
          created_at: { gte: day, lt: tomorrow },
        },
      });
      data.slack_milestone_day = day;
      data.slack_last_milestone = Math.floor(total / 10) * 10;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { slack_webhook_url: true, slack_user_id: true },
    });
    return {
      webhook_configured: Boolean(updated.slack_webhook_url),
      slack_user_id: updated.slack_user_id,
    };
  }

  private normalizeSlackWebhook(value: string | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'hooks.slack.com' ||
        !url.pathname.startsWith('/services/')
      ) throw new Error();
      return url.toString();
    } catch {
      throw new BadRequestException('Enter a valid Slack incoming webhook URL');
    }
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
