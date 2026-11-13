import { INestApplication, ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { RESUME_BUILDER_VERSION } from './extension-build-version.generated';

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
  const release = { latest_version: RESUME_BUILDER_VERSION, download_url: 'https://downloads.example.com/extension.zip' };

  beforeAll(async () => {
    process.env.RESUME_BUILDER_MIN_VERSION = '65535.0.0';
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

  it('uses the extension code version before any admin settings are saved, ignoring the legacy environment override', async () => {
    const extensionPackage = JSON.parse(readFileSync(resolve(process.cwd(), '../resume-builder-frontend/package.json'), 'utf8'));
    expect(RESUME_BUILDER_VERSION).toBe(extensionPackage.version);
    const response = await fetch(`${baseUrl}/extension-release`, { headers: headers('super_admin') });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ latest_version: extensionPackage.version, download_url: null, updated_at: null });
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });

  it.each(['0.1.0', '65535.0.0'])('ignores stored version %s while preserving the saved download link', async (version) => {
    saved = { id: 'current', latest_version: version, download_url: release.download_url, updated_at: new Date() };
    const response = await fetch(`${baseUrl}/extension-release`, { headers: headers('super_admin') });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...release, updated_at: saved.updated_at.toISOString() });
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });

  it.each(['0.1.0', '65535.0.0'])('a legacy admin request cannot override the code version with %s', async (version) => {
    const response = await fetch(`${baseUrl}/extension-release`, {
      method: 'PATCH', headers: headers('super_admin'),
      body: JSON.stringify({ latest_version: version, download_url: release.download_url }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(release);
    expect(saved.latest_version).toBe(RESUME_BUILDER_VERSION);
  });

  it.each(['super_admin', 'admin', 'bidder_manager', 'bidder'])('lets %s read the extension download without changing it', async (role) => {
    saved = { id: 'current', ...release, updated_at: new Date() };
    const response = await fetch(`${baseUrl}/extension-release`, { headers: headers(role) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...release, updated_at: saved.updated_at.toISOString() });
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });

  it.each([undefined, 'admin', 'bidder_manager', 'bidder'])('denies settings changes to %s', async (role) => {
    const response = await fetch(`${baseUrl}/extension-release`, {
      method: 'PATCH', headers: role ? headers(role) : { 'Content-Type': 'application/json' },
      body: JSON.stringify(release),
    });
    expect(response.status).toBe(role ? 403 : 401);
    expect(prisma.extensionRelease.upsert).not.toHaveBeenCalled();
  });

  it('requires authentication to read the extension download', async () => {
    const response = await fetch(`${baseUrl}/extension-release`);
    expect(response.status).toBe(401);
    expect(prisma.extensionRelease.findUnique).not.toHaveBeenCalled();
  });

  it('enforces the code version at login and during an existing session, with an editable download link', async () => {
    const before = await fetch(`${baseUrl}/auth/me`, { headers: { ...headers('bidder'), 'X-Resume-Builder-Version': RESUME_BUILDER_VERSION } });
    expect(before.status).toBe(200);
    const response = await fetch(`${baseUrl}/extension-release`, {
      method: 'PATCH', headers: headers('super_admin'),
      body: JSON.stringify({ download_url: ` ${release.download_url} ` }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(release);
    expect(await new ExtensionReleaseService(prisma as any).get()).toMatchObject(release);
    const blockedRequests: Array<RequestInit & { path: string }> = [
      { path: '/auth/login', method: 'POST', headers: { 'X-Resume-Builder-Version': '0.0.0' } },
      { path: '/auth/login', method: 'POST', headers: { Origin: 'chrome-extension://legacy' } },
      { path: '/auth/me', method: 'GET', headers: { ...headers('bidder'), 'X-Resume-Builder-Version': '0.0.0' } },
    ];
    for (const request of blockedRequests) {
      const blocked = await fetch(`${baseUrl}${request.path}`, request);
      expect(blocked.status).toBe(426);
      expect(await blocked.json()).toMatchObject({ code: 'RESUME_BUILDER_UPDATE_REQUIRED', minimum_version: RESUME_BUILDER_VERSION, ...release });
    }
    expect(login).not.toHaveBeenCalled();
    for (const version of [RESUME_BUILDER_VERSION, `${Number(RESUME_BUILDER_VERSION.split('.')[0]) + 1}.0.0`]) {
      const allowed = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Resume-Builder-Version': version },
        body: JSON.stringify({ email: 'bidder@example.com', password: 'password' }),
      });
      expect(allowed.status).toBe(200);
    }
    const dashboard = await fetch(`${baseUrl}/auth/me`, { headers: headers('bidder') });
    expect(dashboard.status).toBe(200);
    const changed = { download_url: 'https://downloads.example.com/new.zip' };
    expect((await fetch(`${baseUrl}/extension-release`, { method: 'PATCH', headers: headers('super_admin'), body: JSON.stringify(changed) })).status).toBe(200);
    const next = await fetch(`${baseUrl}/auth/me`, { headers: { ...headers('bidder'), 'X-Resume-Builder-Version': '0.0.0' } });
    expect(next.status).toBe(426);
    expect(await next.json()).toMatchObject({ ...changed, latest_version: RESUME_BUILDER_VERSION });
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { ...headers('bidder'), 'X-Resume-Builder-Version': RESUME_BUILDER_VERSION } })).status).toBe(200);
  });

  it.each([
    { download_url: '' }, { download_url: null },
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
