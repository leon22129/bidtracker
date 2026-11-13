import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateUserDto } from './dto/user.dto';
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
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new UsersService(
      prisma as never,
      { deleteForUserOrThrow: jest.fn() } as never,
    );
    return { prisma, service };
  }

  it.each(['bidder', 'bidder_manager'])('allows admins to grant and revoke Continue for a %s', async (role) => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'target', role });
    prisma.user.findFirst.mockResolvedValue({ id: 'target' });
    for (const enabled of [true, false]) {
      await service.update('target', { can_continue_after_eligibility_failure: enabled }, admin);
      expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({ can_continue_after_eligibility_failure: enabled }),
        select: expect.objectContaining({ can_continue_after_eligibility_failure: true }),
      }));
    }
  });

  it('prevents a manager from granting Continue to their own bidder', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'target', role: 'bidder' });
    prisma.user.findFirst.mockResolvedValue({ id: 'target' });
    await expect(service.update('target', { can_continue_after_eligibility_failure: true }, {
      ...admin, role: 'bidder_manager',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('prevents admins from enabling Continue outside their account', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'target', role: 'bidder' });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.update('target', { can_continue_after_eligibility_failure: true }, admin))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not grant the bidder permission to an admin account', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'target', role: 'admin' });
    await expect(service.update('target', { can_continue_after_eligibility_failure: true }, {
      ...admin, role: 'super_admin',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([null, 'true', 1])('rejects a non-boolean Continue permission: %s', (value) => {
    const errors = validateSync(plainToInstance(UpdateUserDto, { can_continue_after_eligibility_failure: value }));
    expect(errors.some((error) => error.property === 'can_continue_after_eligibility_failure')).toBe(true);
  });

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

  it('allocates a bidder created by a bidder manager to that manager', async () => {
    const { service } = setup();
    const manager = {
      id: 'manager-1', username: 'manager', email: 'manager@example.com', role: 'bidder_manager' as const,
    };

    await expect((service as any).validateManagerAssignment('bidder', manager.id, manager))
      .resolves.toBe(manager.id);
  });

  it('lets a bidder manager deactivate only an allocated bidder', async () => {
    const { prisma, service } = setup();
    const manager = {
      id: 'manager-1', username: 'manager', email: 'manager@example.com', role: 'bidder_manager' as const,
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'bidder-1', role: 'bidder' });
    prisma.user.findFirst.mockResolvedValue({ id: 'bidder-1' });
    prisma.user.update.mockResolvedValue({ id: 'bidder-1', is_active: false });

    await expect(service.update('bidder-1', { is_active: false }, manager))
      .resolves.toMatchObject({ is_active: false });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bidder-1' }, data: { is_active: false },
    }));
  });
});
