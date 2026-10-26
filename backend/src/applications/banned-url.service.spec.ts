import { BannedUrlService } from './banned-url.service';

describe('BannedUrlService', () => {
  it('matches normalized company names without banning unrelated companies', async () => {
    const service = new BannedUrlService({ bannedUrlPattern: {
      findMany: jest.fn().mockResolvedValue([{ pattern: 'omada health' }, { pattern: 'blocked.example' }]),
    } } as any);
    await expect(service.matchesJob('https://jobs.example/new', 'Omada Health, Inc.')).resolves.toBe(true);
    await expect(service.matchesJob('https://jobs.example/new', 'OmadaHealth')).resolves.toBe(true);
    await expect(service.matchesJob('https://blocked.example/new', 'Other')).resolves.toBe(true);
    await expect(service.matchesJob('https://jobs.example/new', 'Health Company')).resolves.toBe(false);
  });
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
