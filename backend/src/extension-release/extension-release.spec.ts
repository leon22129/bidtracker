import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ResumeBuilderVersionGuard } from '../common/guards/resume-builder-version.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ExtensionReleaseModule } from './extension-release.module';
import { ExtensionReleaseService } from './extension-release.service';

describe('Extension release settings over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let saved: any = null;
  const previousMinimum = process.env.RESUME_BUILDER_MIN_VERSION;
  const prisma = {
    extensionRelease: {
      findUnique: jest.fn(async () => saved),
      upsert: jest.fn(async ({ create, update }) => {
        saved = { ...(saved ?? create), ...update, updated_at: new Date() };
        return saved;
      }),
    },
    user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, username: where.id, email: `${where.id}@example.com`, role: where.id, is_active: true })) },
  };
  const login = jest.fn(() => ({ access_token: 'supported-login-token' }));
  const jwt = new JwtService({ secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me' });
  const headers = (role: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: role })}`, 'Content-Type': 'application/json' });
  const release = { latest_version: '0.10.0', download_url: 'https://downloads.example.com/extension.zip' };

  beforeAll(async () => {
    process.env.RESUME_BUILDER_MIN_VERSION = '0.9.3';
    const module = await Test.createTestingModule({
      imports: [ExtensionReleaseModule],
      controllers: [AuthController],
      providers: [
        { provide: APP_GUARD, useClass: ResumeBuilderVersionGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: { login, me: () => ({ id: 'bidder' }) } },
      ],
    }).overrideProvider(ExtensionReleaseService).useValue(new ExtensionReleaseService(prisma as any)).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/api`;
  });

  beforeEach(() => { saved = null; jest.clearAllMocks(); });
  afterAll(async () => {
    await app?.close();
    if (previousMinimum === undefined) delete process.env.RESUME_BUILDER_MIN_VERSION;
    else process.env.RESUME_BUILDER_MIN_VERSION = previousMinimum;
  });

  it('uses the environment minimum until a super admin publishes a release', async () => {
    const response = await fetch(`${baseUrl}/extension-release`, { headers: headers('super_admin') });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ latest_version: '0.9.3', download_url: null, updated_at: null });
    const service = new ExtensionReleaseService(prisma as any);
    process.env.RESUME_BUILDER_MIN_VERSION = 'latest';
    expect(() => new ExtensionReleaseService(prisma as any)).toThrow('RESUME_BUILDER_MIN_VERSION');
    process.env.RESUME_BUILDER_MIN_VERSION = '0.9.3';
    expect((await service.get()).latest_version).toBe('0.9.3');
  });

  it.each([undefined, 'admin', 'bidder_manager', 'bidder'])('denies settings access to %s', async (role) => {
    for (const method of ['GET', 'PATCH']) {
      const response = await fetch(`${baseUrl}/extension-release`, {
        method, headers: role ? headers(role) : { 'Content-Type': 'application/json' },
        ...(method === 'PATCH' ? { body: JSON.stringify(release) } : {}),
      });
      expect(response.status).toBe(role ? 403 : 401);
    }
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });

  it('persists a release and immediately enforces it at login and during an existing session', async () => {
    const before = await fetch(`${baseUrl}/auth/me`, { headers: { ...headers('bidder'), 'X-Resume-Builder-Version': '0.9.3' } });
    expect(before.status).toBe(200);
    const response = await fetch(`${baseUrl}/extension-release`, {
      method: 'PATCH', headers: headers('super_admin'),
      body: JSON.stringify({ latest_version: ` ${release.latest_version} `, download_url: ` ${release.download_url} ` }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(release);
    expect(await new ExtensionReleaseService(prisma as any).get()).toMatchObject(release);
    const blockedRequests: Array<RequestInit & { path: string }> = [
      { path: '/auth/login', method: 'POST', headers: { 'X-Resume-Builder-Version': '0.9.10' } },
      { path: '/auth/login', method: 'POST', headers: { Origin: 'chrome-extension://legacy' } },
      { path: '/auth/me', method: 'GET', headers: { ...headers('bidder'), 'X-Resume-Builder-Version': '0.9.3' } },
    ];
    for (const request of blockedRequests) {
      const blocked = await fetch(`${baseUrl}${request.path}`, request);
      expect(blocked.status).toBe(426);
      expect(await blocked.json()).toMatchObject({ code: 'RESUME_BUILDER_UPDATE_REQUIRED', minimum_version: '0.10.0', ...release });
    }
    expect(login).not.toHaveBeenCalled();
    for (const version of ['0.10.0', '0.10.0.1', '1.0.0']) {
      const allowed = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Resume-Builder-Version': version },
        body: JSON.stringify({ email: 'bidder@example.com', password: 'password' }),
      });
      expect(allowed.status).toBe(200);
    }
    const dashboard = await fetch(`${baseUrl}/auth/me`, { headers: headers('bidder') });
    expect(dashboard.status).toBe(200);
    const changed = { latest_version: '0.10.1', download_url: 'https://downloads.example.com/new.zip' };
    expect((await fetch(`${baseUrl}/extension-release`, { method: 'PATCH', headers: headers('super_admin'), body: JSON.stringify(changed) })).status).toBe(200);
    const next = await fetch(`${baseUrl}/auth/me`, { headers: { ...headers('bidder'), 'X-Resume-Builder-Version': '0.10.0' } });
    expect(next.status).toBe(426);
    expect(await next.json()).toMatchObject(changed);
  });

  it.each([
    { latest_version: '' }, { latest_version: '0.10' }, { latest_version: 'latest' }, { latest_version: '65536.0.0' },
    { latest_version: null }, { latest_version: 12 }, { download_url: '' }, { download_url: null },
    { download_url: 'javascript:alert(1)' }, { download_url: 'data:text/html,download' },
    { download_url: 'file:///extension.zip' }, { download_url: '/extension.zip' },
    { download_url: 'https://user:password@example.com/extension.zip' },
  ])('rejects invalid settings without saving: %o', async (change) => {
    const response = await fetch(`${baseUrl}/extension-release`, {
      method: 'PATCH', headers: headers('super_admin'), body: JSON.stringify({ ...release, ...change }),
    });
    expect(response.status).toBe(400);
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });
});
