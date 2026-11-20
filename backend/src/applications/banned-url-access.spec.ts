import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationDraftService } from './application-draft.service';
import { ApplicationScreenshotService } from './application-screenshot.service';
import { ApplicationGenerationService } from '../resume/resume.service';
import { BannedUrlService } from './banned-url.service';

describe('Banned URL permissions over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const pattern = { id: 'pattern-1', pattern: 'blocked.example', createdByUser: { username: 'admin' } };
  const banned = {
    list: jest.fn(async () => [pattern]),
    create: jest.fn(async () => pattern),
    remove: jest.fn(async () => ({ success: true })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApplicationsController],
      providers: [
        { provide: ApplicationsService, useValue: {} },
        { provide: ApplicationGenerationService, useValue: {} },
        { provide: ApplicationDraftService, useValue: {} },
        { provide: ApplicationScreenshotService, useValue: {} },
        { provide: BannedUrlService, useValue: banned },
      ],
    }).compile();
    app = module.createNestApplication();
    // Supply authenticated actors while retaining the controller's real RolesGuard.
    app.use((request: any, _response: any, next: () => void) => {
      const role = request.headers['x-test-role'];
      if (role) request.user = { id: 'user-1', username: 'user', email: 'user@example.test', role };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/applications/banned-patterns`;
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  it.each(['bidder', 'bidder_manager', 'admin', 'super_admin'])('lets a %s view the banned list', async (role) => {
    const response = await fetch(baseUrl, { headers: { 'x-test-role': role } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([pattern]);
    expect(banned.list).toHaveBeenCalledTimes(1);
  });

  it.each(['bidder', 'bidder_manager', ''])('rejects banned-list mutations for role "%s"', async (role) => {
    const headers = { 'x-test-role': role, 'content-type': 'application/json' };
    const created = await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify({ pattern: 'new.example' }) });
    const removed = await fetch(`${baseUrl}/pattern-1`, { method: 'DELETE', headers });
    expect(created.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(banned.create).not.toHaveBeenCalled();
    expect(banned.remove).not.toHaveBeenCalled();
  });

  it('does not expose the list without an authenticated role', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(403);
    expect(banned.list).not.toHaveBeenCalled();
  });

  it.each(['admin', 'super_admin'])('keeps banned-list management available to a %s', async (role) => {
    const headers = { 'x-test-role': role, 'content-type': 'application/json' };
    const created = await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify({ pattern: 'new.example' }) });
    const removed = await fetch(`${baseUrl}/pattern-1`, { method: 'DELETE', headers });
    expect(created.status).toBe(201);
    expect(removed.status).toBe(200);
    expect(banned.create).toHaveBeenCalledWith('new.example', 'user-1');
    expect(banned.remove).toHaveBeenCalledWith('pattern-1');
  });
});
