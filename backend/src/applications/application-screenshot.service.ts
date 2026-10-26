import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const SCREENSHOT_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function assertScreenshotFile(file?: Express.Multer.File) {
  if (!file?.buffer || file.buffer.length < 24 || !file.buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    || file.buffer.toString('ascii', 12, 16) !== 'IHDR'
    || file.buffer.readUInt32BE(16) === 0 || file.buffer.readUInt32BE(20) === 0) {
    throw new BadRequestException('A valid PNG screenshot is required');
  }
}

export function screenshotDates() {
  const captured_at = new Date();
  return { captured_at, expires_at: new Date(captured_at.getTime() + SCREENSHOT_RETENTION_MS) };
}

@Injectable()
export class ApplicationScreenshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async save(user: AuthUser, applicationId: string, file?: Express.Multer.File) {
    assertScreenshotFile(file);
    const application = await this.prisma.jobApplication.findUnique({
      where: { id: applicationId },
      select: { workspace_id: true, created_by_user_id: true },
    });
    if (!application || application.created_by_user_id !== user.id) {
      throw new NotFoundException('Application not found');
    }
    await this.access.assertCanEdit(user, application.workspace_id);

    const capturedAt = new Date();
    const expiresAt = new Date(capturedAt.getTime() + SCREENSHOT_RETENTION_MS);
    const screenshot = await this.prisma.applicationScreenshot.upsert({
      where: { application_id: applicationId },
      create: {
        application_id: applicationId,
        image_data: file!.buffer,
        content_type: 'image/png',
        captured_at: capturedAt,
        expires_at: expiresAt,
      },
      update: {
        image_data: file!.buffer,
        content_type: 'image/png',
        captured_at: capturedAt,
        expires_at: expiresAt,
      },
      select: { captured_at: true, expires_at: true },
    });
    return { saved: true, ...screenshot };
  }

  async get(user: AuthUser, applicationId: string) {
    const workspaceWhere = this.access.visibilityWhere(user);
    const screenshot = await this.prisma.applicationScreenshot.findFirst({
      where: {
        application_id: applicationId,
        expires_at: { gt: new Date() },
        ...(workspaceWhere ? { application: { workspace: workspaceWhere } } : {}),
      },
      select: { image_data: true, content_type: true, captured_at: true, expires_at: true },
    });
    if (!screenshot) throw new NotFoundException('Screenshot not found or has expired');
    return screenshot;
  }
}
