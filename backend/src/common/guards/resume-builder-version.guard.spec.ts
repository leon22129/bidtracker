import { ExecutionContext, HttpException, INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RequireResumeBuilderVersion } from '../decorators/resume-builder-version.decorator';
import { ResumeBuilderVersionGuard } from './resume-builder-version.guard';
import { ResumeController } from '../../resume/resume.controller';
import { ApplicationGenerationService } from '../../resume/resume.service';
import { ApplicationsController } from '../../applications/applications.controller';
import { ApplicationsService } from '../../applications/applications.service';
import { ApplicationDraftService } from '../../applications/application-draft.service';
import { ApplicationScreenshotService } from '../../applications/application-screenshot.service';
import { BannedUrlService } from '../../applications/banned-url.service';
import { WorkspacesController } from '../../workspaces/workspaces.controller';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { ExtensionReleaseService } from '../../extension-release/extension-release.service';

@RequireResumeBuilderVersion()
class VersionedController { handle() {} }
class SharedController { handle() {} }

function context(headers: Record<string, string | string[] | undefined> = {}, required = true, method = 'POST') {
  const controller = required ? VersionedController : SharedController;
  return {
    getClass: () => controller,
    getHandler: () => controller.prototype.handle,
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}

describe('ResumeBuilderVersionGuard', () => {
  let guard: ResumeBuilderVersionGuard;
  const release = { get: jest.fn() };

  beforeEach(() => {
    release.get.mockReset();
    release.get.mockResolvedValue({ latest_version: '0.9.3', download_url: 'https://downloads.example.com/extension.zip' });
    guard = new ResumeBuilderVersionGuard(new Reflector(), release as unknown as ExtensionReleaseService);
  });

  it.each(['0.9.3', '0.9.3.0', '0.9.3.1', '0.9.10', '0.10.0', '1.0.0'])(
    'accepts supported version %s using numeric comparison', async (version) => {
      await expect(guard.canActivate(context({ 'x-resume-builder-version': version }))).resolves.toBe(true);
    },
  );

  it.each([undefined, '', '0.9.2', '0.9.2.1', '0.8.99', 'invalid', '0.9', '0.9.3-beta', '0.9.3.0.1',
    'Infinity.0.0', '65536.0.0', ['0.9.3', '0.9.2']])('rejects missing, old or invalid version %s', async (version) => {
    const headers = { authorization: 'Bearer existing-session',
      ...(version === undefined ? {} : { 'x-resume-builder-version': version }) };
    try {
      await guard.canActivate(context(headers));
      throw new Error('Expected an upgrade rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(426);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'RESUME_BUILDER_UPDATE_REQUIRED', minimum_version: '0.9.3',
        latest_version: '0.9.3', download_url: 'https://downloads.example.com/extension.zip',
      });
    }
  });

  it('allows normal dashboard requests and preflight requests without a version', async () => {
    await expect(guard.canActivate(context({}, false))).resolves.toBe(true);
    await expect(guard.canActivate(context({ origin: 'https://bids.example.com' }, false))).resolves.toBe(true);
    await expect(guard.canActivate(context({ origin: 'chrome-extension://example' }, true, 'OPTIONS'))).resolves.toBe(true);
    expect(release.get).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'chrome-extension://example' },
    { referer: 'chrome-extension://example/index.html' },
    { 'x-resume-builder-version': '0.9.2' },
    { 'x-resume-builder-version': '' },
  ])('rejects legacy extension requests on shared routes: %o', async (headers) => {
    await expect(guard.canActivate(context(headers, false))).rejects.toThrow(HttpException);
  });

  it('compares against the required server version and returns its download link', async () => {
    await expect(guard.canActivate(context({ 'x-resume-builder-version': '0.9.10' }))).resolves.toBe(true);
    release.get.mockResolvedValue({ latest_version: '0.10.0', download_url: 'https://downloads.example.com/new.zip' });
    await expect(guard.canActivate(context({ 'x-resume-builder-version': '0.9.10' }))).rejects.toMatchObject({
      response: { minimum_version: '0.10.0', download_url: 'https://downloads.example.com/new.zip' },
    });
    await expect(guard.canActivate(context({ 'x-resume-builder-version': '0.10.0' }))).resolves.toBe(true);
  });
});

describe('Resume Builder version enforcement over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const generate = jest.fn(() => ({ success: true }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ResumeController, ApplicationsController, WorkspacesController],
      providers: [
        { provide: APP_GUARD, useClass: ResumeBuilderVersionGuard },
        { provide: ExtensionReleaseService, useValue: { get: async () => ({ latest_version: '0.9.3', download_url: null }) } },
        { provide: ApplicationGenerationService, useValue: { generate } },
        { provide: ApplicationsService, useValue: {} },
        { provide: ApplicationDraftService, useValue: {} },
        { provide: ApplicationScreenshotService, useValue: {} },
        { provide: BannedUrlService, useValue: {} },
        { provide: WorkspacesService, useValue: { listProfiles: () => [] } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['POST', '/resume/generate'],
    ['POST', '/resume/profile-generate'],
    ['POST', '/resume/answers'],
    ['GET', '/resume/answers/conversation'],
    ['POST', '/applications/generate'],
    ['POST', '/applications/generated'],
    ['GET', '/applications/latest-generated'],
    ['GET', '/applications/drafts/latest'],
    ['POST', '/applications/drafts/example/submit'],
    ['POST', '/applications/example/screenshot'],
    ['PATCH', '/workspaces/profiles/example'],
  ])('rejects an unversioned legacy %s %s before calling a service', async (method, path) => {
    const response = await fetch(`${baseUrl}/api${path}`, { method });
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: 'RESUME_BUILDER_UPDATE_REQUIRED' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects an outdated version and accepts the current build', async () => {
    const oldResponse = await fetch(`${baseUrl}/api/applications/generate`, {
      method: 'POST', headers: { 'X-Resume-Builder-Version': '0.9.2' },
    });
    expect(oldResponse.status).toBe(426);
    expect(generate).not.toHaveBeenCalled();
    const response = await fetch(`${baseUrl}/api/applications/generate`, {
      method: 'POST', headers: { 'X-Resume-Builder-Version': '0.9.3' },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('preserves shared dashboard access but rejects unversioned extension access', async () => {
    const path = `${baseUrl}/api/workspaces/profiles/assigned`;
    const dashboard = await fetch(path);
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json()).toEqual([]);
    const extension = await fetch(path, { headers: { Origin: 'chrome-extension://example' } });
    expect(extension.status).toBe(426);
  });
});
