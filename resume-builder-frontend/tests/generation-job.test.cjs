const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/generation-job.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(storage = new Map(), overrides = {}) {
  let elapsed = 0;
  const context = vm.createContext({
    exports: {}, URL, TextEncoder, Uint8Array, Response, TypeError, Error, DOMException, crypto: webcrypto,
    AbortSignal: { timeout: (ms) => { assert.equal(ms, 20_000); return new AbortController().signal; } },
    Date: class extends Date { static now() { return 1_000_000 + elapsed; } },
    setTimeout: (callback, ms) => { elapsed += ms; callback(); },
    clearTimeout() {},
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    ...overrides,
  });
  vm.runInContext(source, context);
  return { run: context.exports.generateWithJob, storage, elapsed: () => elapsed };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const payload = { workspace_id: 'w1', job_description: 'JD' };

test('polls a generation that takes longer than Cloudflare\'s timeout without a long request', async () => {
  const app = setup();
  let submits = 0; let polls = 0;
  const pollTimes = [];
  const api = async (path, init) => {
    if (init.method === 'POST') { submits++; return json({ job_id: 'j1', status: 'queued' }, 202); }
    assert.equal(path, '/resume/jobs/j1'); polls++;
    pollTimes.push(app.elapsed());
    return json(app.elapsed() < 140_000 ? { job_id: 'j1', status: 'running' }
      : { job_id: 'j1', status: 'completed', result: { conversation_id: 'same-conversation', resume: 'Resume' } });
  };
  const result = await app.run(api, '/resume/jobs/application', payload, 'account:server');
  assert.equal(result.conversation_id, 'same-conversation');
  assert.equal(submits, 1); assert.ok(polls > 30); assert.equal(app.storage.size, 0);
  assert.equal(pollTimes[0], 50_000, 'no status checks during the first 50 seconds');
  for (let i = 1; i < pollTimes.length; i++) {
    assert.equal(pollTimes[i] - pollTimes[i - 1], 3000, 'subsequent status checks are three seconds apart');
  }
});

function socketApp(blocked = false) {
  let now = 1_000_000; let nextTimer = 0;
  const timers = new Map(); const sockets = [];
  class FakeSocket {
    constructor(url) {
      if (blocked) throw new Error('WebSockets unavailable');
      this.url = String(url); sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data) { this.subscription = JSON.parse(data); }
    close() { this.closed = true; }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    disconnect(code = 1006) { this.onclose?.({ code }); }
  }
  const app = setup(new Map(), {
    WebSocket: FakeSocket,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, ms) {
      const id = ++nextTimer;
      if (ms === 1000 || ms === 2000) { now += ms; queueMicrotask(callback); }
      else timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const until = async (condition) => {
    for (let i = 0; !condition() && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.ok(condition());
  };
  return { ...app, sockets, timers, until, fire(ms) {
    const entry = [...timers].find(([, value]) => value.ms === ms);
    assert.ok(entry, `Missing ${ms}ms timer`);
    timers.delete(entry[0]); now += ms; entry[1].callback();
  } };
}
const socketOptions = { apiBaseUrl: 'https://app.example.test/api', token: 'private-token', version: '0.9.7' };

test('WebSocket completion fetches the result once, without regular HTTP polling', async () => {
  const app = socketApp(); let reads = 0;
  const api = async (_path, init) => init.method === 'POST'
    ? json({ job_id: 'j1', status: 'queued' }, 202)
    : (reads++, json({ job_id: 'j1', status: 'completed', result: { resume: 'Ready' } }));
  const result = app.run(api, '/resume/jobs/application', payload, 'account', socketOptions);
  await app.until(() => app.sockets[0]?.subscription);
  const socket = app.sockets[0];
  assert.equal(socket.url, 'wss://app.example.test/api/resume/jobs/events');
  assert.equal(socket.subscription.token, 'private-token');
  assert.ok(!socket.url.includes('private-token'));
  socket.message({ type: 'subscribed', job_id: 'j1' });
  socket.message({ type: 'heartbeat' });
  socket.message({ type: 'status', job_id: 'someone-else', status: 'completed' });
  assert.equal(reads, 0);
  socket.message({ type: 'status', job_id: 'j1', status: 'completed' });
  assert.equal((await result).resume, 'Ready');
  assert.equal(reads, 1); assert.ok(socket.closed); assert.equal(app.timers.size, 0);
});

test('reconnects to the same job after a dropped socket without resubmitting generation', async () => {
  const app = socketApp(); let submits = 0;
  const api = async (_path, init) => init.method === 'POST'
    ? (submits++, json({ job_id: 'j1', status: 'queued' }, 202))
    : json({ job_id: 'j1', status: 'completed', result: { resume: 'Saved' } });
  const result = app.run(api, '/resume/jobs/application', payload, 'account', socketOptions);
  await app.until(() => app.sockets[0]?.subscription);
  app.sockets[0].disconnect();
  await app.until(() => app.sockets[1]?.subscription);
  assert.equal(app.sockets[1].subscription.job_id, 'j1');
  app.sockets[1].message({ type: 'status', job_id: 'j1', status: 'completed' });
  await result;
  assert.equal(submits, 1);
});

test('simultaneous profile generations keep their job IDs, resume results, and conversations separate', async () => {
  const app = socketApp();
  const submittedIds = new Map();
  const api = async (path, init) => {
    if (init.method === 'POST') {
      const profile = JSON.parse(init.body).profile_id;
      submittedIds.set(profile, init.headers['X-Generation-Id']);
      return json({ job_id: profile, status: 'queued' }, 202);
    }
    const profile = path.split('/').at(-1);
    return json({ job_id: profile, status: 'completed', result: { resume: `Resume for ${profile}`, conversation_id: `conversation-${profile}` } });
  };
  let firstFinished = false;
  const first = app.run(api, '/resume/jobs/application', { ...payload, profile_id: 'profile-a' }, 'account', socketOptions)
    .then((result) => { firstFinished = true; return result; });
  const second = app.run(api, '/resume/jobs/application', { ...payload, profile_id: 'profile-b', workspace_id: 'w2' }, 'account', socketOptions);
  await app.until(() => app.sockets.length === 2 && app.sockets.every((socket) => socket.subscription));
  assert.equal(new Set(submittedIds.values()).size, 2);
  assert.equal(app.storage.size, 2);
  const secondSocket = app.sockets.find((socket) => socket.subscription.job_id === 'profile-b');
  secondSocket.message({ type: 'status', job_id: 'profile-b', status: 'completed' });
  assert.equal((await second).conversation_id, 'conversation-profile-b');
  assert.equal(firstFinished, false);
  assert.equal(app.storage.size, 1);
  const firstSocket = app.sockets.find((socket) => socket.subscription.job_id === 'profile-a');
  firstSocket.message({ type: 'status', job_id: 'profile-a', status: 'completed' });
  const firstResult = await first;
  assert.equal(firstResult.resume, 'Resume for profile-a');
  assert.equal(firstResult.conversation_id, 'conversation-profile-a');
  assert.equal(app.storage.size, 0);
});

test('falls back to the requested 50-second initial polling delay when WebSockets are blocked', async () => {
  const app = socketApp(true); let reads = 0;
  const api = async (_path, init) => init.method === 'POST'
    ? json({ job_id: 'j1', status: 'queued' }, 202)
    : (reads++, json({ job_id: 'j1', status: 'completed', result: {} }));
  const result = app.run(api, '/resume/jobs/application', payload, 'account', socketOptions);
  await app.until(() => [...app.timers.values()].some((timer) => timer.ms === 47_000));
  assert.equal(reads, 0);
  app.fire(47_000); // The two reconnect delays used the other three seconds.
  await result;
  assert.equal(reads, 1);
});

test('a missing heartbeat reconnects rather than silently waiting forever', async () => {
  const app = socketApp();
  const api = async (_path, init) => json(init.method === 'POST' ? { job_id: 'j1', status: 'running' }
    : { job_id: 'j1', status: 'failed', message: 'Generation failed upstream' });
  const result = app.run(api, '/resume/jobs/answers', payload, 'account', socketOptions);
  const rejected = assert.rejects(result, /failed upstream/);
  await app.until(() => app.sockets[0]?.subscription);
  app.sockets[0].message({ type: 'subscribed', job_id: 'j1' });
  app.fire(65_000);
  await app.until(() => app.sockets[1]?.subscription);
  app.sockets[1].message({ type: 'status', job_id: 'j1', status: 'failed' });
  await rejected;
});

test('retries a lost submission response using the same ID, without starting another generation', async () => {
  const app = setup(); const ids = [];
  const api = async (_path, init) => {
    ids.push(init.headers['X-Generation-Id']);
    if (ids.length === 1) throw new TypeError('Connection lost after server accepted the request');
    return json({ job_id: ids[0], status: 'completed', result: { resume: 'Saved' } });
  };
  assert.equal((await app.run(api, '/resume/jobs/application', payload, 'account:server')).resume, 'Saved');
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 1);
});

test('recovers from a transient 524 during polling', async () => {
  const app = setup(); let polls = 0;
  const api = async (_path, init) => {
    if (init.method === 'POST') return json({ job_id: 'j1', status: 'queued' }, 202);
    if (++polls === 1) return new Response('<html>Cloudflare timeout</html>', { status: 524 });
    return json({ job_id: 'j1', status: 'completed', result: { answers: [] } });
  };
  assert.ok(Array.isArray((await app.run(api, '/resume/jobs/answers', payload, 'account:server')).answers));
  assert.equal(polls, 2);
});

test('retains the request ID after an outage so retrying after reload checks the same job', async () => {
  const app = setup(); let id;
  const offline = async (_path, init) => { id = init.headers['X-Generation-Id']; throw new TypeError('offline'); };
  await assert.rejects(app.run(offline, '/resume/jobs/application', payload, 'account:server'), /Retry to check the same generation/);
  assert.equal(app.storage.size, 1);
  const reloaded = setup(app.storage);
  const api = async (_path, init) => {
    assert.equal(init.headers['X-Generation-Id'], id);
    return json({ job_id: id, status: 'completed', result: { resume: 'Previously generated' } });
  };
  await reloaded.run(api, '/resume/jobs/application', payload, 'account:server');
  assert.equal(app.storage.size, 0);
});

test('reports a provider failure without retrying the paid generation', async () => {
  const app = setup(); let submissions = 0;
  const api = async () => { submissions++; return json({ job_id: 'j1', status: 'failed', message: 'AI provider unavailable (HTTP 524).' }); };
  await assert.rejects(app.run(api, '/resume/jobs/answers', payload, 'account:server'), /provider unavailable/);
  assert.equal(submissions, 1); assert.equal(app.storage.size, 0);
});

test('does not retry authorization or validation failures', async () => {
  const app = setup(); let submissions = 0;
  const api = async () => { submissions++; return json({ message: 'Workspace not found' }, 404); };
  await assert.rejects(app.run(api, '/resume/jobs/application', payload, 'account:server'), /Workspace not found/);
  assert.equal(submissions, 1); assert.equal(app.storage.size, 0);
});
