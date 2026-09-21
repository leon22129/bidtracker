import { ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  const prisma = {
    workspace: { findUnique: jest.fn(), update: jest.fn() },
    resumeProfile: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const access = {
    assertCanEdit: jest.fn(),
    assertCanView: jest.fn(),
    visibleWorkspaceIds: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows bidder managers to edit export and template settings', async () => {
    const service = new WorkspacesService(prisma as never, access as never);
    prisma.resumeProfile.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.resumeProfile.update.mockResolvedValue({ id: 'p-1' });
    prisma.resumeProfile.findUnique.mockResolvedValue({
      id: 'p-1',
      template: 'modern',
      auto_download: true,
      generate_cover_letter: true,
      cover_letter_template: 'classic',
    });

    await expect(service.updateProfile('p-1', {
      template: 'modern',
      auto_download: true,
      generate_cover_letter: true,
      cover_letter_template: 'classic',
    }, { id: 'u-1', username: 'bm', email: 'bm@example.com', role: 'bidder_manager' })).resolves.toMatchObject({
      template: 'modern',
      auto_download: true,
      generate_cover_letter: true,
      cover_letter_template: 'classic',
    });

    expect(prisma.resumeProfile.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: {
        template: 'modern',
        auto_download: true,
        generate_cover_letter: true,
        cover_letter_template: 'classic',
      },
    });
  });

  it('blocks bidder managers from editing personal profile data', async () => {
    const service = new WorkspacesService(prisma as never, access as never);
    prisma.resumeProfile.findFirst.mockResolvedValue({ id: 'p-1' });

    await expect(service.updateProfile('p-1', {
      full_name: 'New Name',
      career_path: 'Product',
    }, { id: 'u-1', username: 'bm', email: 'bm@example.com', role: 'bidder_manager' })).rejects.toEqual(
      new ForbiddenException('Bidders and bidder managers can only edit resume export and template settings.'),
    );

    expect(prisma.resumeProfile.update).not.toHaveBeenCalled();
  });
});
