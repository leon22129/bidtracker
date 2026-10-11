import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService bidder manager assignments', () => {
  const admin = {
    id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin' as const,
  };

  function setup() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new UsersService(
      prisma as never,
      { deleteForUserOrThrow: jest.fn() } as never,
    );
    return { prisma, service };
  }

  it('allows an admin to assign one of their active bidder managers to a bidder', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'bidder-1', role: 'bidder', created_by_user_id: admin.id,
    });
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'bidder-1' })
      .mockResolvedValueOnce({ id: 'manager-1' });
    prisma.user.update.mockResolvedValue({
      id: 'bidder-1', role: 'bidder', manager_user_id: 'manager-1',
    });

    await expect(service.update('bidder-1', { manager_user_id: 'manager-1' }, admin))
      .resolves.toMatchObject({ manager_user_id: 'manager-1' });
    expect(prisma.user.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'manager-1', role: 'bidder_manager', is_active: true,
        created_by_user_id: admin.id,
      },
      select: { id: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bidder-1' },
      data: expect.objectContaining({ manager_user_id: 'manager-1' }),
    }));
  });

  it('rejects a manager outside the acting admin scope', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'bidder-1', role: 'bidder', created_by_user_id: admin.id,
    });
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'bidder-1' })
      .mockResolvedValueOnce(null);

    await expect(service.update('bidder-1', { manager_user_id: 'other-manager' }, admin))
      .rejects.toEqual(
        new BadRequestException('Manager must be an active bidder manager created by this admin'),
      );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
