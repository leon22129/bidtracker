// Real PostgreSQL notifications and WebSockets through the production Next server, using only
// synthetic data in a temporary schema. No provider calls and no changes to running services.
require('dotenv').config();
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const { WebSocket } = require('ws');
const { JwtService } = require('@nestjs/jwt');
const { GenerationJobNotificationsService } = require('../dist/resume/generation-job-notifications.service');
const { GenerationSocketService, GENERATION_SOCKET_PATH } = require('../dist/resume/generation-socket.service');

const schema = `generation_notify_test_${randomUUID().replaceAll('-', '')}`;
const originalUrl = process.env.DATABASE_URL;
const db = new Client({ connectionString: originalUrl });
const listeners = [];
const sockets = [];
let gateway, backend, frontend, created = false;
const until = async (condition, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(condition(), 'Timed out waiting for notifications');
};

async function main() {
  assert.match(schema, /^generation_notify_test_[a-f0-9]{32}$/);
  await db.connect();
  await db.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await db.query(`SET search_path TO "${schema}"`);
  await db.query('CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
  await db.query(readFileSync(join(__dirname, '../prisma/migrations/20261109020000_notify_generation_job_status/migration.sql'), 'utf8'));
  const scopedUrl = new URL(originalUrl);
  scopedUrl.searchParams.set('schema', schema);
  process.env.DATABASE_URL = scopedUrl.toString();
  const first = new GenerationJobNotificationsService();
  const second = new GenerationJobNotificationsService();
  listeners.push(first, second);
  await Promise.all(listeners.map((service) => service.onModuleInit()));
  assert.ok(listeners.every((service) => service.ready));
  const events = [[], []];
  listeners.forEach((service, index) => service.events.on('status', (event) => events[index].push(event)));
  const jobId = randomUUID();
  await db.query('INSERT INTO generation_jobs VALUES ($1, $2)', [jobId, 'running']);
  const jwt = new JwtService({ secret: 'local-notification-fixture-secret' });
  let reads = 0;
  const jobs = { getStatus: async (user, id) => {
    assert.equal(user.id, 'fixture-user'); assert.equal(id, jobId);
    reads++;
    const { rows } = await db.query('SELECT status FROM generation_jobs WHERE id = $1', [id]);
    return { job_id: id, status: rows[0].status };
  } };
  backend = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, fixture: true })); });
  gateway = new GenerationSocketService({ httpAdapter: { getHttpServer: () => backend } }, jwt,
    { validate: async (payload) => ({ id: payload.sub }) },
    { get: async () => ({ latest_version: '0.9.7' }) }, jobs, first);
  gateway.onApplicationBootstrap();
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const frontendRoot = join(__dirname, '../../frontend');
  frontend = spawn(process.execPath, ['server.cjs', '-p', '0'], {
    cwd: frontendRoot, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME_BIND: '127.0.0.1', BACKEND_URL: `http://127.0.0.1:${backend.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  frontend.stdout.on('data', (chunk) => { output += chunk.toString(); });
  frontend.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await until(() => /Frontend listening on http:\/\/127\.0\.0\.1:\d+/.test(output) || frontend.exitCode !== null, 30_000);
  if (frontend.exitCode !== null) throw new Error('Frontend test server could not start: ' + output.slice(-2000));
  const port = output.match(/Frontend listening on http:\/\/127\.0\.0\.1:(\d+)/)[1];
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal((await response.json()).fixture, true, 'normal HTTP proxy must still work');
  const client = new WebSocket(`ws://127.0.0.1:${port}${GENERATION_SOCKET_PATH}`);
  sockets.push(client);
  const messages = [];
  client.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'subscribe', job_id: jobId, version: '0.9.7', token: jwt.sign({ sub: 'fixture-user' }) }));
  await until(() => messages.some((message) => message.status === 'running'));
  assert.equal(reads, 2);
  await db.query('BEGIN');
  await db.query('UPDATE generation_jobs SET status = $1 WHERE id = $2', ['completed', jobId]);
  assert.equal(events[0].length, 0, 'uncommitted results must not be announced');
  await db.query('COMMIT');
  await until(() => events.every((list) => list.some((event) => event.status === 'completed'))
    && messages.some((message) => message.status === 'completed'));
  assert.equal(reads, 2, 'notification delivery must not poll job status');
  assert.deepEqual(messages.at(-1), { type: 'status', job_id: jobId, status: 'completed' });
  const closed = once(client, 'close');
  await first.client.end();
  assert.equal((await closed)[0], 1012, 'listener loss must trigger client recovery');
  console.log('PASS: actual migration, committed PostgreSQL notifications across two listeners, production Next HTTP and WebSocket proxy, authenticated completion push without polling, and listener disconnect recovery');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  process.env.DATABASE_URL = originalUrl;
  for (const socket of sockets) socket.terminate();
  gateway?.onModuleDestroy();
  await Promise.all(listeners.map((service) => service.onModuleDestroy()));
  if (frontend && frontend.exitCode === null) frontend.kill();
  if (backend) await new Promise((resolve) => backend.close(resolve));
  if (created && /^generation_notify_test_[a-f0-9]{32}$/.test(schema)) {
    await db.query('ROLLBACK');
    await db.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await db.end();
});
