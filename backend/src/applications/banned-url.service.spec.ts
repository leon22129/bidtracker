import { BannedUrlService } from './banned-url.service';

describe('BannedUrlService', () => {
  it('matches database patterns case-insensitively', async () => {
    const prisma = {
      bannedUrlPattern: {
        findMany: jest.fn().mockResolvedValue([{ pattern: 'example.com' }, { pattern: 'recruiter' }]),
      },
    };
    const service = new BannedUrlService(prisma as any);

    await expect(service.matches('https://EXAMPLE.com/jobs/123')).resolves.toBe(true);
    await expect(service.matches('https://acme.com/jobs/123')).resolves.toBe(false);
  });
});
