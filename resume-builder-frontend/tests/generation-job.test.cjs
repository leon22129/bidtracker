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

function setup(storage = new Map()) {
  let elapsed = 0;
  const context = vm.createContext({
    exports: {}, TextEncoder, Uint8Array, Response, TypeError, Error, DOMException, crypto: webcrypto,
    AbortSignal: { timeout: (ms) => { assert.equal(ms, 20_000); return new AbortController().signal; } },
    Date: class extends Date { static now() { return 1_000_000 + elapsed; } },
    setTimeout: (callback, ms) => { elapsed += ms; callback(); },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  });
  vm.runInContext(source, context);
  return { run: context.exports.generateWithJob, storage, elapsed: () => elapsed };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const payload = { workspace_id: 'w1', job_description: 'JD' };

test('polls a generation that takes longer than Cloudflare\'s timeout without a long request', async () => {
  const app = setup();
  let submits = 0; let polls = 0;
  const api = async (path, init) => {
    if (init.method === 'POST') { submits++; return json({ job_id: 'j1', status: 'queued' }, 202); }
    assert.equal(path, '/resume/jobs/j1'); polls++;
    return json(app.elapsed() < 140_000 ? { job_id: 'j1', status: 'running' }
      : { job_id: 'j1', status: 'completed', result: { conversation_id: 'same-conversation', resume: 'Resume' } });
  };
  const result = await app.run(api, '/resume/jobs/application', payload, 'account:server');
  assert.equal(result.conversation_id, 'same-conversation');
  assert.equal(submits, 1); assert.ok(polls > 30); assert.equal(app.storage.size, 0);
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
