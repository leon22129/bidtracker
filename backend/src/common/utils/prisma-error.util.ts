import { Prisma } from '@prisma/client';

export const ACTIVE_URL_UNIQUE_INDEX = 'job_applications_workspace_active_normalized_url_key';

export function isActiveUrlCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const metadata = JSON.stringify(error.meta ?? {});
  return metadata.includes(ACTIVE_URL_UNIQUE_INDEX) || metadata.includes('normalized_url');
}
