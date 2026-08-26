import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/auth.service';

/**
 * Creates the default superadmin on first boot.
 *
 * Idempotency rule: the account is created only when there is NO elevated account at all. That means restarts,
 * container recreation, and rolling deploys can never produce a second default admin, and — crucially —
 * changing the admin's password does not cause it to be reset on the next restart (which a naive
 * "upsert by email" implementation would do, silently reverting a password change).
 *
 * Credentials come from env only. They are never logged and never exposed by any endpoint.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminBootstrap');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const email = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
    const username = process.env.DEFAULT_ADMIN_USERNAME?.trim();
    const password = process.env.DEFAULT_ADMIN_PASSWORD;

    if (!email || !username || !password) {
      this.logger.error(
        'DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD ' +
          'are not all set. Nobody can log in. Set them in .env and restart.',
      );
      return;
    }
    if (password.length < 8) {
      this.logger.error('DEFAULT_ADMIN_PASSWORD must be at least 8 characters. Admin not created.');
      return;
    }

    // A pre-existing non-admin row could hold the email/username; promote rather than crash-loop.
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (clash) {
      if (clash.role !== 'super_admin') {
        await this.prisma.user.update({
          where: { id: clash.id },
          data: { role: 'super_admin', is_active: true },
        });
      }
      this.logger.warn(
        `Existing user "${clash.username}" matched the configured default admin identity and was ` +
          'promoted to superadmin (password left unchanged).',
      );
      return;
    }

    const existingAdmins = await this.prisma.user.count({ where: { role: { in: ['admin', 'super_admin'] } } });
    if (existingAdmins > 0) {
      this.logger.log(`Elevated account present (${existingAdmins}); skipping bootstrap.`);
      return;
    }

    await this.prisma.user.create({
      data: {
        email,
        username,
        role: 'super_admin',
        password_hash: await hashPassword(password),
      },
    });

    // Log the identity, never the secret.
    this.logger.log(`Default superadmin created: ${username} <${email}>. Change the password after login.`);
  }
}
