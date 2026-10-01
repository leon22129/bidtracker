import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BannedUrlService {
  private cache: { expiresAt: number; patterns: string[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.bannedUrlPattern.findMany({
      orderBy: { pattern: 'asc' },
      include: { createdByUser: { select: { username: true } } },
    });
  }

  async create(pattern: string, userId: string) {
    const normalized = normalizePattern(pattern);
    const existing = await this.prisma.bannedUrlPattern.findUnique({ where: { pattern: normalized } });
    if (existing) throw new ConflictException('That banned URL pattern already exists');
    const created = await this.prisma.bannedUrlPattern.create({
      data: { pattern: normalized, created_by_user_id: userId },
    });
    this.cache = null;
    return created;
  }

  async remove(id: string) {
    const result = await this.prisma.bannedUrlPattern.deleteMany({ where: { id } });
    if (!result.count) throw new NotFoundException('Banned URL pattern not found');
    this.cache = null;
    return { success: true };
  }

  async matches(url: string): Promise<boolean> {
    const value = url.trim().toLowerCase();
    if (!value) return false;
    const patterns = await this.patterns();
    return patterns.some((pattern) => value.includes(pattern));
  }

  async matchMany(urls: string[]): Promise<boolean[]> {
    const patterns = await this.patterns();
    return urls.map((url) => {
      const value = url.trim().toLowerCase();
      return Boolean(value) && patterns.some((pattern) => value.includes(pattern));
    });
  }

  private async patterns() {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.patterns;
    const rows = await this.prisma.bannedUrlPattern.findMany({ select: { pattern: true } });
    const patterns = rows.map((row) => row.pattern);
    this.cache = { patterns, expiresAt: Date.now() + 30_000 };
    return patterns;
  }
}

export function normalizePattern(value: string): string {
  return value.trim().toLowerCase();
}
