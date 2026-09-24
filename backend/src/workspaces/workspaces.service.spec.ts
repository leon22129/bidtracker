import { ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  const prisma = {
    workspace: { findUnique: jest.fn(), update: jest.fn() },
    resumeProfile: { update: jest.fn(), findUnique: jest.fn() },
  };
  const access = {
    assertCanEdit: jest.fn(),
    assertCanView: jest.fn(),
    visibleWorkspaceIds: jest.fn(),
  };
  const conversationCleanup = { deleteForWorkspaceOrThrow: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('allows bidder managers to edit export and template settings', async () => {
    const service = new WorkspacesService(prisma as never, access as never, conversationCleanup as never);
    prisma.resumeProfile.update.mockResolvedValue({ id: 'p-1' });
    prisma.resumeProfile.findUnique.mockResolvedValue({
      id: 'p-1', workspace_id: 'w-1', template: 'modern', auto_download: true,
      generate_cover_letter: true, cover_letter_template: 'classic',
    });

    await expect(service.updateProfile('p-1', {
      template: 'modern', auto_download: true,
      generate_cover_letter: true, cover_letter_template: 'classic',
    }, { id: 'u-1', username: 'bm', email: 'bm@example.com', role: 'bidder_manager' })).resolves.toMatchObject({
      template: 'modern', auto_download: true,
      generate_cover_letter: true, cover_letter_template: 'classic',
    });

    expect(access.assertCanEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }), 'w-1',
    );
    expect(prisma.resumeProfile.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: {
        template: 'modern', auto_download: true,
        generate_cover_letter: true, cover_letter_template: 'classic',
      },
    });
  });

  it('blocks bidder managers from editing personal profile data', async () => {
    const service = new WorkspacesService(prisma as never, access as never, conversationCleanup as never);

    await expect(service.updateProfile('p-1', {
      full_name: 'New Name', career_path: 'Product',
    }, { id: 'u-1', username: 'bm', email: 'bm@example.com', role: 'bidder_manager' })).rejects.toEqual(
      new ForbiddenException('Bidders and bidder managers can only edit resume export and template settings.'),
    );

    expect(prisma.resumeProfile.update).not.toHaveBeenCalled();
  });

  it('blocks non-admin users from changing workspace ownership', async () => {
    const service = new WorkspacesService(prisma as never, access as never, conversationCleanup as never);
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'w-1', name: 'Workspace', owner_user_id: 'u-1',
    });

    await expect(service.update('w-1', { owner_user_id: 'u-2' }, {
      id: 'u-1', username: 'bidder', email: 'bidder@example.com', role: 'bidder',
    })).rejects.toEqual(
      new ForbiddenException('Only an admin can change workspace ownership or archive state'),
    );

    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('keeps the workspace-owned profile during workspace owner reassignment', async () => {
    const profile = { id: 'profile-1', workspace_id: 'workspace-1', name: 'Workspace profile' };
    const tx = {
      resumeProfile: {
        findUnique: jest.fn().mockResolvedValue(profile), create: jest.fn(), update: jest.fn(),
      },
      workspace: { update: jest.fn().mockResolvedValue({ id: 'workspace-1' }) },
    };
    const localPrisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({
        id: 'workspace-1', name: 'Workspace', owner_user_id: 'old-owner',
        created_by_user_id: 'admin-1',
      }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'new-owner', role: 'bidder' }) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new WorkspacesService(
      localPrisma as never, access as never, conversationCleanup as never,
    );

    await service.update('workspace-1', { owner_user_id: 'new-owner' }, {
      id: 'admin-1', username: 'admin', email: 'admin@example.com', role: 'admin',
    });

    expect(tx.resumeProfile.create).not.toHaveBeenCalled();
    expect(tx.resumeProfile.update).not.toHaveBeenCalled();
    expect(tx.workspace.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ owner_user_id: 'new-owner' }),
    }));
  });
});
