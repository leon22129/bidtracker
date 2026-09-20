import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('blocks deactivated users before issuing a token', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'inactive',
          email: 'inactive@example.com',
          password_hash: 'unused',
          role: 'bidder',
          is_active: false,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      },
    };
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(prisma as never, jwt as never);

    await expect(
      service.login({ email: 'inactive@example.com', password: 'correct-password' }),
    ).rejects.toEqual(new UnauthorizedException('This account has been deactivated'));
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
