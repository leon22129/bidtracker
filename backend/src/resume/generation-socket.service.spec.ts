import { createServer, Server } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { WebSocket } from 'ws';
import { GenerationSocketService, GENERATION_SOCKET_PATH } from './generation-socket.service';

describe('generation WebSocket notifications', () => {
  let server: Server;
  let gateway: GenerationSocketService;
  let address: string;
  let jobId: string;
  let jobs: any;
  let users: any;
  let notifications: any;
  const jwt = new JwtService({ secret: 'websocket-fixture-secret' });
  const clients: WebSocket[] = [];
  const subscribe = async (overrides = {}) => {
    const socket = new WebSocket(address);
    clients.push(socket);
    const messages: any[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'subscribe', job_id: jobId, version: '0.9.7',
      token: jwt.sign({ sub: 'u1' }), ...overrides }));
    return { socket, messages };
  };
  const until = async (predicate: () => boolean) => {
    for (let count = 0; !predicate() && count < 100; count++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(predicate()).toBe(true);
  };

  beforeEach(async () => {
    jobId = randomUUID();
    server = createServer();
    jobs = { getStatus: jest.fn(async (user, id) => {
      if (user.id !== 'u1' || id !== jobId) throw new Error('Job not found');
      return { job_id: id, status: 'running', result: { resume: 'private resume content' } };
    }) };
    users = { validate: jest.fn(async (payload) => ({ id: payload.sub })) };
    notifications = { ready: true, events: new EventEmitter() };
    gateway = new GenerationSocketService({ httpAdapter: { getHttpServer: () => server } } as any,
      jwt, users, { get: async () => ({ latest_version: '0.9.7' }) } as any, jobs, notifications);
    gateway.onApplicationBootstrap();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    address = `ws://127.0.0.1:${(server.address() as any).port}${GENERATION_SOCKET_PATH}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    gateway.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('pushes only status for the authorized job without polling the database or sending resume data', async () => {
    const { socket, messages } = await subscribe();
    await until(() => messages.some((message) => message.type === 'subscribed'));
    expect(jobs.getStatus).toHaveBeenCalledTimes(2);
    notifications.events.emit('status', { job_id: randomUUID(), status: 'completed' });
    notifications.events.emit('status', { job_id: jobId, status: 'completed' });
    await until(() => messages.some((message) => message.status === 'completed'));
    expect(messages.at(-1)).toEqual({ type: 'status', job_id: jobId, status: 'completed' });
    expect(JSON.stringify(messages)).not.toContain('private resume');
    expect(jobs.getStatus).toHaveBeenCalledTimes(2);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it.each([
    ['invalid token', () => ({ token: 'not-a-token' })],
    ['expired token', () => ({ token: jwt.sign({ sub: 'u1' }, { expiresIn: -1 }) })],
    ['another owner', () => ({ token: jwt.sign({ sub: 'u2' }) })],
    ['outdated extension', () => ({ version: '0.9.6' })],
    ['another job', () => ({ job_id: randomUUID() })],
  ])('rejects %s', async (_label, overrides) => {
    const { socket, messages } = await subscribe(overrides());
    const [code] = await once(socket, 'close');
    expect(code).toBe(1008);
    expect(messages).toHaveLength(0);
  });

  it('keeps simultaneous jobs for two profiles separate when they complete out of order', async () => {
    const secondJobId = randomUUID();
    const profiles = new Map([[jobId, 'profile-a'], [secondJobId, 'profile-b']]);
    jobs.getStatus.mockImplementation(async (user, id) => {
      if (user.id !== 'u1' || !profiles.has(id)) throw new Error('Job not found');
      return { job_id: id, status: 'running' };
    });
    const [first, second] = await Promise.all([subscribe(), subscribe({ job_id: secondJobId })]);
    await until(() => [first, second].every(({ messages }) => messages.some((message) => message.status === 'running')));
    notifications.events.emit('status', { job_id: secondJobId, status: 'completed' });
    await until(() => second.messages.some((message) => message.status === 'completed'));
    expect(first.messages.some((message) => message.status === 'completed')).toBe(false);
    notifications.events.emit('status', { job_id: jobId, status: 'completed' });
    await until(() => first.messages.some((message) => message.status === 'completed'));
    expect(first.messages.every((message) => message.job_id === jobId)).toBe(true);
    expect(second.messages.every((message) => message.job_id === secondJobId)).toBe(true);
  });

  it('rechecks the stored result after registration to cover completion during subscription', async () => {
    jobs.getStatus.mockResolvedValueOnce({ job_id: jobId, status: 'running' })
      .mockResolvedValueOnce({ job_id: jobId, status: 'completed' });
    const { messages } = await subscribe();
    await until(() => messages.some((message) => message.status === 'completed'));
  });

  it('disconnects clients when database notifications are lost so they can reconnect or poll', async () => {
    const { socket, messages } = await subscribe();
    await until(() => messages.some((message) => message.type === 'subscribed'));
    const closed = once(socket, 'close');
    notifications.events.emit('disconnected');
    expect((await closed)[0]).toBe(1012);
  });

  it('rejects upgrades when notifications are unavailable instead of leaving clients waiting silently', async () => {
    notifications.ready = false;
    const client = new WebSocket(address);
    clients.push(client);
    client.on('error', () => {});
    const [, response] = await once(client, 'unexpected-response');
    expect(response.statusCode).toBe(503);
  });
});
