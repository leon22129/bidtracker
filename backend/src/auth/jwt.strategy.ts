import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/constants';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
    });
  }

  /**
   * Re-reads the user on every request rather than trusting the token body.
   *
   * That costs one indexed primary-key lookup and buys two things that matter operationally:
   * a deactivated user's existing tokens stop working immediately, and a role change takes effect on
   * the next request instead of after the 7-day expiry.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, role: true, is_active: true },
    });

    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (!user.is_active) throw new UnauthorizedException('Account is deactivated');

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as Role,
    };
  }
}
