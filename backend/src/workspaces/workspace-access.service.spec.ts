import { NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WorkspaceAccessService } from './workspace-access.service';

describe('WorkspaceAccessService', () => {
  const prisma = {
    workspace: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const user = (id: string, role: AuthUser['role']): AuthUser => ({
    id,
    role,
    username: id,
    email: `${id}@example.com`,
  });

  beforeEach(() => jest.clearAllMocks());

  it('allows a bidder to read and edit only their owned workspace', async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', owner_user_id: 'bidder-1', created_by_user_id: 'admin-1',
      owner: { manager_user_id: null },
    });
    const service = new WorkspaceAccessService(prisma as never);

    await expect(service.assertCanView(user('bidder-1', 'bidder'), 'w-1')).resolves.toBeUndefined();
    await expect(service.assertCanEdit(user('bidder-1', 'bidder'), 'w-1')).resolves.toBeUndefined();
    await expect(service.assertCanView(user('bidder-2', 'bidder'), 'w-1')).rejects.toEqual(
      new NotFoundException('Workspace not found'),
    );
  });

  it('allows an admin only on workspaces they created', async () => {
    const service = new WorkspaceAccessService(prisma as never);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', owner_user_id: 'bidder-1', created_by_user_id: 'admin-1',
      owner: { manager_user_id: null },
    });

    await expect(service.assertCanEdit(user('admin-1', 'admin'), 'w-1')).resolves.toBeUndefined();
    await expect(service.assertCanEdit(user('admin-2', 'admin'), 'w-1')).rejects.toEqual(
      new NotFoundException('Workspace not found'),
    );
  });

  it('allows super-admin globally and builds ownership-only visibility filters', async () => {
    const service = new WorkspaceAccessService(prisma as never);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', owner_user_id: 'bidder-1', created_by_user_id: 'admin-1',
      owner: { manager_user_id: null },
    });

    await expect(service.assertCanEdit(user('root', 'super_admin'), 'w-1')).resolves.toBeUndefined();
    expect(service.visibilityWhere(user('root', 'super_admin'))).toBeNull();
    expect(service.visibilityWhere(user('admin-1', 'admin'))).toEqual({ created_by_user_id: 'admin-1' });
    expect(service.visibilityWhere(user('bidder-1', 'bidder'))).toEqual({ owner_user_id: 'bidder-1' });
  });

  it('lets a bidder manager view assigned bidder workspaces but not edit them', async () => {
    const service = new WorkspaceAccessService(prisma as never);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', owner_user_id: 'bidder-1', created_by_user_id: 'admin-1',
      owner: { manager_user_id: 'manager-1' },
    });

    await expect(service.assertCanView(user('manager-1', 'bidder_manager'), 'w-1'))
      .resolves.toBeUndefined();
    await expect(service.assertCanEdit(user('manager-1', 'bidder_manager'), 'w-1'))
      .rejects.toEqual(new NotFoundException('Workspace not found'));
    await expect(service.assertCanView(user('manager-2', 'bidder_manager'), 'w-1'))
      .rejects.toEqual(new NotFoundException('Workspace not found'));

    expect(service.visibilityWhere(user('manager-1', 'bidder_manager'))).toEqual({
      OR: [
        { owner_user_id: 'manager-1' },
        { manager_user_id: 'manager-1' },
        { owner: { is: { manager_user_id: 'manager-1' } } },
      ],
    });
  });

  it('lets a bidder manager view a profile explicitly assigned by an admin', async () => {
    const service = new WorkspaceAccessService(prisma as never);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', owner_user_id: 'bidder-2', manager_user_id: 'manager-1',
      created_by_user_id: 'admin-1', owner: { manager_user_id: 'manager-2' },
    });

    await expect(service.assertCanView(user('manager-1', 'bidder_manager'), 'w-1'))
      .resolves.toBeUndefined();
    await expect(service.assertCanEdit(user('manager-1', 'bidder_manager'), 'w-1'))
      .rejects.toEqual(new NotFoundException('Workspace not found'));
  });
});
